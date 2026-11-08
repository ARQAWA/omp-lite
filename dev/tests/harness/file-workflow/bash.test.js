import { beforeEach, expect, test } from "bun:test";
import { registry } from "./stubs.js";

const { blockThreshold, chooseConcurrency, cleanBashParams, mapBashArgs } = await import(
	"../../../../src/modules/file-workflow/tools/bash/args.js"
);
const bash = (await import("../../../../src/modules/file-workflow/tools/bash/index.js")).default;

let registered;
bash({ registerTool: (tool) => (registered = tool), pi: { settings: {} } });

let calls;
beforeEach(() => {
	calls = [];
	registry.length = 0;
});

const execute = (params, ctx) =>
	registered.execute("call", params, undefined, undefined, { cwd: "/w", invokeTool: async (args) => (calls.push(args), { content: [] }), ...ctx });

test("cleanBashParams drops the empty optional fields", () => {
	expect(cleanBashParams({ command: "ls", name: "", cwd: "", timeout: 0 })).toEqual({ command: "ls" });
	expect(cleanBashParams({ command: "ls", cwd: null, timeout: null })).toEqual({ command: "ls" });
});

test("cleanBashParams drops a ready block with no log and no port", () => {
	expect(cleanBashParams({ command: "ls", ready: {} })).toEqual({ command: "ls" });
	expect(cleanBashParams({ command: "ls", ready: { log: "", port: 0 } })).toEqual({ command: "ls" });
});

test("cleanBashParams cleans the fields of a ready block", () => {
	expect(cleanBashParams({ command: "ls", ready: { log: "ready$", host: "", port: 0, timeout: 0 } })).toEqual({
		command: "ls",
		ready: { log: "ready$" },
	});
});

test("chooseConcurrency runs a pty command alone", () => {
	expect([chooseConcurrency({ pty: true }), chooseConcurrency({ pty: false }), chooseConcurrency(undefined)]).toEqual([
		"exclusive",
		"shared",
		"shared",
	]);
});

test("blockThreshold defaults to one minute", () => {
	expect([blockThreshold(0), blockThreshold(undefined), blockThreshold(1500.7)]).toEqual([0, 60_000, 1500]);
});

test("mapBashArgs gives a plain command no deadline and the default threshold", () => {
	expect(mapBashArgs({ command: "ls" })).toEqual({ args: { command: "ls", timeout: 0 }, threshold: 60_000 });
});

test("mapBashArgs starts a zero block_until_ms command in the background", () => {
	expect(mapBashArgs({ command: "ls", block_until_ms: 0 })).toEqual({
		args: { command: "ls", timeout: 0, async: true },
		threshold: undefined,
	});
});

test("mapBashArgs keeps an explicit deadline", () => {
	expect(mapBashArgs({ command: "ls", timeout: 30 })).toEqual({ args: { command: "ls", timeout: 30 }, threshold: 60_000 });
});

test("mapBashArgs sends a pty command straight through", () => {
	expect(mapBashArgs({ command: "vim", pty: true })).toEqual({ args: { command: "vim", timeout: 0, pty: true }, threshold: undefined });
});

test("mapBashArgs sends a named service straight through without a timeout", () => {
	expect(mapBashArgs({ command: "serve", name: "svc" })).toEqual({ args: { command: "serve", name: "svc" }, threshold: undefined });
});

test("mapBashArgs sends an async call straight through", () => {
	expect(mapBashArgs({ command: "ls", async: true }).threshold).toBeUndefined();
});

test("mapBashArgs passes the requested threshold", () => {
	expect(mapBashArgs({ command: "ls", block_until_ms: 500 }).threshold).toBe(500);
});

test("execute hands the mapped arguments to the native bash", async () => {
	const result = await execute({ command: "ls", block_until_ms: 700 });
	expect(calls).toEqual([{ command: "ls", timeout: 0 }]);
	expect(registry).toEqual([["bash.autoBackground.thresholdMs", 700]]);
	expect(result).toEqual({ content: [] });
});

test("execute starts a background command without touching the threshold", async () => {
	await execute({ command: "make" , block_until_ms: 0 });
	expect(calls).toEqual([{ command: "make", timeout: 0, async: true }]);
	expect(registry).toEqual([]);
});

test("execute reports a host without the native bash", async () => {
	const result = await registered.execute("call", { command: "ls" }, undefined, undefined, { cwd: "/w" });
	expect(result).toEqual({ content: [{ type: "text", text: "bash is not available to this agent." }], isError: true });
});

test("the tool runs a pty command exclusively", () => {
	expect([registered.concurrency({ pty: true }), registered.concurrency({})]).toEqual(["exclusive", "shared"]);
});
