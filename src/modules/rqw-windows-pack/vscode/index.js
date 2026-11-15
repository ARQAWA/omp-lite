"use strict";

// RQW Windows Pack: OMP in VS Code tabs on a Windows VDI. The harness is installed and updated inside the
// extension host. A bundled program starts one way only: node-pty -> PowerShell -> Git Bash -> program.

const { execFile } = require("node:child_process");
const { createHash, randomBytes, randomUUID } = require("node:crypto");
const fs = require("node:fs");
const net = require("node:net");
const os = require("node:os");
const path = require("node:path");
const { promisify } = require("node:util");
const { gunzipSync } = require("node:zlib");
const messages = require("./messages.json");
const pins = require("./runtime.json");

const fsp = fs.promises;
const GIT_BASH = "C:\\Program Files\\Git\\bin\\bash.exe";
const REPO = "ARQAWA/omp-lite";
const MEMORY_MODEL = "embeddinggemma-2:270m-q8_0";
const MEMORY_DIM = 768;
const PROXY_VARS = ["HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY", "NO_PROXY", "PI_PROXY", "NODE_USE_ENV_PROXY", "NODE_TLS_REJECT_UNAUTHORIZED"];
const SHA = /^[a-f0-9]{40}$/;
const BACKUPS = ".ompcli-backups";
// The dictation key (Soniox) lives in this file of the extension storage; the name says nothing on purpose.
const STT_KEY_FILE = "ad591530-694c-42f1-9f01-f03bee4cca1c.txt";

const text = (key, values = {}) => messages[key].replace(/\{(\w+)\}/g, (all, name) => (name in values ? String(values[name]) : all));
const fail = (key, values) => new Error(text(key, values));
const stat = file => fsp.lstat(file).catch(() => null);
const drop = file => fsp.rm(file, { recursive: true, force: true });
const list = dir => fsp.readdir(dir).catch(() => []);
const readText = file => fsp.readFile(file, "utf8").catch(() => null);
// A process that is already gone may refuse the kill.
const kill = proc => {
	try {
		proc?.kill();
	} catch {}
};
const bashQuote = value => "'" + value.replace(/'/g, "'\\''") + "'";
const psQuote = value => "'" + value.replace(/'/g, "''") + "'";
// Git Bash reads a path with forward slashes as it is; doubled backslashes it would fold.
const words = values => values.map(value => bashQuote(value.replace(/\\/g, "/"))).join(" ");
// No double quotes anywhere in the command: PowerShell 5.1 does not hand them on.
const psArgs = (bash, inner) => ["-NoLogo", "-NoProfile", "-Command", "& " + psQuote(bash) + " --login -i -c " + psQuote(inner)];
const envGet = (env, name) => Object.keys(env).filter(key => key.toUpperCase() === name).map(key => env[key]).find(Boolean);

function envSet(env, name, value) {
	for (const key of Object.keys(env)) if (key.toUpperCase() === name) delete env[key];
	env[name] = value;
}

async function sha256File(file) {
	const hash = createHash("sha256");
	for await (const chunk of fs.createReadStream(file)) hash.update(chunk);
	return hash.digest("hex");
}

// Windows antivirus may hold a fresh file for a moment: the rename is repeated for about a second.
async function writeAtomic(target, data) {
	await fsp.mkdir(path.dirname(target), { recursive: true });
	const temp = target + "." + randomUUID() + ".tmp";
	await fsp.writeFile(temp, data);
	for (let attempt = 1; ; attempt++) {
		try {
			return await fsp.rename(temp, target);
		} catch (error) {
			if (attempt === 20 || !["EPERM", "EACCES", "EBUSY"].includes(error.code)) {
				await drop(temp);
				throw error;
			}
			await new Promise(resolve => setTimeout(resolve, 50));
		}
	}
}

// Network. Node's fetch reads neither `http.proxy` nor the proxy environment, so with a proxy everything
// goes through curl.exe from System32: the one program the extension host starts itself.
// curl takes the proxy from its environment: credentials never reach the command line.
function curl(args, env) {
	const file = process.env.SystemRoot ? path.join(process.env.SystemRoot, "System32", "curl.exe") : "curl";
	return promisify(execFile)(file, args, { env, windowsHide: true, maxBuffer: 1 << 24 }).then(result => result.stdout);
}

function transport({ proxy, insecure, request = fetch, run = curl }) {
	if (!proxy) {
		return {
			async json(url, headers) {
				const response = await request(url, { headers });
				if (!response.ok) throw fail("updateLookup", { status: response.status });
				return response.json();
			},
			async download(url, file) {
				const response = await request(url);
				if (!response.ok || !response.body) throw fail("download", { status: response.status });
				await fsp.writeFile(file, response.body);
			},
		};
	}
	const env = { ...process.env };
	for (const name of ["HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY"]) envSet(env, name, proxy);
	const base = ["--fail", "--silent", "--show-error", "--location", ...(insecure ? ["--insecure"] : [])];
	return {
		json: async (url, headers = {}) => JSON.parse(await run([...base, ...Object.entries(headers).flatMap(([name, value]) => ["--header", name + ": " + value]), url], env)),
		download: (url, file) => run([...base, "--retry", "3", "--output", file, url], env),
	};
}

// The model is data: the one thing that is downloaded. It is checked by size and SHA-256 on every start.
async function ensureModel(file, asset, web, write) {
	const good = async target => (await stat(target))?.size === asset.size && (await sha256File(target)) === asset.sha256;
	if (await good(file)) return;
	write(text("preparing", { name: asset.file, size: Math.round(asset.size / 1048576) }));
	const temp = file + "." + randomUUID() + ".tmp";
	try {
		await fsp.mkdir(path.dirname(file), { recursive: true });
		await web.download(asset.url, temp).catch(error => {
			throw fail("asset", { name: asset.file, reason: error.message });
		});
		if (!(await good(temp))) throw fail("checksum", { file: asset.file });
		await fsp.rename(temp, file);
	} finally {
		await drop(temp);
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

// The extension storage keeps a short list of its own; everything else is deleted. A file that
// Windows still holds is left for the next window.
async function sweep(storageDir, version, modelFile, alive = isAlive) {
	const live = name => alive(Number(/\d+/.exec(name)[0]));
	const keep = name => ["model", "payload", "runs", "stt.json", STT_KEY_FILE].includes(name) || (/^shell-\d+\.sh$/.test(name) && live(name));
	const clean = async (dir, own) => {
		for (const name of await list(dir)) if (!own(name)) await drop(path.join(dir, name)).catch(() => {});
	};
	await clean(storageDir, keep);
	await clean(path.join(storageDir, "model"), name => name === modelFile);
	await clean(path.join(storageDir, "payload"), name => name === version);
	await clean(path.join(storageDir, "runs"), name => /^\d+-/.test(name) && live(name));
}

// Harness installation: the explicit manifest, a journaled replacement. The user's config.yml is never
// read or written: the config fragments of the manifest reach OMP as overlay files.

function safe(root, relative) {
	if (typeof relative !== "string" || !/^[^\\:\0]+$/.test(relative) || relative.split("/").some(part => !part || part === "." || part === "..")) {
		throw fail("path", { value: String(relative) });
	}
	return path.join(root, ...relative.split("/"));
}

async function assertNoLinks(root, target) {
	let current = root;
	for (const part of ["", ...path.relative(root, target).split(path.sep)]) {
		current = path.join(current, part);
		const entry = await stat(current);
		if (!entry) return;
		if (entry.isSymbolicLink()) throw fail("path", { value: current });
	}
}

function checkManifest(manifest) {
	if (manifest?.version !== 1 || !Array.isArray(manifest.files) || !Array.isArray(manifest.config)) throw new Error("structure");
	return manifest;
}

async function rollback(agentDir) {
	const base = path.join(agentDir, BACKUPS);
	const journal = await readText(path.join(base, "journal.json"));
	let failed = null;
	// Backups without a journal were never applied.
	for (const entry of journal === null ? [] : JSON.parse(journal).reverse()) {
		try {
			if (entry.backup === null) {
				if (await stat(entry.path)) await fsp.rm(entry.path);
			} else {
				await fsp.mkdir(path.dirname(entry.path), { recursive: true });
				await fsp.copyFile(path.join(base, entry.backup), entry.path);
			}
		} catch {
			failed ??= entry.path;
		}
	}
	// The journal stays until every file is back.
	if (failed) throw fail("backup", { path: failed });
	await drop(base);
}

// Installs one payload. `pointer` is one more file of the same transaction: the revision pointer of Update.
async function installHarness({ sourceDir, agentDir, pointer }) {
	await fsp.mkdir(agentDir, { recursive: true });
	await rollback(agentDir);
	let manifest;
	try {
		manifest = checkManifest(JSON.parse(await fsp.readFile(path.join(sourceDir, "install.manifest.json"), "utf8")));
	} catch (error) {
		throw fail("manifest", { reason: error.message });
	}
	const source = async from => {
		const file = safe(sourceDir, from);
		await assertNoLinks(sourceDir, file);
		if (!(await stat(file))?.isFile()) throw fail("manifest", { reason: String(from) });
		return file;
	};
	const changes = [];
	for (const entry of manifest.files) {
		const data = await fsp.readFile(await source(entry.from));
		const target = safe(agentDir, entry.to);
		await assertNoLinks(agentDir, target);
		if (!(await fsp.readFile(target).catch(() => null))?.equals(data)) changes.push({ target, data });
	}
	for (const relative of manifest.remove ?? []) {
		const target = safe(agentDir, relative);
		await assertNoLinks(agentDir, target);
		if ((await stat(target))?.isFile()) changes.push({ target });
	}
	const layers = [];
	for (const entry of manifest.config) layers.push(await source(entry.from));
	if (pointer && (await readText(pointer.target)) !== pointer.data) changes.push(pointer);
	if (!changes.length) return { changed: false, layers };
	const base = path.join(agentDir, BACKUPS);
	await fsp.mkdir(base, { recursive: true });
	const journal = [];
	for (const [index, change] of changes.entries()) {
		const backup = (await stat(change.target)) ? String(index) : null;
		if (backup) await fsp.copyFile(change.target, path.join(base, backup));
		journal.push({ path: change.target, backup });
	}
	await writeAtomic(path.join(base, "journal.json"), JSON.stringify(journal));
	try {
		for (const change of changes) {
			if (change.data !== undefined) await writeAtomic(change.target, change.data);
			else {
				await fsp.rm(change.target);
				// An emptied extension directory must not stay behind as a broken extension.
				await fsp.rmdir(path.dirname(change.target)).catch(() => {});
			}
		}
	} catch (error) {
		await rollback(agentDir);
		throw error;
	}
	await drop(base);
	return { changed: true, layers };
}

// The harness in use: the revision Update left a pointer to, else the copy inside the extension.
async function selectPayload({ extensionPath, storageDir, version }) {
	const base = path.join(storageDir, "payload", version);
	const pointer = path.join(base, "current.json");
	const raw = await readText(pointer);
	if (raw === null) return { base, pointer, revision: null, dir: path.join(extensionPath, "payload") };
	let revision;
	try {
		revision = JSON.parse(raw);
	} catch {}
	if (!SHA.test(revision)) throw fail("pointer", { path: pointer });
	return { base, pointer, revision, dir: path.join(base, revision) };
}

// Update: the head of main, unpacked here in the extension host; no program is started for it.

// A tar stream as GitHub writes it: ustar headers, pax records for long paths.
function readTar(bytes) {
	const files = new Map();
	let long = null;
	for (let offset = 0; offset + 512 <= bytes.length; ) {
		const header = bytes.subarray(offset, offset + 512);
		if (header.every(byte => byte === 0)) break;
		const field = (start, length) => header.subarray(start, start + length).toString("utf8").replace(/\0.*$/s, "");
		const size = parseInt(field(124, 12).trim() || "0", 8);
		const data = bytes.subarray(offset + 512, offset + 512 + size);
		let sum = 0;
		for (let index = 0; index < 512; index++) sum += index >= 148 && index < 156 ? 32 : header[index];
		if (sum !== parseInt(field(148, 8).trim(), 8) || data.length !== size) throw new Error("damaged archive");
		const type = field(156, 1) || "0";
		if (type === "x") long = /(?:^|\n)\d+ path=([^\n]*)\n/.exec(data.toString("utf8"))?.[1] ?? null;
		else if (type === "L") long = data.toString("utf8").replace(/\0.*$/s, "");
		else {
			const prefix = field(345, 155);
			if (type === "0") files.set(long ?? (prefix ? prefix + "/" : "") + field(0, 100), data);
			if (type !== "g") long = null;
		}
		offset += 512 + Math.ceil(size / 512) * 512;
	}
	return files;
}

// VS Code adds its own `__metadata` block to the installed package.json: that is not a change.
function sameFile(name, next, current) {
	if (name !== "package.json") return next.equals(current);
	const plain = data => JSON.stringify({ ...JSON.parse(data), __metadata: undefined });
	try {
		return plain(next) === plain(current);
	} catch {
		return false;
	}
}

// Writes the files the manifest names into `stage`. Returns true when the extension code in the archive
// differs from the installed one. Other bundled programs need a new VSIX: the update is refused.
async function unpack({ archive, stage, extensionPath }) {
	const bad = reason => fail("extract", { reason });
	let files, root, manifest;
	try {
		files = readTar(gunzipSync(await fsp.readFile(archive), { maxOutputLength: 1 << 26 }));
		root = [...files.keys()][0].split("/")[0] + "/";
		manifest = checkManifest(JSON.parse(files.get(root + "install.manifest.json")));
	} catch (error) {
		throw bad(error.message);
	}
	const data = from => {
		if (!files.has(root + from)) throw bad("missing " + from);
		return files.get(root + from);
	};
	let stale = false;
	for (const entry of manifest.vscode?.files ?? []) {
		const current = await fsp.readFile(safe(extensionPath, entry.to)).catch(() => null);
		if (current && sameFile(entry.to, data(entry.from), current)) continue;
		if (entry.to === "runtime.json") throw fail("rewritten", { marketplace: messages.marketplace });
		stale = true;
	}
	await drop(stage);
	for (const from of ["install.manifest.json", ...[...manifest.files, ...manifest.config].map(entry => entry.from)]) {
		const target = safe(stage, from);
		await fsp.mkdir(path.dirname(target), { recursive: true });
		await fsp.writeFile(target, data(from));
	}
	return stale;
}

async function updateHarness({ extensionPath, storageDir, version, agentDir, web }) {
	const { sha } = await web.json(`https://api.github.com/repos/${REPO}/commits/main`, { accept: "application/vnd.github+json", "user-agent": "arqawa-ompcli" });
	if (!SHA.test(sha)) throw fail("revision");
	// A broken pointer stops here: nothing is written.
	const current = await selectPayload({ extensionPath, storageDir, version });
	const builtIn = ((await readText(path.join(extensionPath, "payload", ".revision"))) ?? "").trim();
	const result = { changed: false, stale: false };
	if (current.revision === sha || (current.revision === null && builtIn === sha)) {
		// The revision is already here: it is installed again, so a lost harness file comes back.
		result.changed = (await installHarness({ sourceDir: current.dir, agentDir })).changed;
	} else {
		const stage = path.join(current.base, sha);
		// A name of its own per attempt: a broken download never blocks the next one.
		const archive = path.join(storageDir, "omp-lite-" + sha + "." + randomUUID() + ".tar.gz");
		try {
			await fsp.mkdir(storageDir, { recursive: true });
			await web.download(`https://codeload.github.com/${REPO}/tar.gz/${sha}`, archive);
			result.stale = await unpack({ archive, stage, extensionPath });
			await installHarness({ sourceDir: stage, agentDir, pointer: { target: current.pointer, data: JSON.stringify(sha) } });
			result.changed = true;
		} catch (error) {
			await drop(stage);
			throw error;
		} finally {
			await drop(archive);
		}
	}
	for (const name of await list(current.base)) if (name !== "current.json" && name !== sha) await drop(path.join(current.base, name));
	return result;
}

// Local memory: one llama.cpp server per window, on loopback, behind a random key.

function freePort() {
	return new Promise((resolve, reject) => {
		const server = net.createServer().once("error", reject);
		server.listen(0, "127.0.0.1", () => {
			const { port } = server.address();
			server.close(() => resolve(port));
		});
	});
}

// A hidden bundled program. Its exit hands over the last lines its terminal showed, without colour
// codes: PowerShell turns every exit code into 1, so these lines say why a program did not start.
function hidden(pty, bash) {
	return (file, args, { cwd, env }) => {
		// MSYS_NO_PATHCONV: Git Bash must hand every argument to the program unchanged.
		const proc = pty.spawn("powershell.exe", psArgs(bash, words([file, ...args])), { name: "xterm-256color", cols: 120, rows: 30, cwd, env: { ...env, MSYS_NO_PATHCONV: "1" } });
		let output = "";
		proc.onData(data => {
			output = (output + data).slice(-4000);
		});
		const tail = () => output.replace(/\x1b\[[0-9;?]*[ -/]*[@-~]|\x1b\][^\x07]*\x07/g, "").split(/\r?\n/).map(line => line.trim()).filter(Boolean).slice(-3).join(" | ");
		return { kill: () => kill(proc), tail, onExit: handler => proc.onExit(({ exitCode }) => handler(exitCode, tail())) };
	};
}

function createMemory({ serverDir, model, start, onExit, request = fetch, port = freePort, now = Date.now, sleep = ms => new Promise(resolve => setTimeout(resolve, ms)) }) {
	let pending = null;
	let child = null;
	let generation = 0;

	async function attempt(id, deadline) {
		const number = await port();
		const key = randomBytes(32).toString("hex");
		const args = ["--model", model, "--embeddings", "--pooling", "mean", "--ctx-size", "8192", "--batch-size", "8192", "--ubatch-size", "8192",
			"--parallel", "1", "--threads", "2", "--host", "127.0.0.1", "--port", String(number), "--alias", MEMORY_MODEL, "--no-webui"];
		const proc = (child = start(path.join(serverDir, "llama-server.exe"), args, { cwd: serverDir, env: { ...process.env, LLAMA_API_KEY: key } }));
		let dead = null;
		let started = false;
		proc.onExit((code, reason) => {
			dead = Object.assign(fail("memoryExit", { code, reason }), { retry: true });
			if (started && id === generation) onExit?.();
		});
		const alive = () => {
			if (dead) throw dead;
		};
		try {
			for (;;) {
				alive();
				if (now() >= deadline) throw fail("memoryTimeout", { seconds: 60 });
				const response = await request(`http://127.0.0.1:${number}/health`, { signal: AbortSignal.timeout(1000) }).catch(() => null);
				alive();
				if (response?.ok) break;
				if (response && response.status !== 503) throw fail("memoryHealth", { status: response.status });
				await sleep(500);
			}
			for (const input of ["память", "project memory"]) {
				const response = await request(`http://127.0.0.1:${number}/v1/embeddings`, {
					method: "POST",
					headers: { "content-type": "application/json", authorization: "Bearer " + key },
					body: JSON.stringify({ model: MEMORY_MODEL, input }),
					signal: AbortSignal.timeout(5000),
				});
				if (!response.ok) throw fail("memoryHealth", { status: response.status });
				const vector = (await response.json())?.data?.[0]?.embedding;
				const size = Array.isArray(vector) ? vector.length : 0;
				if (size !== MEMORY_DIM || !vector.every(value => Number.isFinite(value))) throw fail("memoryDims", { size, expected: MEMORY_DIM });
			}
			// The server may have died right after its last answer: a dead server never counts as started.
			alive();
			started = true;
			return { port: number, key };
		} catch (error) {
			proc.kill();
			// The reason carries the last lines of the server terminal; an exit reason already has them.
			if (error !== dead && proc.tail?.()) error.message += " | " + proc.tail();
			throw error;
		}
	}

	// A server that died gets a fresh port, three attempts in all, inside the one deadline.
	async function run() {
		const id = ++generation;
		const deadline = now() + 60000;
		for (let number = 1; ; number++) {
			try {
				return await attempt(id, deadline);
			} catch (error) {
				if (number === 3 || !error.retry || id !== generation) throw error;
			}
		}
	}

	return {
		ensure: () => (pending ??= run()),
		stop() {
			generation++;
			child?.kill();
			child = pending = null;
		},
	};
}

// Without a server OMP runs with memory off instead of calling an address nobody listens on.
function overlayYaml({ port, key }) {
	if (!key) return 'memory:\n  backend: "off"\n';
	return ["memory:", "  backend: mnemopi", "mnemopi:", "  noEmbeddings: false", "  embeddingModel: " + MEMORY_MODEL, "  embeddingApiUrl: http://127.0.0.1:" + port + "/v1", "  embeddingApiKey: " + key, ""].join("\n");
}

// Tab environment and command.

// The `http.proxy` setting wins; an empty one falls back to the proxy VS Code was started with.
const pickProxy = (setting, env) => setting || envGet(env, "HTTPS_PROXY") || envGet(env, "HTTP_PROXY") || envGet(env, "ALL_PROXY") || "";

function tabEnv({ base, setting, insecure, runtimeDir, files, stt, gitBash }) {
	const env = { ...base };
	const proxy = pickProxy(setting, env);
	if (proxy) for (const name of ["HTTP_PROXY", "HTTPS_PROXY", "PI_PROXY"]) envSet(env, name, proxy);
	if (insecure) envSet(env, "NODE_TLS_REJECT_UNAUTHORIZED", "0");
	// The profile of Git Bash may wipe these: the tab command puts them back from the OMPCLI_ copies.
	for (const name of PROXY_VARS) if (envGet(env, name)) envSet(env, "OMPCLI_" + name, envGet(env, name));
	envSet(env, "PATH", [runtimeDir, envGet(env, "PATH")].filter(Boolean).join(";"));
	env.MNEMOPI_EMBEDDING_DIM = String(MEMORY_DIM);
	env.MNEMOPI_EMBEDDING_BATCH_SIZE = "1";
	env.MNEMOPI_EMBEDDING_MODEL = MEMORY_MODEL;
	envSet(env, "PI_CONFIG_FILES", files);
	envSet(env, "OMPCLI_CONFIG_FILES", files);
	if (stt) {
		envSet(env, "PI_STT_CONFIG", stt);
		envSet(env, "OMPCLI_GIT_BASH", gitBash);
	}
	return env;
}

// The managed environment, restored after the user profile. Values arrive as OMPCLI_ variables,
// never in the command line: a proxy password stays out of it.
const restoreEnv = runtimeDir => [
	"unset http_proxy https_proxy all_proxy no_proxy",
	...PROXY_VARS.map(name => "[[ -n $OMPCLI_" + name + " ]] && export " + name + "=$OMPCLI_" + name),
	"export PATH=$(cygpath -u " + words([runtimeDir]) + "):$PATH",
	"export PI_CONFIG_FILES=$OMPCLI_CONFIG_FILES",
];

// The dictation config of this window: the harness file plus the key file, which the plugin reads on every recording.
async function writeSttConfig(agentDir, storageDir) {
	const source = await readText(path.join(agentDir, "extensions", "pi-voice-stt", "stt.windows.json"));
	if (source === null) return undefined;
	const config = JSON.parse(source);
	config.provider = { ...config.provider, apiKeyFile: path.join(storageDir, STT_KEY_FILE) };
	await writeAtomic(path.join(storageDir, "stt.json"), JSON.stringify(config, null, 2) + "\n");
	return path.join(storageDir, "stt.json");
}

function loadPty(appRoot) {
	const candidates = ["node_modules.asar", "node_modules"].map(dir => path.join(appRoot, dir, "node-pty"));
	for (const candidate of candidates) {
		try {
			return require(candidate);
		} catch {}
	}
	throw fail("nodePty", { path: candidates[0] });
}

function createCli(host) {
	const { vscode, storageDir, extensionPath } = host;
	const gitBash = host.gitBash ?? GIT_BASH;
	const assets = (host.pins ?? pins).assets;
	const runtimeDir = path.join(extensionPath, "runtime");
	const omp = path.join(runtimeDir, assets.omp.file);
	const model = path.join(storageDir, "model", assets.model.file);
	const terminals = new Set();
	const processes = new Set();
	const counts = { chat: 0, shell: 0 };
	let memory = null;
	let overlay = null;
	let swept = null;
	let queue = Promise.resolve();

	// One window installs, updates and starts memory in turn; the cleanup runs once, before the first of them.
	function queued(action) {
		const next = queue.then(() => (swept ??= sweep(storageDir, host.version, assets.model.file))).then(action);
		queue = next.catch(() => {});
		return next;
	}

	// Checks before a command. Nothing is installed here: the reason is only named.
	function ready() {
		if (host.platform !== "win32" || host.arch !== "x64") throw fail("platform");
		if (!fs.existsSync(gitBash)) throw fail("gitBash", { path: gitBash });
		const profile = (envGet(host.env, "OMP_PROFILE") ?? envGet(host.env, "PI_PROFILE") ?? "").trim();
		if (profile && profile !== "default") throw fail("profile");
		const http = vscode.workspace.getConfiguration("http");
		const setting = (http.get("proxy") ?? "").trim();
		const insecure = http.get("proxyStrictSSL") === false;
		return {
			setting,
			insecure,
			pty: (host.loadPty ?? loadPty)(vscode.env.appRoot),
			agentDir: envGet(host.env, "PI_CODING_AGENT_DIR") || path.join(host.homedir, ".omp", "agent"),
			web: transport({ proxy: pickProxy(setting, host.env), insecure, request: host.request, run: host.curl }),
		};
	}

	// Any memory failure leaves the tab open: OMP starts without memory and the tab says why.
	async function startMemory(env, write) {
		try {
			if (!(await stat(path.join(runtimeDir, "llama", "llama-server.exe")))) throw fail("bundle", { file: "llama-server.exe" });
			await ensureModel(model, assets.model, env.web, write);
			memory ??= createMemory({
				serverDir: path.join(runtimeDir, "llama"),
				model,
				start: hidden(env.pty, gitBash),
				request: host.request,
				onExit() {
					memory = null;
					void vscode.window.showErrorMessage(messages.memoryStopped);
				},
			});
			return await memory.ensure();
		} catch (error) {
			memory?.stop();
			memory = null;
			const line = text("memoryOff", { reason: error.message });
			write(line);
			void vscode.window.showWarningMessage(line);
			return {};
		}
	}

	async function prepare(env, write) {
		if ((await stat(omp))?.size !== assets.omp.size) throw fail("bundle", { file: assets.omp.file });
		const payload = await selectPayload(host);
		const { layers } = await installHarness({ sourceDir: payload.dir, agentDir: env.agentDir }).catch(error => {
			throw fail("installFailed", { reason: error.message });
		});
		const started = await startMemory(env, write);
		// A restarted server has a new key, even on the same port.
		if (!overlay || overlay.key !== started.key) {
			const dir = path.join(storageDir, "runs", process.pid + "-" + randomUUID());
			await writeAtomic(path.join(dir, "memory.yml"), overlayYaml(started));
			overlay = { dir, file: path.join(dir, "memory.yml"), key: started.key };
		}
		// OMP reads the list left to right and the last file wins: the user's own layers, the harness fragments, the memory of this window.
		const files = [envGet(host.env, "PI_CONFIG_FILES"), ...layers, overlay.file].filter(Boolean).join(";");
		return { files, overlay: overlay.file, stt: await writeSttConfig(env.agentDir, storageDir) };
	}

	async function release() {
		if (terminals.size) return;
		memory?.stop();
		memory = null;
		if (overlay) await drop(overlay.dir);
		overlay = null;
	}

	function openTab(kind) {
		const env = ready();
		const emitter = new vscode.EventEmitter();
		let proc = null;
		let closed = false;
		async function start(size) {
			const prepared = await queued(() => prepare(env, line => emitter.fire(line + "\r\n")));
			// A tab closed while it was loading leaves nothing behind.
			if (closed) return release();
			const cwd = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? host.homedir;
			let inner = [...restoreEnv(runtimeDir), words([omp, "--config", prepared.overlay, ...(cwd === host.homedir ? ["--allow-home"] : [])])].join("; ");
			if (kind === "shell") {
				// The terminal tab is Git Bash left open: its rc file restores the same environment.
				const rc = path.join(storageDir, "shell-" + process.pid + ".sh");
				await writeAtomic(rc, ["[ -f ~/.bashrc ] && . ~/.bashrc", ...restoreEnv(runtimeDir)].join("\n") + "\n");
				inner = "exec bash --rcfile " + words([rc]) + " -i";
			}
			proc = env.pty.spawn("powershell.exe", psArgs(gitBash, inner), {
				name: "xterm-256color",
				cols: size?.columns ?? 120,
				rows: size?.rows ?? 30,
				cwd,
				env: tabEnv({ base: host.env, setting: env.setting, insecure: env.insecure, runtimeDir, gitBash, ...prepared }),
			});
			const child = proc;
			processes.add(child);
			child.onData(data => emitter.fire(data));
			child.onExit(() => processes.delete(child));
			if (closed) kill(child);
		}
		const terminal = vscode.window.createTerminal({
			name: (kind === "chat" ? "OMP " : "OMP terminal ") + ++counts[kind],
			location: { viewColumn: vscode.ViewColumn.Active },
			pty: {
				onDidWrite: emitter.event,
				open: size =>
					start(size).catch(error => {
						emitter.fire(error.message + "\r\n");
						void vscode.window.showErrorMessage(error.message);
					}),
				handleInput: data => proc?.write(data),
				setDimensions: size => proc?.resize(size.columns, size.rows),
				close() {
					closed = true;
					kill(proc);
				},
			},
		});
		terminals.add(terminal);
		terminal.show();
		return terminal;
	}

	async function update() {
		const env = ready();
		if (terminals.size) throw fail("closeTabs");
		const result = await queued(() => updateHarness({ extensionPath, storageDir, version: host.version, agentDir: env.agentDir, web: env.web }));
		void vscode.window.showInformationMessage(messages.updated);
		if (result.stale) void vscode.window.showInformationMessage(messages.stale);
		return result;
	}

	const guarded = (action, wrap = message => message) => async () => {
		try {
			return await action();
		} catch (error) {
			void vscode.window.showErrorMessage(wrap(error.message));
		}
	};

	return {
		// Activation only registers the commands: nothing is downloaded, started or cleaned here.
		activate: () => [
			vscode.window.onDidChangeActiveTerminal(active => vscode.commands.executeCommand("setContext", "ompcli.terminalActive", terminals.has(active))),
			vscode.window.onDidCloseTerminal(terminal => terminals.delete(terminal) && release()),
			vscode.commands.registerCommand("ompcli.newTab", guarded(() => openTab("chat"))),
			vscode.commands.registerCommand("ompcli.shellTab", guarded(() => openTab("shell"))),
			vscode.commands.registerCommand(
				"ompcli.update",
				guarded(() => vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: messages.update }, update), reason => text("updateFailed", { reason })),
			),
		],
		dispose() {
			for (const child of processes) kill(child);
			memory?.stop();
			if (overlay) void drop(overlay.dir);
		},
	};
}

let active = null;

function activate(context) {
	active = createCli({
		vscode: require("vscode"),
		extensionPath: context.extensionPath,
		storageDir: context.globalStorageUri.fsPath,
		version: context.extension.packageJSON.version,
		env: process.env,
		homedir: os.homedir(),
		platform: process.platform,
		arch: process.arch,
	});
	context.subscriptions.push(...active.activate());
}

function deactivate() {
	active?.dispose();
	active = null;
}

module.exports = { activate, deactivate, createCli, installHarness, createMemory, sweep, transport };
