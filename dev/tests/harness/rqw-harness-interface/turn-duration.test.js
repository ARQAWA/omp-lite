import { expect, test } from "bun:test";
import turnDuration from "../../../../src/modules/rqw-harness-interface/turn-duration.js";

function mount() {
	const handlers = {}, sent = [], timers = []; let render;
	turnDuration({ on: (name, fn) => handlers[name] = fn, registerMessageRenderer: (_type, fn) => render = fn, sendMessage: (...args) => sent.push(args) });
	const ctx = { mode: "tui", agent: { kind: "main" }, setTimeout: (fn, ms) => { expect(ms).toBe(0); timers.push(fn); } };
	return { handlers, sent, timers, ctx, render: message => render(message), end: (willContinue = false, reason = "stop", context = ctx) => handlers.agent_end({ messages: [{ role: "assistant", stopReason: reason }], willContinue }, context) };
}

test("timing includes tools and continuations, not queued input; sends after a tick even on failure", () => {
	const now = performance.now; let time = 0; performance.now = () => time;
	try {
		const m = mount(), h = m.handlers;
		h.input(); h.agent_start(); time = 20000; h.input(); m.end(true); expect(m.timers).toHaveLength(0);
		time = 94001; m.end(false, "error"); expect(m.sent).toEqual([]); m.timers.shift()();
		expect(m.sent[0]).toEqual([{ customType: "omp-lite.turn-duration", content: [{ type: "text", text: "⏱ 1m 35s" }], display: true, excludeFromContext: true }, { deliverAs: "nextTurn" }]);
		for (const [elapsed, expected] of [[0, "1s"], [60000, "1m 0s"], [3601000, "1h 1s"], [5400000, "1h 30m 0s"]]) {
			time = 0; h.input(); h.agent_start(); time = elapsed; m.end(false, "aborted"); m.timers.shift()();
			expect(m.sent.at(-1)[0].content[0].text).toBe(`⏱ ${expected}`);
		}
		m.end(); expect(m.timers).toHaveLength(0);
		h.input(); m.end(false, "stop", { ...m.ctx, agent: { kind: "sub" } }); expect(m.timers).toHaveLength(0); m.end(); expect(m.timers).toHaveLength(1);
	} finally { performance.now = now; }
});

test("session boundaries discard a paused turn's clock", () => {
	const now = performance.now; let time = 0; performance.now = () => time;
	try {
		for (const boundary of ["session_clear", "session_switch", "session_branch"]) {
			const m = mount(), h = m.handlers;
			time = 0; h.input(); h.agent_start(); time = 1000; m.end(true);
			h[boundary]({}, m.ctx); time = 60000; h.input(); h.agent_start(); time = 62000; m.end(); m.timers.shift()();
			expect(m.sent[0][0].content[0].text).toBe("⏱ 2s");
			time = 63000; h.input(); h.agent_start(); m.end(true); h[boundary]({}, m.ctx);
			h.agent_start(); m.end(); expect(m.timers).toHaveLength(0);
		}
	} finally { performance.now = now; }
});

test("renderer and context keep the mark visible but out of model input", () => {
	const m = mount(), user = { role: "user" }, mark = { customType: "omp-lite.turn-duration", content: [{ type: "text", text: "⏱ 2m 4s" }] };
	expect(m.handlers.context({ messages: [user, mark] })).toEqual({ messages: [user] });
	expect(m.handlers.context({ messages: [user] })).toBeUndefined();
	const renderer = m.render(mark); expect(renderer.isTranscriptBlockCompact()).toBe(true); expect(renderer.render(3)).toEqual(["\x1b[2m⏱ 2\x1b[0m"]);
});
