import { expect, test } from "bun:test";
import { executeBash, install, mapBashParams } from "../../../../src/modules/cursor-tools/index.js";

test("zero turns into an immediate background run", () => {
	expect(mapBashParams({ command: "make", block_until_ms: 0 })).toEqual({ command: "make", async: true });
});

test("working_directory becomes cwd unless cwd is already set", () => {
	expect(mapBashParams({ command: "ls", working_directory: "/tmp" })).toEqual({ command: "ls", cwd: "/tmp" });
	expect(mapBashParams({ command: "ls", cwd: "/a", working_directory: "/tmp" })).toEqual({ command: "ls", cwd: "/a" });
});

test("no threshold keeps the call untouched", () => {
	expect(mapBashParams({ command: "ls" })).toEqual({ command: "ls" });
});

test("a positive threshold is refused instead of racing the shared setting", async () => {
	let called = false;
	const ctx = { invokeTool: async () => ((called = true), { content: [] }) };
	const result = await executeBash("call", { command: "make", block_until_ms: 5000 }, undefined, undefined, ctx);
	expect(called).toBe(false);
	expect(result.isError).toBe(true);
	expect(result.content[0].text).toContain("only accepts 0");
});

test("zero with a pty or a named service is refused, not silently dropped", async () => {
	const ctx = { invokeTool: async () => ({ content: [] }) };
	for (const extra of [{ pty: true }, { name: "web" }]) {
		const result = await executeBash("call", { command: "x", block_until_ms: 0, ...extra }, undefined, undefined, ctx);
		expect(result.isError).toBe(true);
		expect(result.content[0].text).toContain("cannot be combined");
	}
});

test("delegates the mapped arguments to the native tool", async () => {
	const seen = [];
	const ctx = { invokeTool: async (params, options) => (seen.push([params, options]), { content: [{ type: "text", text: "ok" }] }) };
	const signal = new AbortController().signal;
	await executeBash("call", { command: "make", block_until_ms: 0 }, signal, undefined, ctx);
	expect(seen[0][0]).toEqual({ command: "make", async: true });
	expect(seen[0][1]).toEqual({ signal, onUpdate: undefined });
});

const node = () => chain;
const chain = new Proxy(node, { get: (_target, key) => (key === "then" ? undefined : node) });

test("the registered bash entry forwards working_directory as cwd", async () => {
	const tools = [];
	const pi = { zod: chain, registerTool: tool => tools.push(tool), on: () => {} };
	install(pi);
	const bash = tools.find(tool => tool.name === "bash");
	let seen;
	const ctx = { invokeTool: async params => ((seen = params), { content: [{ type: "text", text: "ok" }] }) };
	await bash.execute("call", { command: "pwd", working_directory: "/tmp" }, undefined, undefined, ctx);
	expect(seen).toEqual({ command: "pwd", cwd: "/tmp" });
});

test("registers both tools under omp's names and keeps pty calls exclusive", () => {
	const tools = [];
	const pi = { zod: chain, registerTool: tool => tools.push(tool), on: () => {} };
	install(pi);
	expect(tools.map(tool => tool.name)).toEqual(["grep", "bash"]);
	for (const tool of tools) {
		expect(tool.loadMode).toBe("essential");
		expect(tool.description.length).toBeGreaterThan(100);
	}
	const bash = tools.find(tool => tool.name === "bash");
	expect(bash.concurrency({ pty: true })).toBe("exclusive");
	expect(bash.concurrency({ command: "ls" })).toBe("shared");
});
