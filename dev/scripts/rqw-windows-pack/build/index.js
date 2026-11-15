"use strict";

// Builds the extension folder `dist/ompcli` of RQW Windows Pack for packaging: the manifest files,
// the bundled programs and the harness copy. Run with Bun: bun dev/scripts/rqw-windows-pack/build/index.js
// The VC runtime is taken out of its installer by `cabextract`; the installer never runs.

const { spawnSync } = require("node:child_process");
const { createHash } = require("node:crypto");
const fsp = require("node:fs/promises");
const path = require("node:path");
const { fetchPinned, pins, root } = require("../runtime/index.js");

function run(file, args) {
	const result = spawnSync(file, args, { cwd: root, encoding: "utf8" });
	if (result.status !== 0) throw new Error(file + " " + args.join(" ") + ": " + (result.stderr || result.error?.message || "failed"));
	return result.stdout;
}

// Only explicit manifest entries are copied: no directory is copied recursively.
async function stage(source, dist, manifest, revision) {
	const copy = async (from, to) => {
		if (from.startsWith("dev/") || from.endsWith("README.md")) throw new Error("Development file installed: " + from);
		await fsp.mkdir(path.dirname(to), { recursive: true });
		await fsp.copyFile(path.join(source, from), to);
	};
	await fsp.rm(dist, { recursive: true, force: true });
	for (const entry of manifest.vscode.files) await copy(entry.from, path.join(dist, entry.to));
	for (const from of ["install.manifest.json", ...[...manifest.files, ...manifest.config].map(entry => entry.from)]) await copy(from, path.join(dist, "payload", from));
	await fsp.writeFile(path.join(dist, "payload/.revision"), revision + "\n");
}

// Programs run from the extension folder, so they ship inside the VSIX. Every file is checked by SHA-256.
async function programs(dist) {
	const pin = pins();
	const cache = path.join(root, "dist/.cache");
	const temporary = path.join(cache, "extract");
	const out = path.join(dist, "runtime");
	await fsp.rm(temporary, { recursive: true, force: true });
	await fsp.mkdir(path.join(temporary, "vc"), { recursive: true });
	await fsp.mkdir(path.join(out, "llama"), { recursive: true });
	const cached = async (name, asset) => (await fetchPinned(path.join(cache, name), asset), path.join(cache, name));
	const place = async (from, to, sha256) => {
		const data = await fsp.readFile(from);
		if (createHash("sha256").update(data).digest("hex") !== sha256) throw new Error("Checksum mismatch: " + path.basename(to));
		await fsp.writeFile(to, data);
	};
	await fsp.copyFile(await cached("omp.exe", pin.assets.omp), path.join(out, pin.assets.omp.file));
	// ffmpeg for dictation sits next to omp.exe: that folder is on PATH in every tab.
	run("tar", ["-xf", await cached("ffmpeg.zip", pin.ffmpeg), "-C", temporary, pin.ffmpeg.member]);
	await place(path.join(temporary, pin.ffmpeg.member), path.join(out, pin.ffmpeg.file), pin.ffmpeg.fileSha256);
	run("tar", ["-xf", await cached("llama.zip", pin.llama), "-C", temporary, ...Object.keys(pin.llama.files)]);
	for (const [name, sha256] of Object.entries(pin.llama.files)) await place(path.join(temporary, name), path.join(out, "llama", name), sha256);
	// The redistributable is a WiX bundle: its attached container holds the cabinet with the x64 runtime.
	run("cabextract", ["-q", "-d", path.join(temporary, "vc"), await cached("vc_redist.x64.exe", pin.vc)]);
	const cabinet = (await fsp.readdir(path.join(temporary, "vc"))).map(name => path.join(temporary, "vc", name)).find(file => spawnSync("cabextract", ["-l", file], { encoding: "utf8" }).stdout.includes("msvcp140.dll_amd64"));
	if (!cabinet) throw new Error("No x64 runtime cabinet in the VC redistributable");
	run("cabextract", ["-q", "-d", path.join(temporary, "crt"), cabinet]);
	for (const [name, sha256] of Object.entries(pin.vc.files)) await place(path.join(temporary, "crt", name + "_amd64"), path.join(out, "llama", name), sha256);
	await fsp.rm(temporary, { recursive: true, force: true });
}

async function main() {
	const dist = path.join(root, "dist/ompcli");
	// The revision in the payload must be the commit of the sources: a dirty tree is refused.
	if (run("git", ["status", "--porcelain"]).trim()) throw new Error("Commit the source before building: the worktree is dirty");
	const revision = run("git", ["rev-parse", "HEAD"]).trim();
	await stage(root, dist, JSON.parse(await fsp.readFile(path.join(root, "install.manifest.json"), "utf8")), revision);
	await programs(dist);
	const files = await fsp.readdir(dist, { recursive: true });
	console.log("revision " + revision + "\n" + dist + ": " + files.length + " entries");
}

if (require.main === module) {
	main().catch(error => {
		console.error(error.message);
		process.exitCode = 1;
	});
}

module.exports = { stage };
