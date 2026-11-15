import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { createMemory } from "../../../../src/modules/rqw-windows-pack/vscode/index.js";
import { world } from "./helpers.js";

// A fake llama server: `health` lists the answers of /health in order, the last one repeats.
// The answer "exit" kills the process the way a refused program dies.
function server({ health = [200], vector = Array(768).fill(0.1), probe = () => {} } = {}) {
	const state = { calls: [], procs: [], stopped: 0, time: 0 };
	let ports = 4000;
	const memory = createMemory({
		serverDir: "C:\\ext\\runtime\\llama",
		model: "C:\\storage\\model.gguf",
		port: async () => ++ports,
		sleep: async () => {},
		now: () => (state.time += 1000),
		onExit: () => state.stopped++,
		start(file, args, options) {
			const exits = [];
			const proc = { file, args, options, onExit: handler => exits.push(handler), kill: () => (proc.killed = true), exit: (code, tail) => exits.forEach(handler => handler(code, tail)) };
			state.procs.push(proc);
			return proc;
		},
		async request(url, init) {
			state.calls.push([url, init]);
			if (!url.endsWith("/health")) return probe(state) ?? Response.json({ data: [{ embedding: vector }] });
			const answer = health.length > 1 ? health.shift() : health[0];
			if (answer === "exit") state.procs.at(-1).exit(1, "Permission denied");
			return new Response("", { status: answer === "exit" ? 503 : answer });
		},
	});
	return { memory, state };
}

test("the server starts on loopback behind a random key and passes two probes", async () => {
	const { memory, state } = server({ health: [503, 200] });
	const [started, again] = await Promise.all([memory.ensure(), memory.ensure()]);
	const [proc] = state.procs;
	expect(state.procs.length).toBe(1);
	expect(again).toBe(started);
	expect(started).toEqual({ port: 4001, key: proc.options.env.LLAMA_API_KEY });
	expect(started.key).toMatch(/^[a-f0-9]{64}$/);
	expect([proc.file, proc.options.cwd]).toEqual(["C:\\ext\\runtime\\llama/llama-server.exe", "C:\\ext\\runtime\\llama"]);
	expect(proc.args.join(" ")).toBe("--model C:\\storage\\model.gguf --embeddings --pooling mean --ctx-size 8192 --batch-size 8192 --ubatch-size 8192 --parallel 1 --threads 2 --host 127.0.0.1 --port 4001 --alias embeddinggemma-2:270m-q8_0 --no-webui");
	const probes = state.calls.filter(([url]) => url === "http://127.0.0.1:4001/v1/embeddings");
	expect(probes.map(([, init]) => [init.headers.authorization, JSON.parse(init.body)])).toEqual(["память", "project memory"].map(input => ["Bearer " + started.key, { model: "embeddinggemma-2:270m-q8_0", input }]));
	// A server that dies later is reported; one that we stop is not.
	proc.exit(1, "");
	expect(state.stopped).toBe(1);
	memory.stop();
	expect(proc.killed).toBe(true);
});

test("a server that dies gets three attempts on fresh ports and names the reason", async () => {
	const { memory, state } = server({ health: ["exit"] });
	await expect(memory.ensure()).rejects.toThrow("Local memory exited: 1 Permission denied");
	expect(state.procs.map(proc => proc.args[proc.args.indexOf("--port") + 1])).toEqual(["4001", "4002", "4003"]);
	expect(state.stopped).toBe(0);
});

test("a server that is not ready, not healthy or answers wrongly is killed", async () => {
	const cases = [
		[{ health: [503] }, "Local memory did not start in 60s."],
		[{ health: [500] }, "Local memory is not healthy: HTTP 500"],
		[{ vector: [1, 2, 3] }, "Local memory returned 3 dimensions, expected 768."],
		[{ vector: Array(768).fill(null) }, "Local memory returned 768 dimensions, expected 768."],
		[{ probe: () => new Response("", { status: 401 }) }, "Local memory is not healthy: HTTP 401"],
		// It answered both probes and died: a dead server never counts as started.
		[{ probe: state => void (state.calls.at(-1)[1].body.includes("project") && state.procs.at(-1).exit(1, "gone")) }, "Local memory exited: 1 gone"],
	];
	for (const [options, message] of cases) {
		const { memory, state } = server(options);
		await expect(memory.ensure()).rejects.toThrow(message);
		expect(state.procs.every(proc => proc.killed)).toBe(true);
	}
});

test("a memory failure leaves the tab open with memory off; the next tab tries again", async () => {
	let healthy = false;
	const w = world({ request: async url => (url.endsWith("/health") ? new Response("", { status: healthy ? 200 : 500 }) : Response.json({ data: [{ embedding: Array(768).fill(1) }] })) });
	await w.tab();
	const off = "OMP CLI: memory is off. Local memory is not healthy: HTTP 500";
	expect(w.state.messages).toEqual([off]);
	const overlay = proc => readFileSync(proc.options.env.PI_CONFIG_FILES.split(";").at(-1), "utf8");
	expect(overlay(w.state.spawned[1])).toBe('memory:\n  backend: "off"\n');
	healthy = true;
	await w.tab();
	const [, , server, tab] = w.state.spawned;
	const port = server.args[3].match(/'--port'' ''(\d+)'/)[1];
	expect(overlay(tab)).toBe(`memory:\n  backend: mnemopi\nmnemopi:\n  noEmbeddings: false\n  embeddingModel: embeddinggemma-2:270m-q8_0\n  embeddingApiUrl: http://127.0.0.1:${port}/v1\n  embeddingApiKey: ${server.options.env.LLAMA_API_KEY}\n`);
	expect(server.options.env.MSYS_NO_PATHCONV).toBe("1");
	// The server died under an open tab.
	server.exit(1);
	expect(w.state.messages).toEqual([off, "Local memory stopped. Reopen OMP CLI tab."]);
});
