import { expect, test } from "bun:test";
import { executeBash, mapBashParams } from "../../../../src/modules/cursor-tools/bash.js";

test("zero turns into an immediate background run", () => {
	expect(mapBashParams({ command: "make", block_until_ms: 0 })).toEqual({ command: "make", async: true });
});

test("zero does not override a pty command or a named service", () => {
	expect(mapBashParams({ command: "vim", pty: true, block_until_ms: 0 })).toEqual({ command: "vim", pty: true });
	expect(mapBashParams({ command: "serve", name: "web", block_until_ms: 0 })).toEqual({ command: "serve", name: "web" });
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

test("delegates the mapped arguments to the native tool", async () => {
	const seen = [];
	const ctx = { invokeTool: async (params, options) => (seen.push([params, options]), { content: [{ type: "text", text: "ok" }] }) };
	const signal = new AbortController().signal;
	await executeBash("call", { command: "make", block_until_ms: 0 }, signal, undefined, ctx);
	expect(seen[0][0]).toEqual({ command: "make", async: true });
	expect(seen[0][1]).toEqual({ signal, onUpdate: undefined });
});
