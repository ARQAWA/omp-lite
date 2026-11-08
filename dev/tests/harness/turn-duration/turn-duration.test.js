import { expect, test } from "bun:test";
import turnDuration, { durationLabel } from "../../../../src/modules/turn-duration/index.js";

function mount(mode = "tui") {
	const handlers = {};
	const sent = [];
	const renderers = {};
	const pi = {
		on: (event, handler) => (handlers[event] = handler),
		registerMessageRenderer: (type, render) => (renderers[type] = render),
		sendMessage: (message, options) => sent.push([message, options]),
	};
	turnDuration(pi);
	return { handlers, sent, renderers, ctx: { mode, hasUI: true, agent: { kind: "main" } } };
}

test("short and non-completed measurements print nothing", () => {
	expect(durationLabel(30000)).toBeUndefined();
	expect(durationLabel(5000)).toBeUndefined();
	expect(durationLabel(31000)).toBe("31s");
	expect(durationLabel(124000)).toBe("2m 4s");
	expect(durationLabel(3600000)).toBe("1h");
	expect(durationLabel(5400000)).toBe("1h 30m");
});

test("a long turn prints one line with the whole duration", () => {
	const { handlers, sent, ctx } = mount();
	const now = performance.now;
	performance.now = () => 1000;
	handlers.agent_start({}, ctx);
	performance.now = () => 95000;
	handlers.agent_end({ messages: [] }, ctx);
	performance.now = now;
	expect(sent.length).toBe(1);
	expect(sent[0][0]).toEqual({
		customType: "omp-lite.turn-duration",
		content: [{ type: "text", text: "⏱ 1m 34s" }],
		display: true,
	});
	expect(sent[0][1]).toBeUndefined();
});

test("a quick turn and a non-TUI session stay silent", () => {
	const quick = mount();
	performance.now = () => 0;
	quick.handlers.agent_start({}, quick.ctx);
	performance.now = () => 2000;
	quick.handlers.agent_end({}, quick.ctx);
	expect(quick.sent).toEqual([]);

	const print = mount("print");
	performance.now = () => 0;
	print.handlers.agent_start({}, print.ctx);
	performance.now = () => 90000;
	print.handlers.agent_end({}, print.ctx);
	expect(print.sent).toEqual([]);
});

test("the renderer draws the stored line as a compact row", () => {
	const { renderers } = mount();
	const mark = renderers["omp-lite.turn-duration"]({ content: [{ type: "text", text: "⏱ 2m 4s" }] });
	expect(mark.render(80)).toEqual(["⏱ 2m 4s"]);
	expect(mark.isTranscriptBlockCompact()).toBe(true);
	expect(mark.render(3)).toEqual(["⏱ 2"]);
});
