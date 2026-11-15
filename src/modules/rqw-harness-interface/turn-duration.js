// Ported from pi-response-duration 1.0.1 (MIT, copyright 2026 tech-msc); see LICENSE.
const TYPE = "omp-lite.turn-duration";
const label = ms => {
	const seconds = Math.max(1, Math.ceil(ms / 1000)), minutes = Math.floor(seconds / 60), hours = Math.floor(minutes / 60);
	return `${hours ? `${hours}h ` : ""}${minutes % 60 ? `${minutes % 60}m ` : ""}${seconds % 60}s`;
};

export default function turnDuration(pi) {
	let started, running = false;
	pi.registerMessageRenderer(TYPE, message => ({
		invalidate() {},
		isTranscriptBlockCompact: () => true,
		render: width => [`\x1b[2m${String(message.content?.[0]?.text ?? "").slice(0, Math.max(0, width))}\x1b[0m`],
	}));
	pi.on("context", event => {
		const messages = event.messages.filter(message => message.customType !== TYPE);
		if (messages.length !== event.messages.length) return { messages };
	});
	pi.on("input", () => { if (!running) started = performance.now(); });
	pi.on("agent_start", () => { running = true; });
	pi.on("agent_end", (event, ctx) => {
		if (ctx.agent?.kind !== "main") return;
		if (event.willContinue) return;
		running = false;
		const start = started;
		started = undefined;
		if (start === undefined || ctx.mode !== "tui" || !event.messages?.some(message => message?.role === "assistant")) return;
		const mark = { customType: TYPE, content: [{ type: "text", text: `⏱ ${label(performance.now() - start)}` }], display: true };
		ctx.setTimeout(() => pi.sendMessage(mark, ctx.isIdle() ? { triggerTurn: false } : { deliverAs: "nextTurn" }), 0);
	});
}
