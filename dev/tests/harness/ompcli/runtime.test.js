import { afterEach, expect, test } from "bun:test";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { bundledChild, bundledStarter, curlTransport, ensureRuntime, pickProxy, proxiedRequest, sha256, sweep } from "../../../../src/modules/ompcli/index.js";

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
	model: { file: "model.gguf", size: 5, sha256: sha256("model"), url: "https://example.invalid/model.gguf" },
};

function installed() {
	const extensionPath = temporary();
	mkdirSync(join(extensionPath, "runtime", "llama"), { recursive: true });
	for (const name of ["omp.exe", "llama/llama-server.exe"]) writeFileSync(join(extensionPath, "runtime", name), "exe");
	return extensionPath;
}

test("programs run from the extension directory and only the model is downloaded", async () => {
	const extensionPath = installed();
	const storageDir = temporary();
	const urls = [];
	const request = async url => (urls.push(url), new Response("model"));
	const paths = await ensureRuntime({ extensionPath, storageDir, request, assets });
	expect(paths.omp).toBe(join(extensionPath, "runtime", "omp.exe"));
	expect(paths.bun).toBeUndefined();
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
	writeFileSync(join(extensionPath, "runtime", "omp.exe"), "cut!");
	await expect(ensureRuntime({ extensionPath, storageDir: temporary(), request: async () => new Response("model"), assets })).rejects.toThrow("omp.exe");
	rmSync(join(extensionPath, "runtime", "llama", "llama-server.exe"));
	writeFileSync(join(extensionPath, "runtime", "omp.exe"), "exe");
	await expect(ensureRuntime({ extensionPath, storageDir: temporary(), request: async () => new Response("model"), assets })).rejects.toThrow("llama-server.exe");
	rmSync(join(extensionPath, "runtime", "omp.exe"));
	await expect(ensureRuntime({ extensionPath, storageDir: temporary(), request: async () => new Response("model"), assets })).rejects.toThrow("omp.exe");
});

test("the old storage runtime is removed and its model is kept without a download", async () => {
	const extensionPath = installed();
	const storageDir = temporary();
	const old = join(storageDir, "runtime", "deadbeef");
	mkdirSync(join(old, "llama"), { recursive: true });
	for (const name of ["omp.exe", "llama/llama-server.exe"]) writeFileSync(join(old, name), "old");
	writeFileSync(join(old, "model.gguf"), "model");
	writeFileSync(join(storageDir, "chat-4242.sh"), "old wrapper");
	const request = async () => { throw new Error("no network expected"); };
	const paths = await ensureRuntime({ extensionPath, storageDir, request, assets });
	expect(readFileSync(paths.model, "utf8")).toBe("model");
	expect(existsSync(join(storageDir, "runtime"))).toBe(false);
	expect(existsSync(join(storageDir, "chat-4242.sh"))).toBe(false);
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
	start("C:\\ext\\runtime\\llama\\llama-server.exe", ["--model", "C:\\data\\it's.gguf", "--port", "5001"], { env: { LLAMA_API_KEY: "secret" } });
	const proc = pty.spawned[0];
	expect(proc.file).toBe("powershell.exe");
	expect(proc.args.slice(0, 3)).toEqual(["-NoLogo", "-NoProfile", "-Command"]);
	expect(proc.args[3]).toStartWith("& 'C:\\Program Files\\Git\\bin\\bash.exe' --login -i -c '");
	// PCLI form: no backslash and no double quote reaches the command line.
	expect(proc.args[3].match(/ -c '(.*)'$/s)[1].replaceAll("''", "'")).toBe("'C:/ext/runtime/llama/llama-server.exe' '--model' 'C:/data/it'\\''s.gguf' '--port' '5001'");
	expect(proc.args[3]).not.toContain("secret");
	expect(proc.options.env.LLAMA_API_KEY).toBe("secret");
	expect(proc.options.env.MSYS_NO_PATHCONV).toBe("1");
});

test("a long-lived bundled program reports its exit and can be killed", () => {
	const pty = fakePty();
	const child = bundledChild(bundledStarter(pty, "bash.exe"))("C:\\ext\\runtime\\llama\\llama-server.exe", ["--port", "5001"], { cwd: "C:\\ext" });
	let code;
	let reason;
	child.once("exit", (value, tail) => ((code = value), (reason = tail)));
	child.kill();
	expect(pty.spawned[0].killed).toBe(true);
	expect(pty.spawned[0].options.cwd).toBe("C:\\ext");
	pty.spawned[0].data("hello\r\n\x1b[31mbash: c:/ext/runtime/llama/llama-server.exe: Permission denied\x1b[0m\r\n");
	pty.spawned[0].exit({ exitCode: 3 });
	expect(code).toBe(3);
	expect(reason).toBe("hello | bash: c:/ext/runtime/llama/llama-server.exe: Permission denied");
});

test("a new version removes what older versions and crashed runs left behind", async () => {
	const storageDir = temporary();
	const put = (name, old) => {
		mkdirSync(join(storageDir, name, ".."), { recursive: true });
		writeFileSync(join(storageDir, name), "x");
		if (old) utimesSync(join(storageDir, name), new Date(0), new Date(0));
	};
	const gone = 2 ** 22 - 3;
	for (const name of ["extract.js", "chat-1.sh", "shell-" + gone + ".sh", "runs/" + gone + "-a/memory.yml", "payload/0.0.3/current.json"]) put(name, false);
	for (const name of ["install-a.json", "install-a.json.out", "omp-lite-x.tar.gz", "model/m.gguf.1.tmp"]) put(name, true);
	const keep = ["shell-" + process.pid + ".sh", "runs/" + process.pid + "-b/memory.yml", "payload/0.0.6/current.json", "model/m.gguf", "model/m.gguf.2.tmp", "install-b.json", "leases/note.txt"];
	for (const name of keep) put(name, false);
	await sweep(storageDir, "0.0.6");
	const left = [];
	const walk = dir => { for (const entry of readdirSync(join(storageDir, dir), { withFileTypes: true })) entry.isDirectory() ? walk(join(dir, entry.name)) : left.push(join(dir, entry.name)); };
	walk("");
	expect(left.sort()).toEqual(keep.map(name => join(name)).sort());
});

test("payloads of other versions stay while another window holds a tab", async () => {
	const storageDir = temporary();
	mkdirSync(join(storageDir, "payload", "0.0.3"), { recursive: true });
	mkdirSync(join(storageDir, "leases"), { recursive: true });
	writeFileSync(join(storageDir, "leases", process.pid + ".json"), JSON.stringify({ pid: process.pid, revision: "a".repeat(40) }));
	await sweep(storageDir, "0.0.6");
	expect(existsSync(join(storageDir, "payload", "0.0.3"))).toBe(true);
});
