// One dim line after a long turn: the whole run, tool work included.
const TYPE = "omp-lite.turn-duration";
const THRESHOLD_MS = 30000;

export function durationLabel(ms) {
	if (ms <= THRESHOLD_MS) return undefined;
	const seconds = Math.ceil(ms / 1000);
	const minutes = Math.floor(seconds / 60);
	if (minutes < 60) return minutes > 0 ? `${minutes}m ${seconds % 60}s` : `${seconds}s`;
	const hours = Math.floor(minutes / 60);
	return minutes % 60 > 0 ? `${hours}h ${minutes % 60}m` : `${hours}h`;
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
	pi.on("agent_start", () => {
		started = performance.now();
	});
	pi.on("agent_end", (_event, ctx) => {
		const start = started;
		started = undefined;
		if (start === undefined || ctx.mode !== "tui" || ctx.agent?.kind !== "main") return;
		const label = durationLabel(performance.now() - start);
		if (!label) return;
		pi.sendMessage({ customType: TYPE, content: [{ type: "text", text: `⏱ ${label}` }], display: true });
	});
}
