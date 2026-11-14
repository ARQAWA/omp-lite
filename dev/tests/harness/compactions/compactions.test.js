import { expect, test } from "bun:test";
import compactions from "../../../../src/modules/compactions/index.js";

function mount(entries, overrides = {}) {
	const handlers = {};
	const painted = [];
	const pi = { on: (event, handler) => (handlers[event] = handler) };
	compactions(pi);
	const ctx = {
		mode: "tui",
		hasUI: true,
		agent: { kind: "main" },
		ui: { setStatus: (key, text) => painted.push([key, text]) },
		sessionManager: { getEntries: () => entries },
		...overrides,
	};
	handlers.session_start({}, ctx);
	return { handlers, painted, ctx, setEntries: next => (entries = next) };
}

test("paints the count on start and after a compaction", () => {
	const entries = [{ type: "message" }, { type: "compaction" }, { type: "model_change" }, { type: "compaction" }];
	const { handlers, painted } = mount(entries);
	expect(painted).toEqual([["40-cmp", "cmp 2"]]);
	entries.push({ type: "compaction" });
	handlers.session_compact({});
	expect(painted.at(-1)).toEqual(["40-cmp", "cmp 3"]);
});

test("paints nothing outside the main TUI", () => {
	for (const ctx of [{ mode: "print" }, { hasUI: false }, { agent: { kind: "sub" } }])
		expect(mount([{ type: "compaction" }], ctx).painted).toEqual([]);
});

test("switching and branching recount the session", () => {
	const { handlers, painted, ctx, setEntries } = mount([{ type: "compaction" }]);
	setEntries([]);
	handlers.session_switch({ reason: "new" }, ctx);
	expect(painted.at(-1)).toEqual(["40-cmp", "cmp 0"]);
	setEntries([{ type: "compaction" }, { type: "compaction" }]);
	handlers.session_branch({}, ctx);
	expect(painted.at(-1)).toEqual(["40-cmp", "cmp 2"]);
});
