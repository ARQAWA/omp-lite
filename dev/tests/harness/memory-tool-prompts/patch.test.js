import { expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import memoryPrompts, { NEW, OLD } from "../../../../src/modules/memory-tool-prompts/index.js";

process.env.OMP_MEMORY_PROMPTS_STATUS = join(mkdtempSync(join(tmpdir(), "omp-memory-")), "status.json");

function harness() {
	const handlers = new Map();
	const notifications = [];
	const statuses = [];
	const ui = {
		notify: (message, type) => notifications.push({ message, type }),
		setStatus: (key, text) => statuses.push({ key, text }),
	};
	const names = Object.keys(OLD);
	const pi = {
		on: (event, handler) => handlers.set(event, handler),
		getAllTools: () => names.map(name => ({ name, description: OLD[name] })),
	};
	memoryPrompts(pi);
	return { handlers, notifications, statuses, ui };
}

function textOf(result) {
	const content = result?.content;
	if (!Array.isArray(content)) return "";
	const first = content[0];
	return first && typeof first.text === "string" ? first.text : "";
}

test("accepts the exact upstream registry text", () => {
	const { handlers, notifications, ui } = harness();
	handlers.get("session_start")({}, { ui });
	expect(notifications).toEqual([]);
});

test("rewrites the learn payload description", () => {
	const { handlers, ui } = harness();
	const payload = { tools: [{ type: "function", function: { name: "learn", description: OLD.learn, parameters: {} } }] };
	handlers.get("before_provider_request")({ payload }, { ui });
	expect(payload.tools[0].function.description).toBe(NEW.learn);
});

test("rewrites the recall xd document and keeps the schema", () => {
	const { handlers, ui } = harness();
	const result = handlers.get("tool_result")(
		{
			toolName: "read",
			isError: false,
			input: { path: "xd://recall" },
			content: [{ type: "text", text: `# recall — Recall\n\n${OLD.recall}\n## Schema\ntype Args = { query: string }` }],
		},
		{ ui },
	);
	expect(textOf(result)).toBe(`${NEW.recall}\n## Schema\ntype Args = { query: string }`);
});

test("skips a changed upstream text and warns once", () => {
	const { handlers, notifications, statuses, ui } = harness();
	const payload = { tools: [{ type: "function", function: { name: "learn", description: "changed upstream", parameters: {} } }] };
	handlers.get("before_provider_request")({ payload }, { ui });
	handlers.get("before_provider_request")({ payload }, { ui });
	expect(payload.tools[0].function.description).toBe("changed upstream");
	expect(notifications.filter(item => item.type === "warning")).toHaveLength(1);
	expect(statuses.some(item => item.text?.includes("stale"))).toBe(true);
});

test("accepts an already patched description without warning", () => {
	const { handlers, notifications, ui } = harness();
	const payload = { tools: [{ type: "function", function: { name: "learn", description: NEW.learn, parameters: {} } }] };
	handlers.get("before_provider_request")({ payload }, { ui });
	expect(payload.tools[0].function.description).toBe(NEW.learn);
	expect(notifications).toEqual([]);
});

test("leaves unknown tools and read paths alone", () => {
	const { handlers, ui } = harness();
	const payload = { tools: [{ type: "function", function: { name: "read", description: "keep", parameters: {} } }] };
	handlers.get("before_provider_request")({ payload }, { ui });
	expect(payload.tools[0].function.description).toBe("keep");
	expect(
		handlers.get("tool_result")(
			{ toolName: "read", input: { path: "xd://other" }, content: [{ type: "text", text: "doc" }] },
			{ ui },
		),
	).toBeUndefined();
});
