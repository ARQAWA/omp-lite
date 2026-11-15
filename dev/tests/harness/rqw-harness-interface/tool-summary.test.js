import { expect, test } from "bun:test";
import toolSummary from "../../../../src/modules/rqw-harness-interface/tool-summary.js";

test("tool calls and errors form one line and both new and queued requests reset it", () => {
	const handlers = {}, painted = [];
	toolSummary({ on: (name, fn) => handlers[name] = fn });
	const ctx = { mode: "tui", hasUI: true, agent: { kind: "main" }, ui: { setWidget: (...args) => painted.push(args) } };
	const start = (id, name) => handlers.tool_execution_start({ toolCallId: id, toolName: name }, ctx);
	handlers.agent_start({}, ctx);
	for (const name of ["read", "edit", "apply_patch", "write", "ast_edit", "grep", "glob", "find", "web_search", "files", "bash", "eval", "task"]) start(name, name);
	handlers.tool_execution_end({ toolCallId: "edit", isError: true }, ctx);
	handlers.tool_execution_end({ toolCallId: "missing", isError: true }, ctx);
	expect(painted.at(-1)).toEqual(["tool-summary", ["read 1 · edit 4 · search 5 · run 2 · other 1 · failed 1"], { placement: "belowEditor" }]);
	for (const event of ["before_agent_start", "agent_start"]) { handlers[event]({}, ctx); expect(painted.at(-1)[1]).toBeUndefined(); start("x", "read"); expect(painted.at(-1)[1]).toEqual(["read 1"]); }
	for (const override of [{ mode: "print" }, { hasUI: false }, { agent: { kind: "sub" } }]) handlers.agent_start({}, { ...ctx, ...override });
	expect(painted.at(-1)[1]).toEqual(["read 1"]);
});
