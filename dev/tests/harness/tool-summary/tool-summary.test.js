import { expect, test } from "bun:test";
import toolSummary, { summarize } from "../../../../src/modules/tool-summary/index.js";

const start = (toolCallId, toolName) => ({ type: "tool_execution_start", toolCallId, toolName });
const end = (toolCallId, isError = false) => ({ type: "tool_execution_end", toolCallId, isError });

function mount() {
	const handlers = {};
	const painted = [];
	const pi = {
		on: (event, handler) => (handlers[event] = handler),
	};
	toolSummary(pi);
	const ctx = { ui: { setWidget: (id, content, options) => painted.push([id, content, options]) } };
	handlers.session_start({}, ctx);
	return { handlers, painted };
}

test("summarize counts tool kinds and failures", () => {
	expect(
		summarize([
			{ name: "read", isError: false },
			{ name: "read", isError: false },
			{ name: "bash", isError: false },
			{ name: "edit", isError: true },
			{ name: "weird", isError: false },
		]),
	).toBe("read 2 · edit 1 · run 1 · other 1 · failed 1");
});

test("one widget line accumulates calls", () => {
	const { handlers, painted } = mount();
	handlers.agent_start();
	handlers.tool_execution_start(start("a", "read"));
	handlers.tool_execution_start(start("b", "grep"));
	handlers.tool_execution_end(end("b", true));
	expect(painted.at(-1)).toEqual(["tool-summary", ["read 1 · search 1 · failed 1"], { placement: "belowEditor" }]);
});

test("a new agent step clears the line", () => {
	const { handlers, painted } = mount();
	handlers.agent_start();
	handlers.tool_execution_start(start("a", "bash"));
	handlers.agent_start();
	expect(painted.at(-1)).toEqual(["tool-summary", undefined, { placement: "belowEditor" }]);
});
