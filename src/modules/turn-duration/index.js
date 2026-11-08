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
	// Only a submitted message arms the clock, so runs started by other extensions stay silent.
	// A command without a turn and a message queued behind a running turn must not re-arm it.
	pi.on("input", event => {
		if (started !== undefined || String(event?.text ?? "").trimStart().startsWith("/")) return;
		started = performance.now();
	});
	pi.on("agent_end", (event, ctx) => {
		if (event.willContinue) return;
		const start = started;
		started = undefined;
		if (start === undefined || ctx.mode !== "tui" || ctx.agent?.kind !== "main") return;
		let last;
		for (const message of event.messages ?? []) if (message?.role === "assistant") last = message;
		if (!last || runFailed(last.stopReason)) return;
		const label = durationLabel(performance.now() - start);
		if (!label) return;
		pi.sendMessage({ customType: TYPE, content: [{ type: "text", text: `⏱ ${label}` }], display: true });
	});
}
