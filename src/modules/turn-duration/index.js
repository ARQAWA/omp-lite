// One dim line after a long turn: the whole run, tool work included.
const TYPE = "omp-lite.turn-duration";
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
		return [this.text.slice(0, Math.max(0, width))];
	}
}

export default function turnDuration(pi) {
	let started;
	pi.registerMessageRenderer(TYPE, message => new Mark(String(message.content?.[0]?.text ?? "")));
	// The unit is the run, not the keystroke: a command, a shell run or an empty line starts no run,
	// a message queued behind a live run does not restart it, a continuation keeps the first start.
	pi.on("before_agent_start", () => {
		if (started === undefined) started = performance.now();
	});
	pi.on("agent_end", (event, ctx) => {
		if (event.willContinue || ctx.mode !== "tui" || ctx.agent?.kind !== "main") return;
		const start = started;
		started = undefined;
		if (start === undefined) return;
		let last;
		for (const message of event.messages ?? []) if (message?.role === "assistant") last = message;
		if (!last || runFailed(last.stopReason)) return;
		const label = durationLabel(performance.now() - start);
		if (!label) return;
		pi.sendMessage({ customType: TYPE, content: [{ type: "text", text: `⏱ ${label}` }], display: true });
	});
}
