import { expect, test } from "bun:test";
import toolSummary, { summarize } from "../../../../src/modules/tool-summary/index.js";

const start = (toolCallId, toolName) => ({ type: "tool_execution_start", toolCallId, toolName });
const end = (toolCallId, isError = false) => ({ type: "tool_execution_end", toolCallId, isError });

function mount() {
	const handlers = {};
	const painted = [];
	let presenter;
	const pi = {
		on: (event, handler) => (handlers[event] = handler),
		registerTranscriptPresenter: handler => (presenter = handler),
	};
	toolSummary(pi);
	const ctx = { ui: { setWidget: (id, content) => painted.push([id, content]) } };
	handlers.session_start({}, ctx);
	return { handlers, painted, presenter };
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
	expect(painted.at(-1)).toEqual(["tool-summary", ["read 1 · search 1 · failed 1"]]);
});

test("a new agent step clears the line", () => {
	const { handlers, painted } = mount();
	handlers.agent_start();
	handlers.tool_execution_start(start("a", "bash"));
	handlers.agent_start();
	expect(painted.at(-1)).toEqual(["tool-summary", undefined]);
});

test("tool cards are hidden, other blocks keep their drawing", () => {
	const { presenter } = mount();
	expect(presenter({ type: "toolCall", id: "a" })).toBe("hidden");
	expect(presenter({ type: "message", id: "1", message: {} })).toBeUndefined();
});
