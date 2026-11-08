import { expect, test } from "bun:test";
import taskDelegation, { RULE } from "../../../../src/modules/task-delegation/index.js";

const FIRST = "Spawn `tasks[]` concurrently; IDs return immediately.";
const DESCRIPTION = `${FIRST}\n\n# Results\nread the agent URL.\n\n# Delegation\nUse most specific agent.`;

function harness() {
	const handlers = new Map();
	const pi = { on: (event, handler) => handlers.set(event, handler) };
	taskDelegation(pi);
	return handlers.get("before_provider_request");
}

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
	expect(event.payload.tools[0].function.description.endsWith("# Delegation\nUse most specific agent.")).toBe(true);
	expect(event.payload.tools[1].function.description).toBe("Read a file.");
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
