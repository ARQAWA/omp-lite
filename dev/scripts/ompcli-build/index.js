"use strict";

// Builds the extension staging tree from install.manifest.json.
// Run with Bun: bun dev/scripts/ompcli-build/index.js
// Only explicit manifest entries are copied; no directory is copied recursively.

const { spawnSync } = require("node:child_process");
const { createHash } = require("node:crypto");
const fs = require("node:fs");
const fsp = require("node:fs/promises");
const path = require("node:path");
const { stage } = require("./stage.js");
const { fetchRuntime, root } = require("../ompcli-runtime/index.js");

const dist = path.join(root, "dist/ompcli");
const cache = path.join(root, "dist/.cache");
const SYSTEM_DLLS = new Set([
	"advapi32.dll", "bcrypt.dll", "bcryptprimitives.dll", "cfgmgr32.dll", "comctl32.dll", "comdlg32.dll",
	"crypt32.dll", "cryptbase.dll", "dbghelp.dll", "dwmapi.dll", "gdi32.dll", "hid.dll", "imm32.dll",
	"iphlpapi.dll", "kernel32.dll", "mpr.dll", "msimg32.dll", "msvcrt.dll", "netapi32.dll", "normaliz.dll",
	"ntdll.dll", "ole32.dll", "oleacc.dll", "oleaut32.dll", "powrprof.dll", "psapi.dll", "rpcrt4.dll",
	"secur32.dll", "setupapi.dll", "shell32.dll", "shlwapi.dll", "ucrtbase.dll", "user32.dll", "userenv.dll",
	"uxtheme.dll", "version.dll", "winmm.dll", "winspool.drv", "ws2_32.dll", "wsock32.dll", "wldap32.dll",
]);

function shasum(data) {
	return createHash("sha256").update(data).digest("hex");
}

function run(file, args, cwd) {
	const result = spawnSync(file, args, { cwd, encoding: "utf8" });
	if (result.status !== 0) throw new Error((file + " " + args.join(" ")).trim() + ": " + (result.stderr || result.error?.message || "failed"));
	return result.stdout;
}

function revision() {
	const sha = run("git", ["rev-parse", "HEAD"], root).trim();
	if (!/^[a-f0-9]{40}$/.test(sha)) throw new Error("Cannot read the source revision");
	return sha;
}

function assertClean() {
	if (run("git", ["status", "--porcelain"], root).trim()) throw new Error("Commit the source before building: the worktree is dirty");
}

// PE import table, used to prove the shipped bundle resolves every non-system import.
function peImports(buffer) {
	if (buffer.length < 0x40 || buffer.readUInt16LE(0) !== 0x5a4d) throw new Error("Not a PE file");
	const pe = buffer.readUInt32LE(0x3c);
	if (buffer.readUInt32LE(pe) !== 0x00004550) throw new Error("Not a PE file");
	const sections = buffer.readUInt16LE(pe + 6);
	const optionalSize = buffer.readUInt16LE(pe + 20);
	const optional = pe + 24;
	if (buffer.readUInt16LE(optional) !== 0x20b) throw new Error("Not a PE32+ file");
	const descriptorRva = buffer.readUInt32LE(optional + 112 + 8);
	const table = optional + optionalSize;
	const map = [];
	for (let index = 0; index < sections; index++) {
		const entry = table + index * 40;
		map.push({
			size: Math.max(buffer.readUInt32LE(entry + 8), buffer.readUInt32LE(entry + 16)),
			address: buffer.readUInt32LE(entry + 12),
			raw: buffer.readUInt32LE(entry + 20),
		});
	}
	const offset = rva => {
		for (const section of map) {
			if (rva >= section.address && rva < section.address + section.size) return section.raw + rva - section.address;
		}
		throw new Error("Import RVA is outside the sections");
	};
	const names = [];
	const start = offset(descriptorRva);
	for (let index = 0; ; index++) {
		const nameRva = buffer.readUInt32LE(start + index * 20 + 12);
		if (!nameRva) break;
		const at = offset(nameRva);
		let end = at;
		while (buffer[end]) end++;
		names.push(buffer.toString("ascii", at, end));
	}
	return names;
}

async function stageRuntime() {
	const resources = require(path.join(root, "src/modules/ompcli/runtime.json"));
	const dir = path.join(dist, "runtime/llama");
	const temporary = path.join(cache, "extract");
	await fsp.rm(temporary, { recursive: true, force: true });
	await fsp.mkdir(temporary, { recursive: true });
	await fsp.mkdir(dir, { recursive: true });
	const llama = path.join(cache, "llama.zip");
	const vc = path.join(cache, "vc_redist.x64.exe");
	await fetchRuntime(llama, resources.llama);
	await fetchRuntime(vc, resources.vc);
	const names = Object.keys(resources.llama.files);
	run("tar", ["-xf", llama, "-C", temporary, ...names]);
	for (const [name, expected] of Object.entries(resources.llama.files)) {
		const data = await fsp.readFile(path.join(temporary, name));
		if (shasum(data) !== expected) throw new Error("llama.cpp checksum mismatch: " + name);
		await fsp.copyFile(path.join(temporary, name), path.join(dir, name));
	}
	// The redistributable is a WiX bundle: cabextract opens its attached container
	// and the inner cabinet, so the installer never runs.
	const bundles = path.join(temporary, "vc");
	await fsp.mkdir(bundles, { recursive: true });
	run("cabextract", ["-q", "-d", bundles, vc]);
	const members = (await fsp.readdir(bundles)).filter(name => /^a\d+$/.test(name)).sort();
	let cab = null;
	for (const member of members) {
		const file = path.join(bundles, member);
		const head = (await fsp.readFile(file)).subarray(0, 4).toString("ascii");
		if (head !== "MSCF") continue;
		if (run("cabextract", ["-l", file]).includes("msvcp140.dll_amd64")) {
			cab = file;
			break;
		}
	}
	if (!cab) throw new Error("No x64 runtime cabinet in the VC redistributable");
	const crt = path.join(temporary, "crt");
	await fsp.mkdir(crt, { recursive: true });
	run("cabextract", ["-q", "-d", crt, cab]);
	for (const [name, expected] of Object.entries(resources.vc.files)) {
		const data = await fsp.readFile(path.join(crt, name.replace(/\.dll$/, ".dll_amd64")));
		if (shasum(data) !== expected) throw new Error("VC runtime checksum mismatch: " + name);
		await fsp.copyFile(path.join(crt, name.replace(/\.dll$/, ".dll_amd64")), path.join(dir, name));
	}
	await fsp.rm(temporary, { recursive: true, force: true });
	const shipped = new Set((await fsp.readdir(dir)).map(name => name.toLowerCase()));
	for (const name of await fsp.readdir(dir)) {
		for (const imported of peImports(await fsp.readFile(path.join(dir, name)))) {
			const lower = imported.toLowerCase();
			if (shipped.has(lower) || SYSTEM_DLLS.has(lower) || lower.startsWith("api-ms-win-") || lower.startsWith("ext-ms-")) continue;
			throw new Error("Unresolved import " + imported + " in " + name);
		}
	}
	return shipped.size;
}

async function main() {
	const manifest = JSON.parse(await fsp.readFile(path.join(root, "install.manifest.json"), "utf8"));
	const sha = revision();
	assertClean();
	await stage(root, dist, manifest, sha);
	const count = await stageRuntime();
	const files = [];
	const walk = async dir => {
		for (const entry of await fsp.readdir(dir, { withFileTypes: true })) {
			const full = path.join(dir, entry.name);
			if (entry.isDirectory()) await walk(full);
			else files.push(full);
		}
	};
	await walk(dist);
	const size = (await Promise.all(files.map(async file => (await fsp.stat(file)).size))).reduce((sum, value) => sum + value, 0);
	console.log("revision " + sha);
	console.log("runtime files " + count);
	console.log("staging files " + files.length + ", " + (size / 1048576).toFixed(2) + " MB");
	for (const file of files.sort()) console.log("  " + path.relative(dist, file));
}

main().catch(error => {
	console.error(error.message);
	process.exitCode = 1;
});
