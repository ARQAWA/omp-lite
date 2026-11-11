import { afterEach, expect, test } from "bun:test";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { bundledChild, bundledStarter, curlTransport, ensureRuntime, installMain, pickProxy, proxiedRequest, runBundled, sha256, spawnInstaller } from "../../../../src/modules/ompcli/index.js";

const dirs = [];

function temporary() {
	const dir = mkdtempSync(join(tmpdir(), "ompcli-runtime-"));
	dirs.push(dir);
	return dir;
}

afterEach(() => {
	for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const assets = {
	omp: { file: "omp.exe", size: 3 },
	bun: { file: "bun.exe", unpackedSize: 3 },
	model: { file: "model.gguf", size: 5, sha256: sha256("model"), url: "https://example.invalid/model.gguf" },
};

function installed() {
	const extensionPath = temporary();
	mkdirSync(join(extensionPath, "runtime", "llama"), { recursive: true });
	for (const name of ["omp.exe", "bun.exe", "llama/llama-server.exe"]) writeFileSync(join(extensionPath, "runtime", name), "exe");
	return extensionPath;
}

test("programs run from the extension directory and only the model is downloaded", async () => {
	const extensionPath = installed();
	const storageDir = temporary();
	const urls = [];
	const request = async url => (urls.push(url), new Response("model"));
	const paths = await ensureRuntime({ extensionPath, storageDir, request, assets });
	expect(paths.omp).toBe(join(extensionPath, "runtime", "omp.exe"));
	expect(paths.bun).toBe(join(extensionPath, "runtime", "bun.exe"));
	expect(paths.llama).toBe(join(extensionPath, "runtime", "llama"));
	expect(paths.model).toBe(join(storageDir, "model", "model.gguf"));
	expect(readFileSync(paths.model, "utf8")).toBe("model");
	expect(urls).toEqual(["https://example.invalid/model.gguf"]);
	await ensureRuntime({ extensionPath, storageDir, request, assets });
	expect(urls.length).toBe(1);
	writeFileSync(paths.model, "wrong");
	await ensureRuntime({ extensionPath, storageDir, request, assets });
	expect(readFileSync(paths.model, "utf8")).toBe("model");
	expect(urls.length).toBe(2);
});

test("a missing or cut program stops the tab and names the file", async () => {
	const extensionPath = installed();
	writeFileSync(join(extensionPath, "runtime", "bun.exe"), "cut!");
	await expect(ensureRuntime({ extensionPath, storageDir: temporary(), request: async () => new Response("model"), assets })).rejects.toThrow("bun.exe");
	rmSync(join(extensionPath, "runtime", "omp.exe"));
	await expect(ensureRuntime({ extensionPath, storageDir: temporary(), request: async () => new Response("model"), assets })).rejects.toThrow("omp.exe");
});

test("the old storage runtime is removed and its model is kept without a download", async () => {
	const extensionPath = installed();
	const storageDir = temporary();
	const old = join(storageDir, "runtime", "deadbeef");
	mkdirSync(join(old, "llama"), { recursive: true });
	for (const name of ["omp.exe", "bun.exe", "llama/llama-server.exe"]) writeFileSync(join(old, name), "old");
	writeFileSync(join(old, "model.gguf"), "model");
	writeFileSync(join(storageDir, "chat-4242.sh"), "old wrapper");
	writeFileSync(join(storageDir, "shell-4242.sh"), "terminal wrapper");
	const request = async () => { throw new Error("no network expected"); };
	const paths = await ensureRuntime({ extensionPath, storageDir, request, assets });
	expect(readFileSync(paths.model, "utf8")).toBe("model");
	expect(existsSync(join(storageDir, "runtime"))).toBe(false);
	expect(existsSync(join(storageDir, "chat-4242.sh"))).toBe(false);
	expect(existsSync(join(storageDir, "shell-4242.sh"))).toBe(true);
});

test("Update and a tab starting together both get the old model", async () => {
	const extensionPath = installed();
	const storageDir = temporary();
	mkdirSync(join(storageDir, "runtime", "deadbeef"), { recursive: true });
	writeFileSync(join(storageDir, "runtime", "deadbeef", "model.gguf"), "model");
	const request = async () => new Response("model");
	const both = await Promise.all([ensureRuntime({ extensionPath, storageDir, request, assets }), ensureRuntime({ extensionPath, storageDir, request, assets })]);
	for (const paths of both) expect(readFileSync(paths.model, "utf8")).toBe("model");
});

test("a failed model download names the model", async () => {
	const request = async () => new Response("", { status: 502 });
	await expect(ensureRuntime({ extensionPath: installed(), storageDir: temporary(), request, assets })).rejects.toThrow("could not download model.gguf");
});

test("a configured proxy is used for downloads", async () => {
	const seen = [];
	const request = proxiedRequest("http://user:secret@proxy.local:8080", {
		run: async (file, args, input, options) => {
			seen.push({ file, args, options });
			return Buffer.from("{}");
		},
	});
	const response = await request("https://example.invalid/file", { headers: { accept: "application/json" } });
	expect(await response.json()).toEqual({});
	expect(seen[0].options.env.HTTPS_PROXY).toBe("http://user:secret@proxy.local:8080");
	expect(seen[0].options.env.HTTP_PROXY).toBe("http://user:secret@proxy.local:8080");
	expect(seen[0].args.join(" ")).not.toContain("secret");
	expect(seen[0].args).toContain("accept: application/json");
	expect(seen[0].args).toContain("https://example.invalid/file");
	expect(seen[0].args).not.toContain("--insecure");
});

test("strict TLS stays on unless the user turned it off", async () => {
	const seen = [];
	const request = proxiedRequest("http://proxy.local:8080", {
		insecure: true,
		run: async (file, args) => {
			seen.push(args);
			return Buffer.from("{}");
		},
	});
	await request("https://example.invalid/file");
	expect(seen[0]).toContain("--insecure");
});

test("proxied assets stream to a file instead of memory", async () => {
	expect(pickProxy(" http://set:1 ", { HTTPS_PROXY: "http://env:2" })).toBe("http://set:1");
	expect(pickProxy("", { https_proxy: "http://env:2", HTTP_PROXY: "http://env:3" })).toBe("http://env:2");
	expect(pickProxy(undefined, { Http_Proxy: "http://env:3" })).toBe("http://env:3");
	expect(pickProxy("", {})).toBe("");
	const seen = [];
	const download = curlTransport("http://user:secret@proxy.local:8080", {
		run: async (file, args, input, options) => {
			seen.push({ file, args, options });
			return Buffer.alloc(0);
		},
	});
	await download("https://example.invalid/model.gguf", "/tmp/model.part");
	expect(seen[0].args).toContain("--output");
	expect(seen[0].args).toContain("/tmp/model.part");
	expect(seen[0].args).toContain("--location");
	expect(seen[0].args.join(" ")).not.toContain("secret");
	expect(seen[0].options.env.HTTPS_PROXY).toContain("secret");
});

function fakePty() {
	const spawned = [];
	return {
		spawned,
		spawn(file, args, options) {
			const proc = { file, args, options, killed: false, onData: fn => (proc.data = fn), onExit: fn => (proc.exit = fn), kill: () => (proc.killed = true) };
			spawned.push(proc);
			return proc;
		},
	};
}

test("a bundled program starts through PowerShell and Git Bash, never by itself", async () => {
	const pty = fakePty();
	const start = bundledStarter(pty, "C:\\Program Files\\Git\\bin\\bash.exe");
	const done = runBundled(start, "C:\\ext\\runtime\\bun.exe", ["C:\\ext\\index.js", "--install", "it's.json"], { env: { LLAMA_API_KEY: "secret" } });
	const proc = pty.spawned[0];
	expect(proc.file).toBe("powershell.exe");
	expect(proc.args.slice(0, 3)).toEqual(["-NoLogo", "-NoProfile", "-Command"]);
	expect(proc.args[3]).toStartWith("& 'C:\\Program Files\\Git\\bin\\bash.exe' --login -i -c '");
	// PCLI form: no backslash and no double quote reaches the command line.
	expect(proc.args[3].match(/ -c '(.*)'$/s)[1].replaceAll("''", "'")).toBe("'C:/ext/runtime/bun.exe' 'C:/ext/index.js' '--install' 'it'\\''s.json'");
	expect(proc.args[3]).not.toContain("secret");
	expect(proc.options.env.LLAMA_API_KEY).toBe("secret");
	expect(proc.options.env.MSYS_NO_PATHCONV).toBe("1");
	proc.data("\x1b[31mbash: Permission denied\x1b[0m\r\n");
	proc.exit({ exitCode: 126 });
	expect(await done).toEqual({ code: 126, output: "bash: Permission denied" });
});

test("a long-lived bundled program reports its exit and can be killed", () => {
	const pty = fakePty();
	const child = bundledChild(bundledStarter(pty, "bash.exe"))("C:\\ext\\runtime\\llama\\llama-server.exe", ["--port", "5001"], { cwd: "C:\\ext" });
	let code;
	child.once("exit", value => (code = value));
	child.kill();
	expect(pty.spawned[0].killed).toBe(true);
	expect(pty.spawned[0].options.cwd).toBe("C:\\ext");
	pty.spawned[0].exit({ exitCode: 3 });
	expect(code).toBe(3);
});

test("the installer gets its input and returns its answer through files", async () => {
	const storageDir = temporary();
	const agentDir = temporary();
	const sourceDir = temporary();
	mkdirSync(join(sourceDir, "src"), { recursive: true });
	writeFileSync(join(sourceDir, "src", "a.js"), "a");
	writeFileSync(join(sourceDir, "install.manifest.json"), JSON.stringify({ version: 1, files: [{ from: "src/a.js", to: "extensions/a.js" }], config: [] }));
	const seen = [];
	const run = async (file, args) => {
		seen.push([file, ...args.slice(0, 2)]);
		await installMain(args[2]);
		return { code: 0, output: "" };
	};
	const input = { run, storageDir, bun: "bun.exe", sourceDir, agentDir, revision: "c".repeat(40), lease: false };
	expect(await spawnInstaller(input)).toEqual({ revision: "c".repeat(40), changed: true });
	expect(readFileSync(join(agentDir, "extensions", "a.js"), "utf8")).toBe("a");
	expect(seen[0][0]).toBe("bun.exe");
	expect(seen[0][2]).toBe("--install");
	await expect(spawnInstaller({ ...input, run: async () => ({ code: 126, output: "x\nbash: bun.exe: Permission denied" }) })).rejects.toThrow("Permission denied");
	expect(existsSync(join(storageDir, "runtime"))).toBe(false);
	expect(require("node:fs").readdirSync(storageDir)).toEqual([]);
});

test("a hidden run that never answers is killed and says so", async () => {
	const pty = fakePty();
	const result = await runBundled(bundledStarter(pty, "bash.exe"), "bun.exe", [], { timeoutMs: 20 });
	expect(pty.spawned[0].killed).toBe(true);
	expect(result).toEqual({ code: -1, output: "no answer in 0s" });
});
