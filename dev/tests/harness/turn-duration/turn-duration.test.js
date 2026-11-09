import { expect, test } from "bun:test";
import turnDuration, { durationLabel, runFailed } from "../../../../src/modules/turn-duration/index.js";

function mount(mode = "tui") {
	const handlers = {};
	const sent = [];
	const options = [];
	const timers = [];
	const renderers = {};
	const pi = {
		on: (event, handler) => (handlers[event] = handler),
		registerMessageRenderer: (type, render) => (renderers[type] = render),
		sendMessage: (message, option) => (sent.push(message), options.push(option)),
	};
	turnDuration(pi);
	const ctx = { mode, hasUI: true, agent: { kind: "main" }, idle: true, setTimeout: fn => timers.push(fn), isIdle: () => ctx.idle };
	return {
		handlers,
		sent,
		options,
		timers,
		renderers,
		ctx,
		end: (stopReason = "stop", willContinue = false) => {
			handlers.agent_end({ messages: [{ role: "assistant", stopReason }], willContinue }, ctx);
			while (timers.length) timers.shift()();
		},
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
	expect(durationLabel(0)).toBe("1s");
	expect(durationLabel(2000)).toBe("2s");
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
		turn.handlers.input({ text: "go" }, turn.ctx);
		turn.end();
	});
	expect(turn.sent.length).toBe(1);
	expect(turn.sent[0]).toEqual({
		customType: "omp-lite.turn-duration",
		content: [{ type: "text", text: "⏱ 1m 34s" }],
		display: true,
	});
});

test("the line never starts a model turn", () => {
	const turn = mount();
	at([0, 5000], () => {
		turn.handlers.input({ text: "go" }, turn.ctx);
		turn.handlers.agent_end({ messages: [{ role: "assistant", stopReason: "stop" }] }, turn.ctx);
	});
	// Inside agent_end the agent is not idle yet: nothing is sent until the tick after it.
	expect(turn.sent).toEqual([]);
	turn.timers.shift()();
	expect(turn.options).toEqual([{ triggerTurn: false }]);
});

test("a busy agent defers the line to the next turn instead of steering", () => {
	const turn = mount();
	turn.ctx.idle = false;
	at([0, 5000], () => {
		turn.handlers.input({ text: "go" }, turn.ctx);
		turn.end();
	});
	expect(turn.options).toEqual([{ deliverAs: "nextTurn" }]);
});

test("a second start inside one turn does not restart the clock", () => {
	const turn = mount();
	at([0, 60000], () => {
		turn.handlers.input({ text: "go" }, turn.ctx);
		turn.handlers.agent_start({}, turn.ctx);
		turn.handlers.input({ text: "second" }, turn.ctx);
		turn.end();
	});
	expect(turn.sent[0].content[0].text).toBe("⏱ 1m 0s");
});

test("a continuation keeps the measurement for the final completion", () => {
	const turn = mount();
	at([0, 40000], () => {
		turn.handlers.input({ text: "go" }, turn.ctx);
		turn.end("stop", true);
	});
	expect(turn.sent).toEqual([]);
	at([60000], () => turn.end());
	expect(turn.sent.length).toBe(1);
	expect(turn.sent[0].content[0].text).toBe("⏱ 1m 0s");
});

test("aborted, error and print-mode runs stay silent", () => {
	for (const [mode, reason, span] of [
		["tui", "aborted", 90000],
		["tui", "error", 90000],
		["print", "stop", 90000],
	]) {
		const turn = mount(mode);
		at([0, span], () => {
			turn.handlers.input({ text: "go" }, turn.ctx);
			turn.end(reason);
		});
		expect(turn.sent).toEqual([]);
	}
});

test("consecutive runs each measure from their own start", () => {
	const turn = mount();
	at([0, 40000], () => {
		turn.handlers.input({ text: "go" }, turn.ctx);
		turn.end();
	});
	at([100000, 160000], () => {
		turn.handlers.input({ text: "go" }, turn.ctx);
		turn.end();
	});
	expect(turn.sent.map(message => message.content[0].text)).toEqual(["⏱ 40s", "⏱ 1m 0s"]);
});

test("a cancelled preparation does not inflate the next turn", () => {
	const turn = mount();
	at([0, 30000], () => {
		turn.handlers.input({ text: "go" }, turn.ctx);
		turn.end("aborted");
	});
	expect(turn.sent).toEqual([]);
	at([50000, 95000], () => {
		turn.handlers.input({ text: "again" }, turn.ctx);
		turn.end();
	});
	expect(turn.sent.length).toBe(1);
	expect(turn.sent[0].content[0].text).toBe("⏱ 45s");
});

test("a run without a submission prints nothing", () => {
	const turn = mount();
	at([0, 90000], () => turn.end());
	expect(turn.sent).toEqual([]);
});

test("a subagent run neither prints nor resets the main clock", () => {
	const turn = mount();
	const sub = { mode: "tui", hasUI: true, agent: { kind: "sub" } };
	at([0, 20000], () => {
		turn.handlers.input({ text: "go" }, turn.ctx);
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
	const strip = line => line.replace(/\x1b\[[0-9;]*m/g, "");
	expect(strip(mark.render(80)[0])).toBe("⏱ 2m 4s");
	expect(mark.render(80)[0].startsWith("\x1b[2m")).toBe(true);
	expect(mark.render(80)[0].endsWith("\x1b[0m")).toBe(true);
	expect(mark.isTranscriptBlockCompact()).toBe(true);
	expect(strip(mark.render(3)[0])).toBe("⏱ 2");
});

test("a command followed by a message measures the message", () => {
	const turn = mount();
	at([0, 50000, 95000], () => {
		turn.handlers.input({ text: "/model" }, turn.ctx);
		turn.handlers.input({ text: "hello" }, turn.ctx);
		turn.end();
	});
	expect(turn.sent.length).toBe(1);
	expect(turn.sent[0].content[0].text).toBe("⏱ 45s");
});

test("a short turn still gets its line", () => {
	const turn = mount();
	at([0, 2000], () => {
		turn.handlers.input({ text: "go" }, turn.ctx);
		turn.end();
	});
	expect(turn.sent.length).toBe(1);
	expect(turn.sent[0].content[0].text).toBe("⏱ 2s");
});

test("the model request never carries the duration line", () => {
	const turn = mount();
	const user = { role: "user", content: "go" };
	const mark = { role: "custom", customType: "omp-lite.turn-duration", content: [{ type: "text", text: "⏱ 14s" }] };
	const other = { role: "custom", customType: "other", content: "keep" };
	const reply = { role: "assistant", content: [] };
	expect(turn.handlers.context({ messages: [user, reply, mark, other, user] }, turn.ctx)).toEqual({
		messages: [user, reply, other, user],
	});
	expect(turn.handlers.context({ messages: [user, reply] }, turn.ctx)).toBeUndefined();
});
