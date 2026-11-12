import { expect, test } from "bun:test";
import taskDelegation, { RULE } from "../../../../src/modules/task-delegation/index.js";

const FIRST = "Spawn `tasks[]` concurrently; IDs return immediately.";
const TAIL = "Prefer one agent to investigate + edit. Omit `agent` only for default (`task`); NEVER specify it.";
const DESCRIPTION = `${FIRST}\n\n# Results\nread the agent URL.\n\n# Delegation\nUse most specific agent. Read-only research MUST use \`scout\` only when files unknown. ${TAIL}`;

function handlers() {
	const handlers = new Map();
	const pi = { on: (event, handler) => handlers.set(event, handler) };
	taskDelegation(pi);
	return handlers;
}

const harness = () => handlers().get("before_provider_request");

const payload = () => ({
	tools: [
		{ type: "function", function: { name: "task", description: DESCRIPTION, parameters: {} } },
		{ type: "function", function: { name: "read", description: "Read a file.", parameters: {} } },
	],
});

test("puts the rule under the first line of the task description", () => {
	const event = { payload: payload() };
	harness()(event);
	const text = event.payload.tools[0].function.description;
	expect(text.startsWith(`${FIRST}\n${RULE}\n\n# Results`)).toBe(true);
});

test("keeps the rest of the description and other tools untouched", () => {
	const event = { payload: payload() };
	harness()(event);
	expect(event.payload.tools[0].function.description.endsWith(`no \`agent\`, no \`effort\`. ${TAIL}`)).toBe(true);
	expect(event.payload.tools[1].function.description).toBe("Read a file.");
});

test("the specificity line becomes the Codex-style default worker rule, once", () => {
	const event = { payload: payload() };
	const handler = harness();
	handler(event);
	handler(event);
	const text = event.payload.tools[0].function.description;
	expect(text).not.toContain("Use most specific agent.");
	expect(text.split("# Delegation\nOmit `agent` by default: a general worker equal to you.")).toHaveLength(2);
	for (const part of ["`scout` only for read-only search over unknown files", "`sonic` only for mechanical edits with exact instructions", "names an agent type: pass it in `agent`", "set `model` to `provider/id:level` (your own model if none named); no `agent`, no `effort`"]) {
		expect(text).toContain(part);
	}
});

test("adds the rule once across repeated requests", () => {
	const event = { payload: payload() };
	const handler = harness();
	handler(event);
	handler(event);
	handler(event);
	expect(event.payload.tools[0].function.description.split(RULE)).toHaveLength(2);
});

test("patches the flat Anthropic shape and ignores non-tool look-alikes", () => {
	const event = {
		payload: {
			tools: [{ name: "task", description: DESCRIPTION, input_schema: {} }],
			agents: [{ name: "task", description: "bundled worker" }],
			meta: { task: { name: "task", description: "danger zone", parameters: {} } },
		},
	};
	harness()(event);
	expect(event.payload.tools[0].description).toContain(RULE);
	expect(event.payload.agents[0].description).toBe("bundled worker");
	expect(event.payload.meta.task.description).toBe("danger zone");
});

test("tolerates payloads without the task tool", () => {
	const event = { payload: { tools: [{ type: "function", function: { name: "read", description: "Read.", parameters: {} } }] } };
	expect(() => harness()(event)).not.toThrow();
	expect(event.payload.tools[0].function.description).toBe("Read.");
});

test("patches OAuth-prefixed task names in both provider shapes", () => {
	for (const tool of [
		{ name: "_task", description: DESCRIPTION, input_schema: {} },
		{ type: "function", function: { name: "_task", description: DESCRIPTION, parameters: {} } },
	]) {
		harness()({ payload: { tools: [tool] } });
		expect((tool.function ?? tool).description).toContain(RULE);
		expect((tool.function ?? tool).name).toBe("_task");
	}
});

test("removes mandatory scout wording even when the gate is already present", () => {
	const tool = {
		name: "task",
		description: `${FIRST}\n${RULE}\nUse most specific agent. Read-only research MUST use \`scout\` only when files unknown. Prefer one agent.\n- \`scout\`: MUST be used for exploratory codebase research, rapid code analysis, and broad pattern searches. Fast read-only scout returning compressed context for handoff.`,
		parameters: {},
	};
	harness()({ payload: { tools: [tool] } });
	expect(tool.description).toContain("no `agent`, no `effort`. Prefer one agent.");
	expect(tool.description).toContain("- `scout`: Fast read-only scout");
	expect(tool.description).not.toContain("MUST");
	expect(tool.description.split(RULE)).toHaveLength(2);
});

test("eval prefers Bun, keeps Python, and drops agent and workpool advertising", () => {
	const stock = [
		"One cell per call; top-level state persists, including across compaction. Subagents have separate kernels.",
		"For 2+ independent items, use a named `workpool()`; results auto-deliver. If blocked, leave `eval` and call `wait`.",
		"Python: plain Python subprocess, not IPython.",
		"JS: Bun; top-level await works.",
		"- `agent`, `workpool`: background subagents, DAG waves \u2192 `xd://eval/agents`",
		'eval(language="py", code="%load \\"scripts/my setup.py\\"")',
	].join("\n");
	for (const name of ["eval", "_eval"]) {
		const record = { name, description: stock, parameters: { language: "keep" } };
		const tool = name === "eval" ? { type: "function", function: record } : record;
		const event = { payload: { tools: [tool] } };
		const handler = harness();
		handler(event);
		const once = record.description;
		handler(event);
		expect(record.description).toBe(once);
		expect(once).toContain("Use JavaScript (Bun) by default.");
		expect(once).toContain("Python only for rare tasks requiring Python-specific libraries");
		expect(once).toContain("For project file reading and searching, use the read, grep and glob tools.");
		expect(once).toContain("Python: plain Python subprocess");
		expect(once).toContain('eval(language="js", code="%load \\"scripts/my setup.js\\"")');
		expect(once).not.toContain("workpool");
		expect(once).not.toContain("xd://eval/agents");
		expect(once).not.toContain("Subagents have separate kernels.");
		expect(record.parameters).toEqual({ language: "keep" });
	}
});

test("the eval filter blocks direct agent and workpool calls in both runtimes", () => {
	const guard = handlers().get("tool_call");
	for (const language of ["js", "py"]) {
		for (const code of ['await agent("read")', 'pool = await workpool("task", {name: "test"})']) {
			const result = guard({ toolName: "eval", input: { language, code } });
			expect(result.block).toBe(true);
			expect(result.reason).toContain("Use the task tool for explicitly requested delegation.");
		}
		expect(guard({ toolName: "eval", input: { language, code: "print(2 + 2)" } })).toBeUndefined();
	}
	expect(guard({ toolName: "read", input: { code: "agent()" } })).toBeUndefined();
	expect(guard({ toolName: "task", input: { tasks: [] } })).toBeUndefined();
	expect(guard({ toolName: "_eval", input: { code: "workpool ()" } }).block).toBe(true);
});
