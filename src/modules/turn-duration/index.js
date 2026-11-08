// One dim line after a long turn: the whole run, tool work included.
// Ported from pi-response-duration 1.0.1 (MIT, copyright 2026 tech-msc); see LICENSE.
const TYPE = "omp-lite.turn-duration";
const DIM = "\x1b[2m";
const RESET = "\x1b[0m";
const THRESHOLD_MS = 30000;

export function durationLabel(ms) {
	if (ms <= THRESHOLD_MS) return undefined;
	const seconds = Math.ceil(ms / 1000);
	const minutes = Math.floor(seconds / 60);
	if (minutes < 60) return minutes > 0 ? `${minutes}m ${seconds % 60}s` : `${seconds}s`;
	const hours = Math.floor(minutes / 60);
	const left = minutes % 60;
	const rest = seconds % 60;
	return left > 0 ? `${hours}h ${left}m ${rest}s` : `${hours}h ${rest}s`;
}

export function runFailed(stopReason) {
	return stopReason === "aborted" || stopReason === "error";
}

class Mark {
	constructor(text) {
		this.text = text;
	}
	invalidate() {}
	isTranscriptBlockCompact() {
		return true;
	}
	render(width) {
		return [`${DIM}${this.text.slice(0, Math.max(0, width))}${RESET}`];
	}
}

export default function turnDuration(pi) {
	let started;
	let running = false;
	pi.registerMessageRenderer(TYPE, message => new Mark(String(message.content?.[0]?.text ?? "")));
	// The clock starts with the submission, the way the owner asked, and the unit is the turn:
	// a queued message does not restart it, a continuation keeps it, any end of the main agent
	// clears it, so a cancelled preparation cannot inflate the next turn.
	pi.on("input", () => {
		if (!running) started = performance.now();
	});
	pi.on("agent_start", () => {
		running = true;
	});
	pi.on("agent_end", (event, ctx) => {
		if (ctx.agent?.kind !== "main") return;
		if (!event.willContinue) running = false;
		const start = started;
		if (!event.willContinue) started = undefined;
		if (start === undefined || event.willContinue || ctx.mode !== "tui") return;
		let last;
		for (const message of event.messages ?? []) if (message?.role === "assistant") last = message;
		if (!last || runFailed(last.stopReason)) return;
		const label = durationLabel(performance.now() - start);
		if (!label) return;
		pi.sendMessage({ customType: TYPE, content: [{ type: "text", text: `⏱ ${label}` }], display: true });
	});
}
