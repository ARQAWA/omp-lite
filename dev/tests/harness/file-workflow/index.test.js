import { expect, test } from "bun:test";
import "./stubs.js";

const { default: fileWorkflow, ensureTools, TOOLS } = await import("../../../../src/modules/file-workflow/index.js");

const field = (type) => ({ type, optional: () => field(type) });

function host(active = []) {
	const tools = [];
	const handlers = {};
	const painted = [];
	const pi = {
		zod: { object: (shape) => ({ type: "object", shape }), string: () => field("string"), boolean: () => field("boolean"), array: () => field("array") },
		registerTool: (tool) => tools.push(tool.name),
		on: (name, fn) => (handlers[name] = fn),
		getActiveTools: async () => active,
		setActiveTools: async (names) => painted.push(names),
		pi: { settings: {} },
	};
	fileWorkflow(pi);
	return { tools, handlers, painted };
}

test("every name active leaves the list alone", async () => {
	const calls = [];
	const pi = { getActiveTools: async () => [...TOOLS, "todo"], setActiveTools: async (names) => calls.push(names) };
	await ensureTools(pi);
	expect(calls).toEqual([]);
});

test("a missing name is added after the active ones", async () => {
	const calls = [];
	const active = TOOLS.filter((name) => name !== "glob");
	const pi = { getActiveTools: async () => active, setActiveTools: async (names) => calls.push(names) };
	await ensureTools(pi);
	expect(calls).toEqual([["read", "grep", "bash", "edit", "write", "glob"]]);
});

test("a host without getActiveTools is left alone", async () => {
	await ensureTools({});
	await ensureTools({ getActiveTools: undefined, setActiveTools: () => {} });
});

test("the entry registers the six tools", () => {
	expect(host().tools).toEqual(["read", "grep", "glob", "bash", "write", "edit"]);
});

test("session start keeps the six names active", async () => {
	const { handlers, painted } = host(["todo"]);
	await handlers.session_start({}, { agent: { kind: "main" } });
	expect(painted).toEqual([["todo", "read", "grep", "glob", "bash", "edit", "write"]]);
});
