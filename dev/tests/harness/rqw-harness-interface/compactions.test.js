import { expect, test } from "bun:test";
import compactions from "../../../../src/modules/rqw-harness-interface/compactions.js";

test("count follows the whole session across events, only in main TUI", () => {
	const handlers = {}, painted = []; let entries = [{ type: "compaction" }, { type: "message" }];
	compactions({ on: (name, fn) => handlers[name] = fn });
	const ctx = { mode: "tui", hasUI: true, agent: { kind: "main" }, sessionManager: { getEntries: () => entries }, ui: { setStatus: (...args) => painted.push(args) } };
	handlers.session_start({}, ctx); entries.push({ type: "compaction" }); handlers.session_compact();
	entries = []; handlers.session_switch({}, ctx); entries.push({ type: "compaction" }); handlers.session_branch();
	expect(painted).toEqual([["40-cmp", "cmp 1"], ["40-cmp", "cmp 2"], ["40-cmp", "cmp 0"], ["40-cmp", "cmp 1"]]);
	for (const override of [{ mode: "print" }, { hasUI: false }, { agent: { kind: "sub" } }]) { handlers.session_switch({}, { ...ctx, ...override }); handlers.session_compact(); }
	handlers.session_shutdown(); handlers.session_branch(); expect(painted).toHaveLength(4);
});
