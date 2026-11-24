import { expect, mock, test } from "bun:test";
mock.module("@oh-my-pi/pi-coding-agent/slash-commands/helpers/active-oauth-account", () => ({ reportMatchesActiveAccount: (report, account) => account.credentialId !== undefined ? (report.metadata?.credentialIds ?? [report.metadata?.credentialId]).includes(account.credentialId) : report.metadata?.email === account.email && report.metadata?.orgId === account.orgId }));
const { default: subscriptions } = await import("../../../../src/modules/rqw-harness-interface/subscriptions.js");
const report = (provider, windows, metadata) => ({ provider, metadata, limits: windows.map(([id, value, scope = { shared: true }]) => ({ scope, window: { id }, amount: { remainingFraction: value } })) });
const flush = async () => { await Promise.resolve(); await Promise.resolve(); };
function mount(read, override = {}) {
	const handlers = {}, painted = [], logs = []; let tick, interval;
	subscriptions({ on: (name, fn) => handlers[name] = fn, logger: { warn: (...entry) => logs.push(entry) } }, read);
	const ctx = { mode: "tui", hasUI: true, agent: { kind: "main" }, ui: { setStatus: (key, value) => painted.push([key, value]) }, setInterval: (fn, ms) => { tick = fn; interval = ms; }, ...override };
	handlers.session_start({}, ctx);
	return { painted, logs, tick: () => tick(), interval };
}

test("main TUI refreshes shared windows, chooses active account and clears absent marks", async () => {
	const active = { email: "a", orgId: "one" }, accounts = () => [{ ...active, active: true }], identity = provider => provider === "anthropic" ? active : undefined;
	const ctx = { modelRegistry: { authStorage: { oauth: { accounts, identity } } }, sessionManager: { getSessionId: () => "s" } };
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

test("OAuth identity and sticky API-key row select only matching reports", async () => {
	let identity = { email: "a", orgId: "one" }, sticky = 0;
	const oauth = { identity: (provider, id) => provider === "anthropic" && id === "s" ? identity : undefined, accounts: () => [{ ...identity, active: true, credentialId: 42 }] };
	const ctx = { modelRegistry: { authStorage: { oauth, sessions: { sticky: provider => provider === "openai-codex" && sticky !== undefined ? { credentialId: sticky } : undefined } } }, sessionManager: { getSessionId: () => "s" } };
	let reports = [report("anthropic", [["7d", .41]], identity), report("anthropic", [["7d", .82]], { email: "b", orgId: "one" }), report("openai-codex", [["7d", .3]], { credentialIds: [0, 2] }), report("openai-codex", [["7d", .9]], { credentialId: 1 })];
	const m = mount(async () => JSON.stringify({ reports }), ctx); await flush();
	expect(m.painted.slice(0, 2)).toEqual([["10-cc", "CC 41%"], ["20-cx", "CX 30%"]]);
	reports = reports.filter((_, i) => i === 1 || i === 3); m.tick(); await flush();
	expect(m.painted.slice(3, 5)).toEqual([["10-cc", undefined], ["20-cx", undefined]]);
	identity = undefined; sticky = undefined; m.tick(); await flush();
	expect(m.painted.slice(6, 8)).toEqual([["10-cc", "CC 82%"], ["20-cx", "CX 90%"]]);
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

test("a failed usage read goes to the OMP log", async () => {
	const m = mount(async () => { throw new Error("no usage"); }); await flush();
	expect(m.painted).toEqual([]);
	expect(m.logs[0]).toEqual(["rqw-harness-interface: subscriptions", { error: expect.stringContaining("no usage") }]);
});
