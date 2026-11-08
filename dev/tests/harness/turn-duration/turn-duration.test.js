import { expect, test } from "bun:test";
import turnDuration, { durationLabel, runFailed } from "../../../../src/modules/turn-duration/index.js";

function mount(mode = "tui") {
	const handlers = {};
	const sent = [];
	const renderers = {};
	const pi = {
		on: (event, handler) => (handlers[event] = handler),
		registerMessageRenderer: (type, render) => (renderers[type] = render),
		sendMessage: message => sent.push(message),
	};
	turnDuration(pi);
	const ctx = { mode, hasUI: true, agent: { kind: "main" } };
	return {
		handlers,
		sent,
		renderers,
		ctx,
		start: () => handlers.before_agent_start({}, ctx),
		end: (stopReason = "stop", willContinue = false) =>
			handlers.agent_end({ messages: [{ role: "assistant", stopReason }], willContinue }, ctx),
	};
}

function at(times, body) {
	const now = performance.now;
	let index = 0;
	performance.now = () => times[Math.min(index++, times.length - 1)];
	try {
		return body();
	} finally {
		performance.now = now;
	}
}

test("labels stay readable across seconds, minutes and hours", () => {
	expect(durationLabel(30000)).toBeUndefined();
	expect(durationLabel(31000)).toBe("31s");
	expect(durationLabel(124000)).toBe("2m 4s");
	expect(durationLabel(3601000)).toBe("1h 1s");
	expect(durationLabel(5400000)).toBe("1h 30m 0s");
});

test("failed and aborted runs are not labelled", () => {
	expect(runFailed("error")).toBe(true);
	expect(runFailed("aborted")).toBe(true);
	expect(runFailed("stop")).toBe(false);
});

test("a run prints one line with the whole duration", () => {
	const turn = mount();
	at([1000, 95000], () => {
		turn.start();
		turn.end();
	});
	expect(turn.sent.length).toBe(1);
	expect(turn.sent[0]).toEqual({
		customType: "omp-lite.turn-duration",
		content: [{ type: "text", text: "⏱ 1m 34s" }],
		display: true,
	});
});

test("a second start inside one turn does not restart the clock", () => {
	const turn = mount();
	at([0, 60000], () => {
		turn.start();
		turn.start();
		turn.end();
	});
	expect(turn.sent[0].content[0].text).toBe("⏱ 1m 0s");
});

test("a continuation keeps the measurement for the final completion", () => {
	const turn = mount();
	at([0, 40000], () => {
		turn.start();
		turn.end("stop", true);
	});
	expect(turn.sent).toEqual([]);
	at([60000], () => turn.end());
	expect(turn.sent.length).toBe(1);
	expect(turn.sent[0].content[0].text).toBe("⏱ 1m 0s");
});

test("quick, aborted, error and print-mode runs stay silent", () => {
	for (const [mode, reason, span] of [
		["tui", "stop", 2000],
		["tui", "aborted", 90000],
		["tui", "error", 90000],
		["print", "stop", 90000],
	]) {
		const turn = mount(mode);
		at([0, span], () => {
			turn.start();
			turn.end(reason);
		});
		expect(turn.sent).toEqual([]);
	}
});

test("a run without a start event prints nothing", () => {
	const turn = mount();
	at([0, 90000], () => turn.end());
	expect(turn.sent).toEqual([]);
});

test("a subagent run neither prints nor resets the main clock", () => {
	const turn = mount();
	const sub = { mode: "tui", hasUI: true, agent: { kind: "sub" } };
	at([0, 20000], () => {
		turn.start();
		turn.handlers.before_agent_start({}, sub);
		turn.handlers.agent_end({ messages: [{ role: "assistant", stopReason: "stop" }] }, sub);
	});
	expect(turn.sent).toEqual([]);
	at([50000], () => turn.end());
	expect(turn.sent.length).toBe(1);
	expect(turn.sent[0].content[0].text).toBe("⏱ 50s");
});

test("the renderer draws the stored line as a compact row", () => {
	const turn = mount();
	const mark = turn.renderers["omp-lite.turn-duration"]({ content: [{ type: "text", text: "⏱ 2m 4s" }] });
	expect(mark.render(80)).toEqual(["⏱ 2m 4s"]);
	expect(mark.isTranscriptBlockCompact()).toBe(true);
	expect(mark.render(3)).toEqual(["⏱ 2"]);
});
