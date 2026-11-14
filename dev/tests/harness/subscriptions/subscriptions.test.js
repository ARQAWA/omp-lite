import { expect, mock, test } from "bun:test";
import subscriptions, { marks } from "../../../../src/modules/subscriptions/index.js";

const report = (provider, limits) => ({
	provider,
	limits: limits.map(([id, remainingFraction]) => ({ scope: { shared: true }, window: { id }, amount: { remainingFraction } })),
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

test("subscriptions without a window stay silent", async () => {
	const reports = [report("cursor", [["monthly", 1]]), report("opencode-go", [["7d", 0.5]])];
	expect(marks(reports)).toEqual([["30-go", "Go 50%"]]);
	expect(marks([])).toEqual([]);
	expect(marks([report("anthropic", [["5h", 1]])])).toEqual([]);
	const limit = scope => ({ scope, window: { id: "7d" }, amount: { remainingFraction: 0.5 } });
	const { painted } = mount(usage([{ provider: "anthropic", limits: [limit({ tier: "opus" })] }, { provider: "openai-codex", limits: [limit({ shared: true, tier: "spark" })] }]));
	await flush();
	expect(painted).toEqual([["10-cc", undefined], ["20-cx", undefined], ["30-go", undefined]]);
});

const flush = () => new Promise(resolve => setTimeout(resolve, 0));

const usage = reports => async () => JSON.stringify({ reports });

function mount(read, overrides = {}) {
	const handlers = {};
	const painted = [];
	let tick;
	const pi = { on: (event, handler) => (handlers[event] = handler) };
	subscriptions(pi, read);
	const ctx = {
		mode: "tui",
		hasUI: true,
		agent: { kind: "main" },
		ui: { setStatus: (key, text) => painted.push([key, text]) },
		setInterval: callback => {
			tick = callback;
		},
		...overrides,
	};
	handlers.session_start({}, ctx);
	return { handlers, painted, tick: () => tick() };
}

test("only the main TUI session paints", () => {
	for (const ctx of [{ mode: "print" }, { hasUI: false }, { agent: { kind: "sub" } }]) {
		const read = mock(usage([])), setInterval = mock(() => {});
		mount(read, { ...ctx, setInterval });
		expect(read).not.toHaveBeenCalled();
		expect(setInterval).not.toHaveBeenCalled();
	}
});

test("a successful read paints every mark through the extension entry", async () => {
	const { painted } = mount(
		usage([
			report("anthropic", [["7d", 0.41]]),
			report("openai-codex", [["7d", 0.62]]),
			report("opencode-go", [["7d", 0.73], ["monthly", 0.84]]),
		]),
	);
	await flush();
	expect(painted).toEqual([
		["10-cc", "CC 41%"],
		["20-cx", "CX 62%"],
		["30-go", "Go 73%/84%"],
	]);
});

test("a missing subscription clears its stale mark", async () => {
	const { painted } = mount(usage([report("anthropic", [["7d", 0.41]])]));
	await flush();
	expect(painted).toEqual([
		["20-cx", undefined],
		["30-go", undefined],
		["10-cc", "CC 41%"],
	]);
});

test("a failed refresh keeps the marks already on screen", async () => {
	let offline = false;
	const { painted, tick } = mount(async () => {
		if (offline) throw new Error("offline");
		return JSON.stringify({ reports: [report("anthropic", [["7d", 0.41]])] });
	});
	await flush();
	expect(painted).toEqual([
		["20-cx", undefined],
		["30-go", undefined],
		["10-cc", "CC 41%"],
	]);
	const paintedBefore = painted.length;
	offline = true;
	tick();
	await flush();
	expect(painted.length).toBe(paintedBefore);
});
