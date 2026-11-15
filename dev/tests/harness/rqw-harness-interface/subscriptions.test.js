import { expect, mock, test } from "bun:test";
mock.module("@oh-my-pi/pi-coding-agent/slash-commands/helpers/active-oauth-account", () => ({ reportMatchesActiveAccount: (report, account) => report.metadata?.email === account.email && report.metadata?.orgId === account.orgId }));
const { default: subscriptions } = await import("../../../../src/modules/rqw-harness-interface/subscriptions.js");
const report = (provider, windows, metadata) => ({ provider, metadata, limits: windows.map(([id, value, scope = { shared: true }]) => ({ scope, window: { id }, amount: { remainingFraction: value } })) });
const flush = async () => { await Promise.resolve(); await Promise.resolve(); };
function mount(read, override = {}) {
	const handlers = {}, painted = []; let tick, interval;
	subscriptions({ on: (name, fn) => handlers[name] = fn }, read);
	const ctx = { mode: "tui", hasUI: true, agent: { kind: "main" }, ui: { setStatus: (key, value) => painted.push([key, value]) }, setInterval: (fn, ms) => { tick = fn; interval = ms; }, ...override };
	handlers.session_start({}, ctx);
	return { painted, tick: () => tick(), interval };
}

test("main TUI refreshes shared windows, chooses active account and clears absent marks", async () => {
	const active = { email: "a", orgId: "one" }, accounts = () => [{ ...active, active: true }];
	const ctx = { modelRegistry: { authStorage: { oauth: { accounts } } }, sessionManager: { getSessionId: () => "s" } };
	let reports = [report("anthropic", [["7d", .414]], active), report("anthropic", [["7d", .82]], { email: "a", orgId: "two" }), report("openai-codex", [["7d", .62]]), report("opencode-go", [["7d", .73], ["monthly", .84]])];
	const m = mount(async () => JSON.stringify({ reports }), ctx); await flush();
	expect(m.interval).toBe(300000);
	expect(m.painted).toEqual([["10-cc", "CC 41%"], ["20-cx", "CX 62%"], ["30-go", "Go 73%/84%"]]);
	reports = [report("anthropic", [["7d", 1, { shared: true, tier: "model" }]]), report("opencode-go", [["monthly", .5]])];
	m.tick(); await flush();
	expect(m.painted.slice(3)).toEqual([["10-cc", undefined], ["20-cx", undefined], ["30-go", "Go 50%"]]);
	reports = [report("anthropic", [["7d", .2]], active), report("anthropic", [["7d", .8]], active)];
	m.tick(); await flush(); expect(m.painted.at(-3)).toEqual(["10-cc", "CC 80%"]);
});

test("failed and overlapping reads leave marks intact; other sessions do not read", async () => {
	let resolve, reads = 0;
	const m = mount(() => { reads++; return new Promise(r => resolve = r); });
	m.tick(); expect(reads).toBe(1); resolve(JSON.stringify({ reports: [] })); await flush();
	m.tick(); resolve("invalid"); await flush(); expect(m.painted).toHaveLength(3);
	for (const override of [{ mode: "print" }, { hasUI: false }, { agent: { kind: "sub" } }]) {
		const read = mock(() => ""); mount(read, override); expect(read).not.toHaveBeenCalled();
	}
});
