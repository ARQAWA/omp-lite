"use strict";

// OMP CLI for Windows VDI: VS Code extension plus the harness installer it runs under Bun.
// Documentation: omp://cli-reference.md, omp://config-usage.md, omp://mnemosyne-memory-backend.md.

const { createHash, randomBytes, randomUUID } = require("node:crypto");
const { createReadStream, createWriteStream } = require("node:fs");
const fsp = require("node:fs/promises");
const net = require("node:net");
const os = require("node:os");
const path = require("node:path");
const { spawn } = require("node:child_process");
const { Readable, Transform } = require("node:stream");
const { pipeline } = require("node:stream/promises");
const { inflateRawSync } = require("node:zlib");
const messages = require("./messages.json");
const runtime = require("./runtime.json");

const GIT_BASH = "C:\\Program Files\\Git\\bin\\bash.exe";
const MEMORY_MODEL = "embeddinggemma-2:270m-q8_0";
const MEMORY_DIM = 768;
const PROXY_VARS = ["HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY", "NO_PROXY", "NODE_USE_ENV_PROXY", "NODE_TLS_REJECT_UNAUTHORIZED"];
const REVISION = /^[a-f0-9]{40}$/;
const BACKUP_DIR = ".ompcli-backups";
const EXTRACT_SCRIPT = String.raw`
const { gunzipSync } = require("node:zlib");
const fs = require("node:fs");
const path = require("node:path");
const [archive, output, revision] = process.argv.slice(2);
const bytes = gunzipSync(fs.readFileSync(archive), { maxOutputLength: 67108864 });
const files = await new Bun.Archive(bytes).files();
const roots = new Set([...files.keys()].map((name) => name.split("/")[0]));
if (roots.size !== 1) throw new Error("OMP archive has an unexpected root");
const root = [...roots][0];
const read = async (name) => Buffer.from(await files.get(name).arrayBuffer());
const safe = (value) => typeof value === "string" && /^[^\\:\0]+$/.test(value) && value.split("/").every((part) => part && part !== "." && part !== "..");
const write = (target, data) => { fs.mkdirSync(path.dirname(target), { recursive: true }); fs.writeFileSync(target, data); };
const manifestName = root + "/install.manifest.json";
if (!files.has(manifestName)) throw new Error("OMP archive has no install manifest");
const manifest = JSON.parse(await files.get(manifestName).text());
if (manifest.version !== 1 || !Array.isArray(manifest.files) || !Array.isArray(manifest.config)) throw new Error("OMP archive manifest is invalid");
const configs = new Set(manifest.config.map((entry) => entry.from));
const strip = (data) => {
  const value = Bun.YAML.parse(data.toString("utf8")) ?? {};
  for (const key of ["memory", "mnemopi"]) delete value[key];
  return Buffer.from(Bun.YAML.stringify(value, null, 2) + "\n");
};
const seen = new Set();
for (const entry of [...manifest.files, ...manifest.config]) {
  if (!safe(entry.from) || seen.has(entry.from)) throw new Error("Unsafe OMP manifest path");
  seen.add(entry.from);
  if (!files.has(root + "/" + entry.from)) throw new Error("OMP archive is missing " + entry.from);
  const data = await read(root + "/" + entry.from);
  write(path.join(output, entry.from), configs.has(entry.from) ? strip(data) : data);
}
for (const entry of manifest.vscode?.files ?? []) {
  if (!safe(entry.from) || !safe(entry.to)) throw new Error("Unsafe OMP bootstrap path");
  if (!files.has(root + "/" + entry.from)) throw new Error("OMP archive is missing " + entry.from);
  write(path.join(output, ".bootstrap", entry.to), await read(root + "/" + entry.from));
}
write(path.join(output, "install.manifest.json"), await read(manifestName));
write(path.join(output, ".revision"), revision + "\n");
console.log(JSON.stringify({ revision }));
`;

function format(template, values = {}) {
	return template.replace(/\{(\w+)\}/g, (all, key) => (key in values ? String(values[key]) : all));
}

function sha256(data) {
	return createHash("sha256").update(data).digest("hex");
}

function canonicalJson(value) {
	if (Array.isArray(value)) return "[" + value.map(canonicalJson).join(",") + "]";
	if (value && typeof value === "object") {
		return "{" + Object.keys(value).sort().map(key => JSON.stringify(key) + ":" + canonicalJson(value[key])).join(",") + "}";
	}
	return JSON.stringify(value);
}

async function sha256File(file) {
	const hash = createHash("sha256");
	for await (const chunk of createReadStream(file)) hash.update(chunk);
	return hash.digest("hex");
}

async function sizeOf(file) {
	try {
		return (await fsp.stat(file)).size;
	} catch (error) {
		if (error.code === "ENOENT") return -1;
		throw error;
	}
}

async function readText(file) {
	try {
		return await fsp.readFile(file, "utf8");
	} catch (error) {
		if (error.code === "ENOENT") return null;
		throw error;
	}
}

async function writeFileAtomic(target, data) {
	const temp = target + "." + randomUUID() + ".tmp";
	await fsp.writeFile(temp, data);
	await fsp.rename(temp, target);
}

function bashQuote(value) {
	return "'" + value.replace(/'/g, "'\\''") + "'";
}

function psQuote(value) {
	return "'" + value.replace(/'/g, "''") + "'";
}

function envGet(env, name) {
	return Object.keys(env)
		.filter(key => key.toUpperCase() === name.toUpperCase())
		.map(key => env[key])
		.find(value => value);
}

function envSet(env, name, value) {
	for (const key of Object.keys(env)) {
		if (key.toUpperCase() === name.toUpperCase()) delete env[key];
	}
	env[name] = value;
}

// Zip entry reader: the Bun release ships a zip and the extension host has no unzip API.
function zipEntry(buffer, name) {
	let end = -1;
	for (let offset = buffer.length - 22; offset >= 0 && offset > buffer.length - 65558; offset--) {
		if (buffer.readUInt32LE(offset) === 0x06054b50) {
			end = offset;
			break;
		}
	}
	if (end < 0) throw new Error(format(messages.extract, { reason: "no end record" }));
	const count = buffer.readUInt16LE(end + 10);
	let offset = buffer.readUInt32LE(end + 16);
	for (let index = 0; index < count; index++) {
		if (buffer.readUInt32LE(offset) !== 0x02014b50) throw new Error(format(messages.extract, { reason: "central directory" }));
		const method = buffer.readUInt16LE(offset + 10);
		const compressed = buffer.readUInt32LE(offset + 20);
		const size = buffer.readUInt32LE(offset + 24);
		const nameLength = buffer.readUInt16LE(offset + 28);
		const extraLength = buffer.readUInt16LE(offset + 30);
		const commentLength = buffer.readUInt16LE(offset + 32);
		const local = buffer.readUInt32LE(offset + 42);
		const entry = buffer.toString("utf8", offset + 46, offset + 46 + nameLength);
		if (entry === name) {
			if (buffer.readUInt32LE(local) !== 0x04034b50) throw new Error(format(messages.extract, { reason: "local header" }));
			const start = local + 30 + buffer.readUInt16LE(local + 26) + buffer.readUInt16LE(local + 28);
			const raw = buffer.subarray(start, start + compressed);
			const data = method === 0 ? Buffer.from(raw) : inflateRawSync(raw);
			if (data.length !== size) throw new Error(format(messages.extract, { reason: name }));
			return data;
		}
		offset += 46 + nameLength + extraLength + commentLength;
	}
	throw new Error(format(messages.extract, { reason: name }));
}

// Pinned runtime files

function runtimeId() {
	return sha256(Buffer.from(canonicalJson(runtime)));
}

function runtimePaths(dir, id = runtimeId()) {
	return {
		id,
		dir,
		omp: path.join(dir, runtime.assets.omp.file),
		bun: path.join(dir, runtime.assets.bun.file),
		model: path.join(dir, runtime.assets.model.file),
		llama: path.join(dir, "llama"),
	};
}

function curlBinary() {
	const system = process.env.SystemRoot;
	return system ? path.join(system, "System32", "curl.exe") : "curl";
}

async function runProcessBuffered(file, args, input, options = {}) {
	return new Promise((resolve, reject) => {
		const child = spawn(file, args, { windowsHide: true, stdio: ["pipe", "pipe", "pipe"], env: options.env ?? process.env });
		const out = [];
		const err = [];
		child.stdout.on("data", chunk => out.push(chunk));
		child.stderr.on("data", chunk => err.push(chunk));
		child.on("error", reject);
		child.on("close", code => {
			if (code !== 0) {
				reject(new Error(Buffer.concat(err).toString("utf8").trim() || format(messages.installFailed, { reason: "exit " + code })));
				return;
			}
			resolve(Buffer.concat(out));
		});
		child.stdin.end(input ?? "");
	});
}

// Node's fetch ignores `http.proxy`; curl follows it, including CONNECT tunnels.
// curl reads the proxy from the environment, so credentials never reach argv.
function curlEnv(proxy) {
	const env = { ...process.env };
	for (const name of ["HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY"]) envSet(env, name, proxy);
	return env;
}

// Small answers (API lookups) travel as a buffered response.
// Headers passed here must not carry credentials: curl gets them as arguments.
function proxiedRequest(proxy, { insecure = false, run = runProcessBuffered } = {}) {
	const env = curlEnv(proxy);
	return async (url, init = {}) => {
		const args = ["--fail", "--silent", "--show-error", "--location"];
		if (insecure) args.push("--insecure");
		for (const [name, value] of Object.entries(init.headers ?? {})) args.push("--header", name + ": " + value);
		args.push(url);
		return new Response(await run(curlBinary(), args, undefined, { env }), { status: 200 });
	};
}

// Large assets stream straight to the target file, never through memory.
function curlTransport(proxy, { insecure = false, run = runProcessBuffered } = {}) {
	const env = curlEnv(proxy);
	return async (url, file) => {
		const args = ["--fail", "--silent", "--show-error", "--location", "--output", file];
		if (insecure) args.push("--insecure");
		args.push(url);
		await run(curlBinary(), args, undefined, { env });
	};
}

async function downloadAsset(url, temporary, { request = fetch, curl } = {}) {
	if (curl) {
		await curl(url, temporary);
		return;
	}
	const response = await request(url);
	if (!response.ok || !response.body) throw new Error(format(messages.download, { status: response.status }));
	await pipeline(Readable.fromWeb(response.body), createWriteStream(temporary, { flags: "wx" }));
}

async function verifyFile(file, asset) {
	const size = await sizeOf(file);
	if (asset.size !== undefined && size !== asset.size) throw new Error(format(messages.checksum, { file: path.basename(asset.file ?? file) }));
	if ((await sha256File(file)) !== asset.sha256) throw new Error(format(messages.checksum, { file: path.basename(asset.file ?? file) }));
}

async function fetchRuntime(file, asset, request = fetch, options = {}) {
	const size = await sizeOf(file);
	if (size >= 0 && (asset.size === undefined || size === asset.size) && (await sha256File(file)) === asset.sha256) return "cached";
	await fsp.mkdir(path.dirname(file), { recursive: true });
	const temporary = file + "." + randomUUID() + ".tmp";
	try {
		await downloadAsset(asset.url, temporary, options.curl ? { curl: options.curl } : { request });
		await verifyFile(temporary, asset);
		await fsp.rename(temporary, file);
		return "downloaded";
	} finally {
		await fsp.rm(temporary, { force: true });
	}
}

async function fetchBytes(asset, request = fetch, options = {}) {
	const temporary = path.join(os.tmpdir(), "ompcli-" + randomUUID() + ".tmp");
	try {
		await downloadAsset(asset.url, temporary, options.curl ? { curl: options.curl } : { request });
		await verifyFile(temporary, asset);
		return await fsp.readFile(temporary);
	} finally {
		await fsp.rm(temporary, { force: true });
	}
}

async function copyBundle(extensionPath, dir) {
	const source = path.join(extensionPath, "runtime", "llama");
	const target = path.join(dir, "llama");
	const files = { ...runtime.llama.files, ...runtime.vc.files };
	await fsp.mkdir(target, { recursive: true });
	for (const [name, expected] of Object.entries(files)) {
		assertRelative(name);
		const data = await fsp.readFile(path.join(source, name)).catch(() => null);
		if (!data || sha256(data) !== expected) throw new Error(format(messages.checksum, { file: name }));
		await writeFileAtomic(path.join(target, name), data);
	}
}

async function verifyRuntime(dir) {
	const files = [
		[path.join(dir, runtime.assets.omp.file), runtime.assets.omp.sha256],
		[path.join(dir, runtime.assets.model.file), runtime.assets.model.sha256],
		[path.join(dir, runtime.assets.bun.file), runtime.assets.bun.unpacked],
		...Object.entries({ ...runtime.llama.files, ...runtime.vc.files }).map(([name, hash]) => [path.join(dir, "llama", name), hash]),
	];
	const hashes = await Promise.all(files.map(([file]) => sha256File(file).catch(() => null)));
	return hashes.every((hash, index) => hash === files[index][1]);
}

async function ensureRuntime({ extensionPath, storageDir, request = fetch, curl, progress = () => {} }) {
	const id = runtimeId();
	const dir = path.join(storageDir, "runtime", id);
	const ready = path.join(dir, ".ready");
	if ((await readText(ready))?.trim() === id && (await verifyRuntime(dir))) return runtimePaths(dir, id);
	await fsp.rm(ready, { force: true });
	await fsp.mkdir(dir, { recursive: true });
	for (const name of ["omp", "model"]) {
		const asset = runtime.assets[name];
		progress({ name, size: Math.round(asset.size / 1048576) });
		await fetchRuntime(path.join(dir, asset.file), asset, request, { curl });
	}
	progress({ name: "bun", size: Math.round(runtime.assets.bun.size / 1048576) });
	const archive = await fetchBytes(runtime.assets.bun, request, { curl });
	const bun = zipEntry(archive, runtime.assets.bun.entry);
	if (bun.length !== runtime.assets.bun.unpackedSize || sha256(bun) !== runtime.assets.bun.unpacked) throw new Error(format(messages.checksum, { file: runtime.assets.bun.file }));
	await writeFileAtomic(path.join(dir, runtime.assets.bun.file), bun);
	await copyBundle(extensionPath, dir);
	await writeFileAtomic(ready, id + "\n");
	return runtimePaths(dir, id);
}

// Harness installation: explicit manifest, leaf config merge, journaled replacement.

function assertRelative(value) {
	if (typeof value !== "string" || !value) throw new Error(format(messages.path, { value: String(value) }));
	if (!/^[^\\:\0]+$/.test(value)) throw new Error(format(messages.path, { value }));
	const parts = value.split("/");
	if (parts.some(part => !part || part === "." || part === "..")) throw new Error(format(messages.path, { value }));
	return value;
}

function inside(root, relative) {
	assertRelative(relative);
	const base = path.resolve(root);
	const target = path.resolve(base, relative);
	if (target !== base && !target.startsWith(base + path.sep)) throw new Error(format(messages.path, { value: relative }));
	return target;
}

function yamlApi() {
	const api = globalThis.Bun?.YAML;
	if (!api) throw new Error(format(messages.manifest, { reason: "Bun YAML is required" }));
	return api;
}

function mergeLeaf(base, patch, missingOnly) {
	if (!patch || typeof patch !== "object" || Array.isArray(patch)) return patch;
	const result = base && typeof base === "object" && !Array.isArray(base) ? { ...base } : {};
	for (const [key, value] of Object.entries(patch)) {
		if (value && typeof value === "object" && !Array.isArray(value)) {
			result[key] = mergeLeaf(result[key], value, missingOnly);
		} else if (!missingOnly || result[key] === undefined) {
			result[key] = value;
		}
	}
	return result;
}

async function readManifest(sourceDir) {
	let manifest;
	try {
		manifest = JSON.parse(await fsp.readFile(path.join(sourceDir, "install.manifest.json"), "utf8"));
	} catch (error) {
		throw new Error(format(messages.manifest, { reason: error.message }));
	}
	if (!manifest || manifest.version !== 1 || !Array.isArray(manifest.files) || !Array.isArray(manifest.config)) {
		throw new Error(format(messages.manifest, { reason: "structure" }));
	}
	return manifest;
}

async function configTarget(agentDir) {
	for (const name of ["config.yml", "config.yaml"]) {
		const file = path.join(agentDir, name);
		if (await readText(file) !== null) return file;
	}
	return path.join(agentDir, "config.yml");
}

async function planInstall(manifest, sourceDir, agentDir, configFile) {
	const writes = [];
	const targets = new Set();
	for (const entry of manifest.files) {
		assertRelative(entry.from);
		const target = inside(agentDir, entry.to);
		if (targets.has(target)) throw new Error(format(messages.manifest, { reason: entry.to }));
		targets.add(target);
		const source = inside(sourceDir, entry.from);
		const stat = await fsp.lstat(source).catch(error => (error.code === "ENOENT" ? null : Promise.reject(error)));
		if (!stat?.isFile()) throw new Error(format(messages.manifest, { reason: entry.from }));
		writes.push({ source, target });
	}
	if (manifest.config.length) {
		for (const entry of manifest.config) {
			assertRelative(entry.from);
			if (entry.to !== "config.yml" && entry.to !== "config.yaml") throw new Error(format(messages.manifest, { reason: entry.to }));
			if (entry.mode !== "merge" && entry.mode !== "merge-missing") throw new Error(format(messages.manifest, { reason: String(entry.mode) }));
		}
		writes.push({ config: manifest.config, target: configFile });
	}
	return writes;
}

async function assertPlain(root, target) {
	const base = path.resolve(root);
	const parts = path.relative(base, target).split(path.sep).slice(0, -1);
	let current = base;
	for (const part of parts) {
		current = path.join(current, part);
		const stat = await fsp.lstat(current).catch(error => (error.code === "ENOENT" ? null : Promise.reject(error)));
		if (!stat) return;
		if (stat.isSymbolicLink()) throw new Error(format(messages.path, { value: current }));
		if (!stat.isDirectory()) throw new Error(format(messages.path, { value: current }));
	}
	const stat = await fsp.lstat(target).catch(error => (error.code === "ENOENT" ? null : Promise.reject(error)));
	if (stat?.isSymbolicLink()) throw new Error(format(messages.path, { value: target }));
}

async function mergeConfig(manifest, sourceDir, target) {
	const api = yamlApi();
	let base = {};
	try {
		const text = await fsp.readFile(target, "utf8");
		base = api.parse(text) ?? {};
	} catch (error) {
		if (error.code !== "ENOENT") throw new Error(format(messages.config, { path: target }));
	}
	if (!base || typeof base !== "object" || Array.isArray(base)) throw new Error(format(messages.config, { path: target }));
	let next = base;
	for (const entry of manifest.config) {
		const source = inside(sourceDir, entry.from);
		let patch;
		try {
			patch = api.parse(await fsp.readFile(source, "utf8"));
		} catch {
			throw new Error(format(messages.config, { path: source }));
		}
		if (!patch || typeof patch !== "object" || Array.isArray(patch)) throw new Error(format(messages.config, { path: source }));
		next = mergeLeaf(next, patch, entry.mode === "merge-missing");
	}
	return api.stringify(next, null, 2);
}

async function pendingChanges(writes, manifest, sourceDir, pointer) {
	const files = [];
	let config = null;
	for (const write of writes) {
		if (write.config) {
			const text = await mergeConfig(manifest, sourceDir, write.target);
			if ((await readText(write.target)) !== text) config = { target: write.target, text };
		} else {
			const [next, current] = await Promise.all([fsp.readFile(write.source), fsp.readFile(write.target).catch(() => null)]);
			if (!current || Buffer.compare(next, current) !== 0) files.push(write);
		}
	}
	if (pointer && (await readText(pointer.target)) !== pointer.text) files.push({ target: pointer.target, text: pointer.text });
	return { files, config };
}

function planPointer(pointer) {
	if (!pointer) return null;
	if (typeof pointer.file !== "string" || !path.isAbsolute(pointer.file) || path.basename(pointer.file) !== "current.json") {
		throw new Error(format(messages.path, { value: String(pointer.file) }));
	}
	if (typeof pointer.text !== "string") throw new Error(format(messages.path, { value: "pointer" }));
	return { target: pointer.file, text: pointer.text };
}

async function recover(agentDir, payloadRoot) {
	await fsp.mkdir(agentDir, { recursive: true });
	await rollback(agentDir, payloadRoot);
}

async function rollback(agentDir, payloadRoot) {
	const root = path.resolve(agentDir);
	if ((await fsp.lstat(root).catch(() => null))?.isSymbolicLink()) throw new Error(format(messages.path, { value: root }));
	const base = path.join(root, BACKUP_DIR);
	const journalPath = path.join(base, "journal.json");
	let journal;
	try {
		journal = JSON.parse(await fsp.readFile(journalPath, "utf8"));
	} catch (error) {
		if (error.code === "ENOENT") return false;
		throw error;
	}
	let failed = null;
	for (const entry of [...(journal.entries ?? [])].reverse()) {
		let target;
		let validated = false;
		try {
			if (typeof entry.path !== "string" || !path.isAbsolute(entry.path)) throw new Error("path");
			target = path.resolve(entry.path);
			if (entry.pointer) {
				if (!payloadRoot || path.basename(target) !== "current.json" || !isInside(path.resolve(payloadRoot), target)) throw new Error("path");
			} else if (!isInside(root, target)) throw new Error("path");
			await assertNoLinks(entry.pointer ? path.dirname(path.resolve(payloadRoot)) : root, target);
			validated = true;
			if (entry.existed) {
				const backup = path.resolve(entry.backup ?? "");
				if (!backup.startsWith(base + path.sep)) throw new Error("backup");
				await fsp.mkdir(path.dirname(target), { recursive: true });
				await fsp.copyFile(backup, target);
			} else {
				await fsp.rm(target, { force: true });
			}
		} catch {
			if (!entry.pointer || validated) failed ??= entry.path;
		}
	}
	if (failed) throw new Error(format(messages.backup, { path: failed }));
	await fsp.rm(journalPath, { force: true });
	if (typeof journal.id === "string" && /^[a-f0-9-]{36}$/.test(journal.id)) await fsp.rm(path.join(base, journal.id), { recursive: true, force: true });
	return true;
}

function isInside(root, target, api = path) {
	const relative = api.relative(root, target);
	return relative === "" || (!api.isAbsolute(relative) && !relative.startsWith("..") && !relative.startsWith(".." + api.sep));
}

async function assertNoLinks(base, target) {
	let current = path.parse(target).root === base ? base : path.resolve(base);
	const top = await fsp.lstat(current).catch(() => null);
	if (top?.isSymbolicLink()) throw new Error("link");
	const parts = path.relative(current, target).split(path.sep);
	for (const part of parts) {
		current = path.join(current, part);
		const stat = await fsp.lstat(current).catch(() => null);
		if (!stat) return;
		if (stat.isSymbolicLink()) throw new Error("link");
	}
}

async function planHarness({ sourceDir, agentDir }) {
	const root = path.resolve(agentDir);
	const manifest = await readManifest(sourceDir);
	const configFile = await configTarget(root);
	const writes = await planInstall(manifest, sourceDir, root, configFile);
	return pendingChanges(writes, manifest, sourceDir);
}

async function applyHarness({ sourceDir, agentDir, revision, pointer, payloadRoot }) {
	if (!REVISION.test(revision ?? "")) throw new Error(format(messages.manifest, { reason: "revision" }));
	const root = path.resolve(agentDir);
	await fsp.mkdir(root, { recursive: true });
	if ((await fsp.lstat(root)).isSymbolicLink()) throw new Error(format(messages.path, { value: root }));
	await rollback(root, payloadRoot ?? path.dirname(pointer?.file ?? ""));
	const manifest = await readManifest(sourceDir);
	const configFile = await configTarget(root);
	const writes = await planInstall(manifest, sourceDir, root, configFile);
	for (const write of writes) await assertPlain(root, write.target);
	const pointerTarget = planPointer(pointer);
	const changes = await pendingChanges(writes, manifest, sourceDir, pointerTarget);
	if (!changes.files.length && !changes.config) return { revision, changed: false };
	const base = path.join(root, BACKUP_DIR);
	const id = randomUUID();
	const backupDir = path.join(base, id);
	await fsp.mkdir(backupDir, { recursive: true });
	const entries = [];
	const all = [...changes.files, ...(changes.config ? [{ target: changes.config.target }] : [])];
	for (const [index, change] of all.entries()) {
		const backup = path.join(backupDir, String(index));
		let existed = true;
		try {
			await fsp.copyFile(change.target, backup);
		} catch (error) {
			if (error.code !== "ENOENT") throw error;
			existed = false;
		}
		entries.push({ path: change.target, existed, backup: existed ? backup : null, pointer: change.text !== undefined });
	}
	const journalPath = path.join(base, "journal.json");
	await fsp.writeFile(journalPath + ".tmp", JSON.stringify({ id, entries }));
	await fsp.rename(journalPath + ".tmp", journalPath);
	try {
		for (const file of changes.files) {
			await fsp.mkdir(path.dirname(file.target), { recursive: true });
			const inside = file.text === undefined;
			if (inside) await assertPlain(root, file.target);
			else if ((await fsp.lstat(file.target).catch(() => null))?.isSymbolicLink()) throw new Error(format(messages.path, { value: file.target }));
			await writeFileAtomic(file.target, file.text === undefined ? await fsp.readFile(file.source) : file.text);
		}
		if (changes.config) await writeFileAtomic(changes.config.target, changes.config.text);
	} catch (error) {
		await rollback(root, payloadRoot ?? path.dirname(pointer?.file ?? ""));
		throw error;
	}
	await fsp.rm(journalPath, { force: true });
	await fsp.rm(backupDir, { recursive: true, force: true });
	await fsp.rmdir(base).catch(() => {});
	return { revision, changed: true };
}

// Leases: one install per agent directory, one record per window with an open tab.

function leaseName(agentDir) {
	const key = createHash("sha256").update(path.resolve(agentDir).replace(/\\/g, "/").toLowerCase()).digest("hex");
	return process.platform === "win32"
		? "\\\\.\\pipe\\arqawa-ompcli-install-" + key
		: path.join(os.tmpdir(), "arqawa-ompcli-install-" + key + ".sock");
}

async function withInstallLease(agentDir, action, sockets = net) {
	const server = sockets.createServer(socket => socket.destroy());
	await new Promise((resolve, reject) => {
		server.once("error", error => {
			server.removeListener("listening", listening);
			reject(error.code === "EADDRINUSE" ? new Error(messages.busy) : error);
		});
		const listening = () => {
			server.removeListener("error", reject);
			resolve();
		};
		server.once("listening", listening);
		server.listen(leaseName(agentDir));
	});
	try {
		return await action();
	} finally {
		await new Promise(resolve => server.close(resolve));
	}
}

function isAlive(pid) {
	try {
		process.kill(pid, 0);
		return true;
	} catch (error) {
		return error.code !== "ESRCH";
	}
}

function leasesDir(storageDir) {
	return path.join(storageDir, "leases");
}

async function tabLeases(storageDir, pid = process.pid) {
	const dir = leasesDir(storageDir);
	const names = await fsp.readdir(dir).catch(() => []);
	const live = [];
	for (const name of names) {
		const match = /^(\d+)\.json$/.exec(name);
		if (!match) continue;
		const owner = Number(match[1]);
		const file = path.join(dir, name);
		if (owner === pid || isAlive(owner)) {
			let revision = null;
			try {
				revision = JSON.parse(await fsp.readFile(file, "utf8")).revision ?? null;
			} catch {
				revision = null;
			}
			live.push({ pid: owner, revision });
		} else {
			await fsp.rm(file, { force: true });
		}
	}
	return live;
}

async function openTabLease(storageDir, revision, pid = process.pid) {
	const dir = leasesDir(storageDir);
	await fsp.mkdir(dir, { recursive: true });
	await writeFileAtomic(path.join(dir, pid + ".json"), JSON.stringify({ pid, revision }) + "\n");
}

async function closeTabLease(storageDir, pid = process.pid) {
	await fsp.rm(path.join(leasesDir(storageDir), pid + ".json"), { force: true });
}

// Payload selection for the harness files

function payloadBase(storageDir, version) {
	return path.join(storageDir, "payload", version);
}

async function payloadRevision(sourceDir) {
	const text = ((await readText(path.join(sourceDir, ".revision"))) ?? "").trim();
	if (!REVISION.test(text)) throw new Error(messages.revision);
	return text;
}

async function selectPayload({ extensionPath, storageDir, version }) {
	const base = payloadBase(storageDir, version);
	const pointer = path.join(base, "current.json");
	const raw = await readText(pointer);
	if (raw === null) return path.join(extensionPath, "payload");
	let value;
	try {
		value = JSON.parse(raw);
	} catch {
		throw new Error(format(messages.pointer, { path: pointer }));
	}
	if (typeof value !== "string" || !REVISION.test(value)) throw new Error(format(messages.pointer, { path: pointer }));
	return path.join(base, value);
}

// Local embeddings: one llama.cpp server per extension host.

function allocatePort() {
	return new Promise((resolve, reject) => {
		const server = net.createServer();
		server.once("error", reject);
		server.listen(0, "127.0.0.1", () => {
			const { port } = server.address();
			server.close(() => resolve(port));
		});
	});
}

function memoryArgs({ model, port }) {
	return [
		"--model", model,
		"--embeddings", "--pooling", "mean",
		"--ctx-size", "8192",
		"--batch-size", "8192", "--ubatch-size", "8192",
		"--parallel", "1", "--threads", "2",
		"--host", "127.0.0.1", "--port", String(port),
		"--alias", MEMORY_MODEL,
		"--no-webui",
	];
}

function createMemory(options = {}) {
	const runtimeDir = options.runtimeDir;
	const request = options.request ?? fetch;
	const spawnProcess = options.spawnProcess ?? spawn;
	const sleep = options.sleep ?? (ms => new Promise(resolve => setTimeout(resolve, ms)));
	const attempts = options.attempts ?? 120;
	const intervalMs = options.intervalMs ?? 500;
	const dimensions = options.dimensions ?? MEMORY_DIM;
	const allocate = options.allocate ?? allocatePort;
	let pending = null;
	let state = null;
	let generation = 0;

	async function acquire() {
		for (let attempt = 1; attempt <= 3; attempt++) {
			try {
				return await allocate();
			} catch (error) {
				if (error.code !== "EADDRINUSE" || attempt === 3) throw error;
			}
		}
	}

	async function start() {
		const id = ++generation;
		for (let attempt = 1; ; attempt++) {
			try {
				return await attemptStart(id);
			} catch (error) {
				if (id !== generation || attempt >= 3 || !error.retry) throw error;
			}
		}
	}

	async function attemptStart(id) {
		const port = await acquire();
		if (id !== generation) throw new Error(messages.memoryStopped);
		const key = randomBytes(32).toString("hex");
		const child = spawnProcess(path.join(runtimeDir, "llama", "llama-server.exe"), memoryArgs({ model: path.join(runtimeDir, runtime.assets.model.file), port }), {
			cwd: path.join(runtimeDir, "llama"),
			env: { ...process.env, LLAMA_API_KEY: key },
			windowsHide: true,
			stdio: "ignore",
		});
		state = { child, port, key };
		let failure = null;
		let fail;
		const death = new Promise((resolve, reject) => {
			fail = reject;
		});
		death.catch(() => {});
		const die = error => {
			error.retry = true;
			failure ??= error;
			fail(error);
		};
		child.once("exit", code => die(new Error(format(messages.memoryExit, { code }))));
		child.once("error", die);
		const stop = () => {
			if (failure) throw failure;
		};
		const health = `http://127.0.0.1:${port}/health`;
		let healthy = false;
		try {
			for (let attempt = 0; attempt < attempts; attempt++) {
				stop();
				let response;
				try {
					response = await Promise.race([request(health, { signal: AbortSignal.timeout(1000) }), death]);
				} catch (error) {
					stop();
					await Promise.race([sleep(intervalMs), death]);
					continue;
				}
				stop();
				if (response.ok) {
					healthy = true;
					break;
				}
				if (response.status !== 503) throw new Error(format(messages.memoryHealth, { status: response.status }));
				if (attempt === attempts - 1) break;
				await Promise.race([sleep(intervalMs), death]);
			}
			if (!healthy) throw new Error(format(messages.memoryTimeout, { seconds: Math.round((attempts * intervalMs) / 1000) }));
			stop();
			for (const text of ["память", "project memory"]) await probe(port, key, text);
			child.once("exit", code => {
				if (id === generation) options.onExit?.(code);
			});
			return { port, key, child };
		} catch (error) {
			try {
				child.kill();
			} catch {}
			if (state?.child === child) state = null;
			throw error;
		}

		async function probe(target, secret, text) {
			const response = await request(`http://127.0.0.1:${target}/v1/embeddings`, {
				method: "POST",
				headers: { "content-type": "application/json", authorization: "Bearer " + secret },
				body: JSON.stringify({ model: MEMORY_MODEL, input: text }),
				signal: AbortSignal.timeout(5000),
			});
			if (!response.ok) throw new Error(format(messages.memoryHealth, { status: response.status }));
			const body = await response.json();
			const vectors = body?.data;
			const vector = Array.isArray(vectors) && vectors.length === 1 ? vectors[0]?.embedding : null;
			const size = Array.isArray(vector) ? vector.length : 0;
			const finite = Array.isArray(vector) && vector.every(value => typeof value === "number" && Number.isFinite(value));
			if (size !== dimensions || !finite) throw new Error(format(messages.memoryDims, { size, expected: dimensions }));
			return vector;
		}
	}

	return {
		ensure() {
			if (pending) return pending;
			const guarded = start().catch(error => {
				if (pending === guarded) pending = null;
				throw error;
			});
			pending = guarded;
			return guarded;
		},
		stop() {
			generation++;
			if (state) {
				try {
					state.child.kill();
				} catch {}
			}
			state = null;
			pending = null;
		},
		get port() {
			return state?.port;
		},
		get key() {
			return state?.key;
		},
	};
}

function overlayYaml({ port, key }) {
	return [
		"memory:",
		"  backend: mnemopi",
		"mnemopi:",
		"  noEmbeddings: false",
		"  embeddingModel: " + MEMORY_MODEL,
		"  embeddingApiUrl: http://127.0.0.1:" + port + "/v1",
		"  embeddingApiKey: " + key,
		"",
	].join("\n");
}

async function writeOverlay({ storageDir, pid = process.pid, id = randomUUID(), port, key }) {
	const dir = path.join(storageDir, "runs", pid + "-" + id);
	await fsp.mkdir(dir, { recursive: true });
	const file = path.join(dir, "memory.yml");
	await writeFileAtomic(file, overlayYaml({ port, key }));
	return { dir, file, port };
}

// Child environment: proxy, bundled tools, overlay, embedding dimensions.

function configFiles(overlay, base) {
	const previous = envGet(base, "PI_CONFIG_FILES");
	return [previous, overlay].filter(Boolean).join(";");
}

function createEnv({ base = process.env, proxy, proxyStrictSSL, paths, overlay }) {
	const env = { ...base };
	const value = typeof proxy === "string" ? proxy.trim() : "";
	if (value) {
		envSet(env, "HTTP_PROXY", value);
		envSet(env, "HTTPS_PROXY", value);
	}
	if (proxyStrictSSL === false) envSet(env, "NODE_TLS_REJECT_UNAUTHORIZED", "0");
	if (value && !envGet(env, "PI_PROXY")) envSet(env, "PI_PROXY", value);
	const key = Object.keys(env).find(name => name.toUpperCase() === "PATH") || "PATH";
	env[key] = [path.dirname(paths.omp), env[key]].filter(Boolean).join(path.delimiter);
	env.MNEMOPI_EMBEDDING_DIM = String(MEMORY_DIM);
	env.MNEMOPI_EMBEDDING_BATCH_SIZE = "1";
	env.MNEMOPI_EMBEDDING_MODEL = MEMORY_MODEL;
	const files = configFiles(overlay.file, base);
	envSet(env, "PI_CONFIG_FILES", files);
	envSet(env, "OMPCLI_CONFIG_FILES", files);
	return env;
}

// Both tabs restore the managed environment after the user profile, and the
// chat tab starts OMP from the same wrapper. Proxy values arrive as OMPCLI_*
// environment variables, never in the command line.
function shellRc({ overlay, paths, home, chat }) {
	const lines = [
		"[ -f ~/.bashrc ] && . ~/.bashrc",
		"unset http_proxy https_proxy all_proxy no_proxy",
		...PROXY_VARS.map(name => '[ -n "$OMPCLI_' + name + '" ] && export ' + name + '="$OMPCLI_' + name + '"'),
		'export PATH="$(cygpath -u "$OMPCLI_RUNTIME"):$PATH"',
		'export PI_CONFIG_FILES="$OMPCLI_CONFIG_FILES"',
	];
	if (chat) {
		lines.push("exec " + bashQuote(paths.omp.replace(/\\/g, "/")) + " --config " + bashQuote(overlay.file) + (home ? " --allow-home" : ""));
	}
	return lines.join("\n") + "\n";
}

function bashCommand(bash, rcFile) {
	const inner = "unset http_proxy https_proxy all_proxy no_proxy; exec bash --rcfile " + bashQuote(rcFile.replace(/\\/g, "/")) + " -i";
	return "& " + bashQuote(bash) + " --login -i -c " + psQuote(inner);
}

function resolveAgentDir(env, homedir) {
	const profile = envGet(env, "OMP_PROFILE") ?? envGet(env, "PI_PROFILE");
	if (typeof profile === "string" && profile.trim() && profile.trim() !== "default") throw new Error(messages.profile);
	return envGet(env, "PI_CODING_AGENT_DIR") || path.join(homedir, ".omp", "agent");
}

// Update: pinned commit of this repository, payload selected once per run.

async function runProcess(file, args, input, options) {
	return (await runProcessBuffered(file, args, input, options)).toString("utf8");
}

function spawnInstaller({ bun, sourceDir, agentDir, revision, lease, guard, pointer, payloadRoot }) {
	return runProcess(bun, [__filename, "--install"], JSON.stringify({ sourceDir, agentDir, revision, lease, guard, pointer, payloadRoot })).then(text => JSON.parse(text));
}

async function extractArchive({ bun, archive, stage, revision, script }) {
	await writeFileAtomic(script, EXTRACT_SCRIPT);
	const text = await runProcess(bun, [script, archive, stage, revision]);
	return JSON.parse(text).revision;
}

function createUpdater(deps) {
	const request = deps.request ?? fetch;
	const storageDir = deps.storageDir;
	const version = deps.version;
	const builtIn = deps.builtIn;
	const script = path.join(storageDir, "extract.js");
	const extract = deps.extract ?? (args => extractArchive({ ...args, bun: deps.bun, script }));
	const apply = deps.apply ?? spawnInstaller;
	const lease = deps.lease ?? withInstallLease;
	const tabs = deps.tabs ?? tabLeases;
	let pending = null;

	async function compareBootstrap(stage, extensionPath, manifest) {
		for (const entry of manifest.vscode?.files ?? []) {
			const next = await fsp.readFile(inside(stage, ".bootstrap/" + entry.to));
			const current = await fsp.readFile(inside(extensionPath, entry.to)).catch(() => null);
			if (!current || Buffer.compare(next, current) !== 0) throw new Error(format(messages.rewritten, { marketplace: messages.marketplace }));
		}
	}

	async function perform() {
		await fsp.mkdir(storageDir, { recursive: true });
		const lookup = await request("https://api.github.com/repos/ARQAWA/omp-lite/commits/main", {
			headers: { accept: "application/vnd.github+json", "user-agent": "arqawa-ompcli" },
		});
		if (!lookup.ok) throw new Error(format(messages.updateLookup, { status: lookup.status }));
		const { sha } = await lookup.json();
		if (typeof sha !== "string" || !REVISION.test(sha)) throw new Error(format(messages.revision, {}));
		const current = (await readText(path.join(builtIn, ".revision"))) ?? "";
		if (current.trim() === sha) return { revision: sha, changed: false };
		const base = payloadBase(storageDir, version);
		const pointer = await readText(path.join(base, "current.json"));
		if (pointer !== null) {
			let value;
			try {
				value = JSON.parse(pointer);
			} catch {
				throw new Error(format(messages.pointer, { path: path.join(base, "current.json") }));
			}
			if (typeof value !== "string" || !REVISION.test(value)) throw new Error(format(messages.pointer, { path: path.join(base, "current.json") }));
			if (value === sha) return { revision: sha, changed: false };
		}
		// A name of its own per attempt: a broken download never blocks the next one.
		const file = path.join(storageDir, "omp-lite-" + sha + "." + randomUUID() + ".tar.gz");
		const stage = path.join(base, sha);
		try {
			await downloadAsset("https://codeload.github.com/ARQAWA/omp-lite/tar.gz/" + sha, file, { request, curl: deps.curl });
			await fsp.rm(stage, { recursive: true, force: true });
			await fsp.mkdir(stage, { recursive: true });
			await extract({ archive: file, stage, revision: sha });
			const manifest = JSON.parse(await fsp.readFile(path.join(stage, "install.manifest.json"), "utf8"));
			await compareBootstrap(stage, deps.extensionPath, manifest);
			await fsp.rm(path.join(stage, ".bootstrap"), { recursive: true, force: true });
		} finally {
			await fsp.rm(file, { force: true });
		}
		const revision = await payloadRevision(stage);
		const result = await lease(deps.agentDir, async () => {
			if ((await tabs(storageDir)).length) throw new Error(messages.closeTabs);
			return apply({
				bun: deps.bun,
				sourceDir: stage,
				agentDir: deps.agentDir,
				revision,
				lease: false,
				pointer: { file: path.join(base, "current.json"), text: JSON.stringify(revision) },
				payloadRoot: path.dirname(base),
			});
		});
		return { revision, changed: true, applied: result?.changed === true };
	}

	return {
		run() {
			if (!pending) pending = perform().finally(() => { pending = undefined; });
			return pending;
		},
	};
}

// VS Code surface

function assertPlatform(platform, arch) {
	if (platform !== "win32" || arch !== "x64") throw new Error(messages.platform);
}

function loadNodePty(vscode) {
	const candidates = [path.join(vscode.env.appRoot, "node_modules.asar", "node-pty"), path.join(vscode.env.appRoot, "node_modules", "node-pty")];
	let last;
	for (const candidate of candidates) {
		try {
			return require(candidate);
		} catch (error) {
			last = error;
		}
	}
	throw new Error(format(messages.nodePty, { path: candidates[0] }));
}

function makePty({ vscode, nodePty, prepare, build, processes, onCancel }) {
	const writeEmitter = new vscode.EventEmitter();
	let proc = null;
	let closed = false;

	async function start(dimensions) {
		// A tab closed while it was loading holds no lease, whether the loading ended well or not.
		const prepared = await prepare(line => writeEmitter.fire(line + "\r\n")).finally(() => closed && onCancel?.());
		if (closed) return;
		const spec = build(prepared);
		const child = nodePty.spawn("powershell.exe", ["-NoLogo", "-NoProfile", "-Command", spec.command], {
			name: "xterm-256color",
			cols: dimensions?.columns ?? 120,
			rows: dimensions?.rows ?? 30,
			cwd: spec.cwd,
			env: spec.env,
		});
		proc = child;
		processes.add(child);
		child.onData(data => writeEmitter.fire(data));
		child.onExit(({ exitCode }) => {
			processes.delete(child);
			if (proc === child) proc = null;
			writeEmitter.fire("\r\n[OMP CLI exited, code " + exitCode + "]\r\n");
		});
		if (closed) {
			try {
				child.kill();
			} catch {}
		}
	}

	return {
		onDidWrite: writeEmitter.event,
		open(dimensions) {
			start(dimensions).catch(error => {
				writeEmitter.fire(error.message + "\r\n");
				void vscode.window.showErrorMessage(error.message);
			});
		},
		handleInput(data) {
			if (proc) proc.write(data);
		},
		setDimensions(dimensions) {
			if (proc) proc.resize(dimensions.columns, dimensions.rows);
		},
		close() {
			closed = true;
			if (proc) {
				try {
					proc.kill();
				} catch {}
			}
		},
	};
}

function createCli(host) {
	const vscode = host.vscode;
	const processes = new Set();
	const terminals = new Set();
	let memory = null;
	let overlay = null;
	let tabs = 0;
	let chatCount = 0;
	let shellCount = 0;
	let leaseTimer = null;

	function workDir() {
		return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? host.homedir;
	}

	function httpSettings() {
		const http = vscode.workspace.getConfiguration("http");
		return { proxy: http.get("proxy"), proxyStrictSSL: http.get("proxyStrictSSL") };
	}

	function assertReady() {
		assertPlatform(host.platform, host.arch);
		const gitBash = host.gitBash ?? GIT_BASH;
		if (!host.existsSync(gitBash)) throw new Error(format(messages.gitBash, { path: gitBash }));
		resolveAgentDir(host.env, host.homedir);
	}

	function transport() {
		if (host.request) return { request: host.request };
		const { proxy, proxyStrictSSL } = httpSettings();
		const value = typeof proxy === "string" ? proxy.trim() : "";
		if (!value) return { request: fetch };
		const options = { insecure: proxyStrictSSL === false };
		return { request: proxiedRequest(value, options), curl: curlTransport(value, options) };
	}

	async function prepare(write) {
		const { request, curl } = transport();
		const control = host.control ?? {};
		const paths = await (control.ensureRuntime ?? ensureRuntime)({
			extensionPath: host.extensionPath,
			storageDir: host.storageDir,
			request,
			curl,
			progress: value => write(format(messages.preparing, value)),
		});
		const agentDir = resolveAgentDir(host.env, host.homedir);
		const install = control.install ?? spawnInstaller;
		const payloadRoot = path.join(host.storageDir, "payload");
		await (host.lease ?? withInstallLease)(agentDir, async () => {
			// A crashed run must be undone before the payload for this tab is chosen.
			await (control.recover ?? recover)(agentDir, payloadRoot);
			const sourceDir = await (control.selectPayload ?? selectPayload)({ extensionPath: host.extensionPath, storageDir: host.storageDir, version: host.version });
			const revision = await (control.payloadRevision ?? payloadRevision)(sourceDir);
			const live = await (control.tabLeases ?? tabLeases)(host.storageDir);
			if (live.some(entry => entry.revision !== revision)) throw new Error(messages.closeTabs);
			await install({ bun: paths.bun, sourceDir, agentDir, revision, lease: false, guard: live.length > 0, payloadRoot });
			await openTabLease(host.storageDir, revision);
		});
		memory ??= (host.memory ?? createMemory)({
			runtimeDir: paths.dir,
			request: host.request ?? fetch,
			onExit: () => {
				memory = null;
				void vscode.window.showErrorMessage(messages.memoryStopped);
			},
		});
		const started = await memory.ensure();
		if (!overlay || overlay.port !== started.port) {
			overlay = await writeOverlay({ storageDir: host.storageDir, port: started.port, key: started.key });
		}
		return { paths, overlay };
	}

	async function runTab(name, kind) {
		assertReady();
		const nodePty = (host.loadPty ?? loadNodePty)(vscode);
		const settings = httpSettings();
		let rcFile = null;
		const pty = makePty({
			vscode,
			nodePty,
			processes,
			onCancel: () => void releaseTabs(),
			prepare: async write => {
				const prepared = await prepare(write);
				rcFile = path.join(host.storageDir, kind + "-" + process.pid + ".sh");
				await fsp.mkdir(host.storageDir, { recursive: true });
				await writeFileAtomic(rcFile, shellRc({ overlay: prepared.overlay, paths: prepared.paths, home: workDir() === host.homedir, chat: kind === "chat" }));
				return prepared;
			},
			build: prepared => {
				const env = createEnv({ base: host.env, proxy: settings.proxy, proxyStrictSSL: settings.proxyStrictSSL, paths: prepared.paths, overlay: prepared.overlay });
				for (const proxy of PROXY_VARS.filter(candidate => envGet(env, candidate))) envSet(env, "OMPCLI_" + proxy, envGet(env, proxy));
				env.OMPCLI_RUNTIME = path.dirname(prepared.paths.omp);
				return { command: bashCommand(host.gitBash ?? GIT_BASH, rcFile), env, cwd: workDir() };
			},
		});
		const terminal = vscode.window.createTerminal({ name, pty, location: { viewColumn: vscode.ViewColumn.Active } });
		terminals.add(terminal);
		tabs++;
		terminal.show();
		return terminal;
	}

	async function releaseTabs() {
		if (tabs) return;
		let removed = false;
		try {
			await (host.lease ?? withInstallLease)(resolveAgentDir(host.env, host.homedir), async () => {
				if (tabs) return;
				await closeTabLease(host.storageDir);
				removed = true;
			});
		} catch (error) {
			if (error.message !== messages.busy) throw error;
		}
		if (tabs) return;
		if (!removed && !leaseTimer) {
			// Another window is writing; try again while this window lives without tabs.
			leaseTimer = setTimeout(() => {
				leaseTimer = null;
				if (!tabs) void releaseTabs();
			}, host.leaseDelay ?? 5000);
		}
		memory?.stop();
		memory = null;
		if (overlay) await fsp.rm(overlay.dir, { recursive: true, force: true });
		overlay = null;
	}

	async function closeTerminal(terminal) {
		terminals.delete(terminal);
		tabs = Math.max(0, tabs - 1);
		await releaseTabs();
	}

	function newTab() {
		return runTab("OMP " + ++chatCount, "chat").catch(error => vscode.window.showErrorMessage(error.message));
	}

	function shellTab() {
		return runTab("OMP terminal " + ++shellCount, "shell").catch(error => vscode.window.showErrorMessage(error.message));
	}

	async function update() {
		assertReady();
		const { request, curl } = transport();
		const paths = await ensureRuntime({ extensionPath: host.extensionPath, storageDir: host.storageDir, request, curl });
		const agentDir = resolveAgentDir(host.env, host.homedir);
		const updater = createUpdater({
			request,
			curl,
			storageDir: host.storageDir,
			version: host.version,
			extensionPath: host.extensionPath,
			builtIn: path.join(host.extensionPath, "payload"),
			agentDir,
			bun: paths.bun,
			apply: host.install ?? spawnInstaller,
		});
		const result = await updater.run();
		if (result.changed) vscode.window.showInformationMessage(messages.updated);
		return result;
	}

	function updateCommand() {
		return vscode.window
			.withProgress({ location: vscode.ProgressLocation.Notification, title: messages.update }, () => update())
			.catch(error => vscode.window.showErrorMessage(format(messages.updateFailed, { reason: error.message })));
	}

	function activate() {
		return [
			vscode.window.onDidChangeActiveTerminal(active => vscode.commands.executeCommand("setContext", "ompcli.terminalActive", terminals.has(active))),
			vscode.window.onDidCloseTerminal(terminal => {
				if (terminals.has(terminal)) void closeTerminal(terminal);
			}),
			vscode.commands.registerCommand("ompcli.newTab", () => newTab()),
			vscode.commands.registerCommand("ompcli.shellTab", () => shellTab()),
			vscode.commands.registerCommand("ompcli.update", () => updateCommand()),
		];
	}

	function dispose() {
		if (leaseTimer) clearTimeout(leaseTimer);
		leaseTimer = null;
		for (const child of [...processes]) {
			try {
				child.kill();
			} catch {}
		}
		processes.clear();
		memory?.stop();
		memory = null;
		if (overlay) void fsp.rm(overlay.dir, { recursive: true, force: true });
		overlay = null;
	}

	return { activate, dispose, newTab, shellTab, update, closeTerminal, prepare };
}

let active = null;

function activate(context) {
	const vscode = require("vscode");
	const host = {
		vscode,
		extensionPath: context.extensionPath,
		storageDir: context.globalStorageUri.fsPath,
		version: context.extension?.packageJSON?.version ?? "0.0.1",
		gitBash: GIT_BASH,
		env: process.env,
		homedir: os.homedir(),
		platform: process.platform,
		arch: process.arch,
		existsSync: file => require("node:fs").existsSync(file),
	};
	active = createCli(host);
	context.subscriptions.push(...active.activate());
}

function deactivate() {
	active?.dispose();
	active = null;
}

async function installMain() {
	const chunks = [];
	for await (const chunk of process.stdin) chunks.push(chunk);
	const input = JSON.parse(Buffer.concat(chunks).toString("utf8"));
	const run = async () => {
		if (input.guard) {
			const changes = await planHarness(input);
			if (changes.files.length || changes.config) throw new Error(messages.closeTabs);
		}
		return applyHarness(input);
	};
	const result = input.lease === false ? await run() : await withInstallLease(input.agentDir, run);
	process.stdout.write(JSON.stringify(result) + "\n");
}

if (require.main === module && process.argv.includes("--install")) {
	installMain().catch(error => {
		process.stderr.write(error.message + "\n");
		process.exitCode = 1;
	});
}

module.exports = {
	activate,
	deactivate,
	applyHarness,
	createCli,
	createEnv,
	curlTransport,
	createMemory,
	createUpdater,
	ensureRuntime,
	extractArchive,
	fetchRuntime,
	installMain,
	isInside,
	recover,
	leaseName,
	makePty,
	memoryArgs,
	openTabLease,
	planHarness,
	closeTabLease,
	overlayYaml,
	payloadRevision,
	proxiedRequest,
	resolveAgentDir,
	runtimeId,
	selectPayload,
	sha256,
	tabLeases,
	verifyRuntime,
	withInstallLease,
	writeOverlay,
	zipEntry,
	canonicalJson,
	messages,
	runtime,
};
