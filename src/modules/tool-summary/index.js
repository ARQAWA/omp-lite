// One live line with tool counters; tool cards stay hidden.
import data from "./tool-summary.json";

const ORDER = ["read", "edit", "search", "run", "other"];
const kind = name => data.tools[name] ?? "other";

export function summarize(calls) {
	const counts = { read: 0, edit: 0, search: 0, run: 0, other: 0 };
	let failed = 0;
	for (const call of calls) {
		counts[kind(call.name)] += 1;
		if (call.isError) failed += 1;
	}
	const parts = [];
	for (const key of ORDER) if (counts[key] > 0) parts.push(`${data.labels[key]} ${counts[key]}`);
	if (failed > 0) parts.push(`${data.labels.fail} ${failed}`);
	return parts.join(" · ");
}

export default function toolSummary(pi) {
	let ctx;
	let calls = [];

	const paint = () => {
		ctx?.ui?.setWidget?.("tool-summary", calls.length > 0 ? [summarize(calls)] : undefined);
	};
	const reset = () => {
		calls = [];
		paint();
	};

	pi.on("session_start", (_event, session) => {
		ctx = session;
		reset();
	});
	pi.on("agent_start", reset);
	pi.on("tool_execution_start", event => {
		calls.push({ id: event.toolCallId, name: event.toolName, isError: false });
		paint();
	});
	pi.on("tool_execution_end", event => {
		const call = calls.find(item => item.id === event.toolCallId);
		if (!call || event.isError !== true) return;
		call.isError = true;
		paint();
	});
}
