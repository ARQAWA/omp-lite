import { expect, test } from "bun:test";
import subscriptions, { marks } from "../../../../src/modules/subscriptions/index.js";

const report = (provider, limits) => ({
	provider,
	limits: limits.map(([id, remainingFraction]) => ({ window: { id }, amount: { remainingFraction } })),
});

test("marks show remaining percent for each subscription", () => {
	const reports = [
		report("anthropic", [["5h", 1], ["7d", 0.55]]),
		report("openai-codex", [["7d", 0.88]]),
		report("opencode-go", [["5h", 1], ["7d", 0.86], ["monthly", 0.93]]),
	];
	expect(marks(reports)).toEqual([
		["10-cc", "CC 55%"],
		["20-cx", "CX 88%"],
		["30-go", "Go 86%/93%"],
	]);
});

test("subscriptions without a window stay silent", () => {
	const reports = [report("cursor", [["monthly", 1]]), report("opencode-go", [["7d", 0.5]])];
	expect(marks(reports)).toEqual([["30-go", "Go 50%"]]);
	expect(marks([])).toEqual([]);
});

test("a missing window of a known provider prints nothing", () => {
	const reports = [report("anthropic", [["5h", 1]])];
	expect(marks(reports)).toEqual([]);
});

test("only the main TUI session paints", () => {
	const handlers = {};
	const painted = [];
	const pi = { on: (event, handler) => (handlers[event] = handler) };
	subscriptions(pi);
	const ctx = {
		mode: "print",
		hasUI: true,
		agent: { kind: "main" },
		ui: { setStatus: (key, text) => painted.push([key, text]) },
		setInterval: () => {},
	};
	handlers.session_start({}, ctx);
	expect(painted).toEqual([]);
});
