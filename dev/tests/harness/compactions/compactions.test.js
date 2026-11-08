import { expect, test } from "bun:test";
import compactions, { compactionCount, compactionsText } from "../../../../src/modules/compactions/index.js";

function mount(entries, mode = "tui") {
	const handlers = {};
	const painted = [];
	const pi = { on: (event, handler) => (handlers[event] = handler) };
	compactions(pi);
	const ctx = {
		mode,
		hasUI: true,
		agent: { kind: "main" },
		ui: { setStatus: (key, text) => painted.push([key, text]) },
		sessionManager: { getEntries: () => entries },
	};
	handlers.session_start({}, ctx);
	return { handlers, painted };
}

test("counts compaction entries only", () => {
	const entries = [{ type: "message" }, { type: "compaction" }, { type: "model_change" }, { type: "compaction" }];
	expect(compactionCount(entries)).toBe(2);
	expect(compactionsText(2)).toBe("cmp 2");
});

test("paints the count on start and after a compaction", () => {
	const entries = [{ type: "compaction" }];
	const { handlers, painted } = mount(entries);
	expect(painted).toEqual([["40-cmp", "cmp 1"]]);
	entries.push({ type: "compaction" });
	handlers.session_compact({});
	expect(painted.at(-1)).toEqual(["40-cmp", "cmp 2"]);
});

test("a resumed session counts earlier compactions", () => {
	const { painted } = mount([{ type: "compaction" }, { type: "compaction" }, { type: "compaction" }]);
	expect(painted.at(-1)).toEqual(["40-cmp", "cmp 3"]);
});

test("paints nothing outside the main TUI", () => {
	expect(mount([{ type: "compaction" }], "print").painted).toEqual([]);
});

test("a session switch recounts the newly selected session", () => {
	const first = [{ type: "compaction" }];
	const second = [];
	const handlers = {};
	const painted = [];
	let entries = first;
	const pi = { on: (event, handler) => (handlers[event] = handler) };
	compactions(pi);
	const ctx = {
		mode: "tui",
		hasUI: true,
		agent: { kind: "main" },
		ui: { setStatus: (key, text) => painted.push([key, text]) },
		sessionManager: { getEntries: () => entries },
	};
	handlers.session_start({}, ctx);
	entries = second;
	handlers.session_switch({ reason: "new" }, ctx);
	expect(painted).toEqual([
		["40-cmp", "cmp 1"],
		["40-cmp", "cmp 0"],
	]);
});
