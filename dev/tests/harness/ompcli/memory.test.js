import { afterEach, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createMemory, memoryArgs, overlayYaml, writeOverlay } from "../../../../src/modules/ompcli/index.js";

const dirs = [];
const vector = size => ({ data: [{ embedding: new Array(size).fill(0.25) }] });

function temporary() {
	const dir = mkdtempSync(join(tmpdir(), "ompcli-memory-"));
	dirs.push(dir);
	return dir;
}

function child() {
	const listeners = {};
	return {
		killed: false,
		once(event, handler) {
			(listeners[event] ??= []).push(handler);
		},
		emit(event, value) {
			for (const handler of listeners[event] ?? []) handler(value);
		},
		kill() {
			this.killed = true;
			queueMicrotask(() => this.emit("exit", 1));
		},
	};
}

function server(healths, embedding = vector(768)) {
	const calls = { spawn: [], urls: [] };
	let index = 0;
	const spawnProcess = (file, args) => {
		const process = child();
		calls.spawn.push({ file, args, process });
		return process;
	};
	const request = async url => {
		calls.urls.push(url);
		if (url.endsWith("/health")) {
			const status = healths[Math.min(index++, healths.length - 1)];
			return new Response(null, { status });
		}
		return Response.json(embedding);
	};
	return { calls, spawnProcess, request };
}

afterEach(() => {
	for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

test("the server command line matches the documented flags", () => {
	const args = memoryArgs({ model: "model.gguf", port: 5001 });
	expect(args).toEqual([
		"--model", "model.gguf",
		"--embeddings", "--pooling", "mean",
		"--ctx-size", "8192",
		"--batch-size", "8192", "--ubatch-size", "8192",
		"--parallel", "1", "--threads", "2",
		"--host", "127.0.0.1", "--port", "5001",
		"--alias", "embeddinggemma-2:270m-q8_0",
		"--no-webui",
	]);
});

test("two concurrent commands share one server", async () => {
	const fake = server([200]);
	const memory = createMemory({ runtimeDir: "/runtime", request: fake.request, spawnProcess: fake.spawnProcess, allocate: async () => 5001 });
	const [first, second] = await Promise.all([memory.ensure(), memory.ensure()]);
	expect(fake.calls.spawn.length).toBe(1);
	expect(first.port).toBe(5001);
	expect(second).toBe(first);
	expect(await memory.ensure()).toBe(first);
});

test("a 503 loading response waits for the server to become healthy", async () => {
	const fake = server([503, 503, 200]);
	const memory = createMemory({ runtimeDir: "/runtime", request: fake.request, spawnProcess: fake.spawnProcess, allocate: async () => 5002, sleep: async () => {} });
	expect((await memory.ensure()).port).toBe(5002);
	expect(fake.calls.urls.filter(url => url.endsWith("/health")).length).toBe(3);
	const probes = fake.calls.urls.filter(url => url.endsWith("/v1/embeddings"));
	expect(probes.length).toBe(2);
});

test("wrong embedding dimensions block the tab", async () => {
	const fake = server([200], vector(384));
	const memory = createMemory({ runtimeDir: "/runtime", request: fake.request, spawnProcess: fake.spawnProcess, allocate: async () => 5003 });
	await expect(memory.ensure()).rejects.toThrow("384 dimensions, expected 768");
	expect(fake.calls.spawn[0].process.killed).toBe(true);
});

test("a health timeout reports the wait", async () => {
	const fake = server([503]);
	const memory = createMemory({ runtimeDir: "/runtime", request: fake.request, spawnProcess: fake.spawnProcess, allocate: async () => 5004, attempts: 3, intervalMs: 500, sleep: async () => {} });
	await expect(memory.ensure()).rejects.toThrow("did not start in 2s");
});

test("a server exit stops the wait and reports the code", async () => {
	const fake = server([503]);
	fake.spawnProcess = (file, args) => {
		const process = child();
		fake.calls.spawn.push({ file, args, process });
		queueMicrotask(() => process.emit("exit", 3));
		return process;
	};
	const memory = createMemory({ runtimeDir: "/runtime", request: fake.request, spawnProcess: fake.spawnProcess, allocate: async () => 5005, sleep: async () => {} });
	await expect(memory.ensure()).rejects.toThrow("exited: 3");
});

test("a server that dies right after the probes does not count as started", async () => {
	const fake = server([200]);
	let probes = 0;
	const request = async url => {
		const response = await fake.request(url);
		// Every start dies as soon as its second probe is answered.
		if (url.endsWith("/v1/embeddings") && ++probes % 2 === 0) fake.calls.spawn.at(-1).process.emit("exit", 9);
		return response;
	};
	const memory = createMemory({ runtimeDir: "/runtime", request, spawnProcess: fake.spawnProcess, allocate: async () => 5006, sleep: async () => {} });
	await expect(memory.ensure()).rejects.toThrow("exited: 9");
	expect(fake.calls.spawn.length).toBe(3);
});

test("a process error stops the wait", async () => {
	const fake = server([200]);
	fake.spawnProcess = () => {
		const process = child();
		queueMicrotask(() => process.emit("error", new Error("spawn failed")));
		return process;
	};
	const memory = createMemory({ runtimeDir: "/runtime", request: fake.request, spawnProcess: fake.spawnProcess, allocate: async () => 5006, sleep: async () => {} });
	await expect(memory.ensure()).rejects.toThrow("spawn failed");
});

test("separate windows get separate endpoints", async () => {
	const first = createMemory({ runtimeDir: "/runtime", request: server([200]).request, spawnProcess: server([200]).spawnProcess, allocate: async () => 5007 });
	const second = createMemory({ runtimeDir: "/runtime", request: server([200]).request, spawnProcess: server([200]).spawnProcess, allocate: async () => 5008 });
	const a = await first.ensure();
	const b = await second.ensure();
	expect(a.port).not.toBe(b.port);
	expect(a.key).not.toBe(b.key);
	expect(overlayYaml(a)).not.toBe(overlayYaml(b));
});

test("the overlay carries the local endpoint and the documented window", () => {
	const text = overlayYaml({ port: 5009, key: "secret" });
	expect(text).toBe([
		"memory:",
		"  backend: mnemopi",
		"mnemopi:",
		"  noEmbeddings: false",
		"  embeddingModel: embeddinggemma-2:270m-q8_0",
		"  embeddingApiUrl: http://127.0.0.1:5009/v1",
		"  embeddingApiKey: secret",
		"",
	].join("\n"));
});

test("the overlay lives in its own run directory", async () => {
	const storageDir = temporary();
	const overlay = await writeOverlay({ storageDir, pid: 42, id: "run", port: 5010, key: "k" });
	expect(existsSync(join(storageDir, "runs", "42-run", "memory.yml"))).toBe(true);
	expect(readFileSync(overlay.file, "utf8")).toContain("http://127.0.0.1:5010/v1");
	expect(overlay.dir).toBe(join(storageDir, "runs", "42-run"));
});

test("a lost port is retried with a new one", async () => {
	let spawns = 0;
	const fake = server([200]);
	const original = fake.spawnProcess;
	fake.spawnProcess = (file, args) => {
		spawns++;
		const process = original(file, args);
		if (spawns === 1) queueMicrotask(() => process.emit("exit", 1));
		return process;
	};
	const ports = [5014, 5015];
	const memory = createMemory({ runtimeDir: "/runtime", request: fake.request, spawnProcess: fake.spawnProcess, allocate: async () => ports.shift(), sleep: async () => {} });
	expect((await memory.ensure()).port).toBe(5015);
	expect(spawns).toBe(2);
});

test("non-finite embedding values are rejected", async () => {
	const values = new Array(768).fill(0.5);
	values[3] = Number.NaN;
	const memory = createMemory({ runtimeDir: "/runtime", request: server([200], { data: [{ embedding: values }] }).request, spawnProcess: server([200]).spawnProcess, allocate: async () => 5016 });
	await expect(memory.ensure()).rejects.toThrow("expected 768");
});

test("more than one vector is rejected", async () => {
	const memory = createMemory({ runtimeDir: "/runtime", request: server([200], { data: [{ embedding: new Array(768).fill(0) }, { embedding: new Array(768).fill(0) }] }).request, spawnProcess: server([200]).spawnProcess, allocate: async () => 5017 });
	await expect(memory.ensure()).rejects.toThrow("expected 768");
});

test("failed health requests end in a timeout and never reach the embeddings", async () => {
	const urls = [];
	const request = async url => {
		urls.push(url);
		throw new Error("ECONNREFUSED");
	};
	const memory = createMemory({ runtimeDir: "/runtime", request, spawnProcess: server([200]).spawnProcess, allocate: async () => 5018, attempts: 3, intervalMs: 500, sleep: async () => {} });
	await expect(memory.ensure()).rejects.toThrow("did not start in 2s");
	expect(urls.every(url => url.endsWith("/health"))).toBe(true);
});

test("an intentional stop is not reported as a failure", async () => {
	const exits = [];
	const fake = server([200]);
	const memory = createMemory({ runtimeDir: "/runtime", request: fake.request, spawnProcess: fake.spawnProcess, allocate: async () => 5019, onExit: () => exits.push(1) });
	await memory.ensure();
	memory.stop();
	fake.calls.spawn[0].process.emit("exit", 0);
	await Promise.resolve();
	expect(exits).toEqual([]);
});

test("a late server exit is reported", async () => {
	const exits = [];
	const fake = server([200]);
	const memory = createMemory({ runtimeDir: "/runtime", request: fake.request, spawnProcess: fake.spawnProcess, allocate: async () => 5020, onExit: () => exits.push(1) });
	await memory.ensure();
	fake.calls.spawn[0].process.emit("exit", 9);
	await Promise.resolve();
	expect(exits).toEqual([1]);
});

test("a stop during startup is not retried", async () => {
	let spawns = 0;
	const fake = server([503]);
	fake.spawnProcess = (file, args) => {
		spawns++;
		return child();
	};
	const memory = createMemory({ runtimeDir: "/runtime", request: fake.request, spawnProcess: fake.spawnProcess, allocate: async () => 5021, attempts: 3, intervalMs: 500, sleep: async () => new Promise(() => {}) });
	const pending = memory.ensure();
	for (let turn = 0; turn < 50 && !spawns; turn++) await new Promise(resolve => setTimeout(resolve, 0));
	expect(spawns).toBe(1);
	memory.stop();
	await expect(pending).rejects.toThrow();
	expect(spawns).toBe(1);
});

test("a stop during port allocation prevents the spawn", async () => {
	let spawns = 0;
	let release = null;
	const memory = createMemory({
		runtimeDir: "/runtime",
		request: async () => new Response(null, { status: 200 }),
		spawnProcess: () => {
			spawns++;
			return child();
		},
		allocate: () => new Promise(resolve => {
			release = resolve;
		}),
	});
	const pending = memory.ensure();
	for (let turn = 0; turn < 50 && !release; turn++) await new Promise(resolve => setTimeout(resolve, 0));
	expect(typeof release).toBe("function");
	memory.stop();
	release(5022);
	await expect(pending).rejects.toThrow("Local memory stopped");
	expect(spawns).toBe(0);
});

test("a stopped startup cannot spawn after a newer one begins", async () => {
	let spawns = 0;
	const ports = [];
	const fake = server([200]);
	const memory = createMemory({
		runtimeDir: "/runtime",
		request: fake.request,
		spawnProcess: (file, args) => {
			spawns++;
			return child();
		},
		allocate: () => new Promise(resolve => ports.push(resolve)),
	});
	const first = memory.ensure();
	for (let turn = 0; turn < 50 && ports.length < 1; turn++) await new Promise(resolve => setTimeout(resolve, 0));
	memory.stop();
	const second = memory.ensure();
	for (let turn = 0; turn < 50 && ports.length < 2; turn++) await new Promise(resolve => setTimeout(resolve, 0));
	expect(ports.length).toBe(2);
	ports[0](5025);
	await expect(first).rejects.toThrow("Local memory stopped");
	expect(spawns).toBe(0);
	ports[1](5026);
	expect((await second).port).toBe(5026);
	expect(spawns).toBe(1);
	// The next caller must reuse the live startup instead of spawning a third one.
	expect((await memory.ensure()).port).toBe(5026);
	expect(spawns).toBe(1);
});
