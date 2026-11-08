import { expect, test } from "bun:test";
import turnDuration, { durationLabel, runFailed } from "../../../../src/modules/turn-duration/index.js";

function mount(mode = "tui", stopReason = "stop") {
	const handlers = {};
	const sent = [];
	const renderers = {};
	const pi = {
		on: (event, handler) => (handlers[event] = handler),
		registerMessageRenderer: (type, render) => (renderers[type] = render),
		sendMessage: (message, options) => sent.push([message, options]),
	};
	turnDuration(pi);
	return {
		handlers,
		sent,
		renderers,
		ctx: { mode, hasUI: true, agent: { kind: "main" } },
		done: () => handlers.agent_end({ messages: [{ role: "assistant", stopReason }] }, { mode, agent: { kind: "main" } }),
	};
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

test("a user turn prints one line with the whole duration", () => {
	const { handlers, sent, ctx, done } = mount();
	const now = performance.now;
	performance.now = () => 1000;
	handlers.input({ text: "go" }, ctx);
	performance.now = () => 95000;
	done();
	performance.now = now;
	expect(sent.length).toBe(1);
	expect(sent[0][0]).toEqual({
		customType: "omp-lite.turn-duration",
		content: [{ type: "text", text: "⏱ 1m 34s" }],
		display: true,
	});
});

test("a run started without a submitted message stays silent", () => {
	const { sent, done } = mount();
	performance.now = () => 0;
	done();
	expect(sent).toEqual([]);
});

test("quick, aborted, print-mode and error turns stay silent", () => {
	const quick = mount();
	performance.now = () => 0;
	quick.handlers.input({}, quick.ctx);
	performance.now = () => 2000;
	quick.done();
	expect(quick.sent).toEqual([]);

	const aborted = mount("tui", "aborted");
	performance.now = () => 0;
	aborted.handlers.input({}, aborted.ctx);
	performance.now = () => 90000;
	aborted.done();
	expect(aborted.sent).toEqual([]);

	const error = mount("tui", "error");
	performance.now = () => 0;
	error.handlers.input({}, error.ctx);
	performance.now = () => 90000;
	error.done();
	expect(error.sent).toEqual([]);

	const print = mount("print");
	performance.now = () => 0;
	print.handlers.input({}, print.ctx);
	performance.now = () => 90000;
	print.done();
	expect(print.sent).toEqual([]);
});

test("the renderer draws the stored line as a compact row", () => {
	const { renderers } = mount();
	const mark = renderers["omp-lite.turn-duration"]({ content: [{ type: "text", text: "⏱ 2m 4s" }] });
	expect(mark.render(80)).toEqual(["⏱ 2m 4s"]);
	expect(mark.isTranscriptBlockCompact()).toBe(true);
	expect(mark.render(3)).toEqual(["⏱ 2"]);
});
