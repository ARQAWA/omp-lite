// One live line with tool counters under the editor.
import data from "./tool-summary.json";

export function summarize(calls) {
	const counts = {};
	for (const { name, isError } of calls) {
		const kind = data.tools[name] ?? "other";
		counts[kind] = (counts[kind] ?? 0) + 1;
		if (isError) counts.fail = (counts.fail ?? 0) + 1;
	}
	return Object.entries(data.labels)
		.filter(([key]) => counts[key])
		.map(([key, label]) => `${label} ${counts[key]}`)
		.join(" · ");
}

export default function toolSummary(pi) {
	let calls = [];
	const paint = ctx => ctx.ui.setWidget("tool-summary", calls.length > 0 ? [summarize(calls)] : undefined, { placement: "belowEditor" });
	const reset = (_event, ctx) => {
		calls = [];
		paint(ctx);
	};
	pi.on("agent_start", reset);
	// A queued request is dequeued inside a live run, without another agent_start.
	pi.on("before_agent_start", reset);
	pi.on("tool_execution_start", (event, ctx) => {
		calls.push({ id: event.toolCallId, name: event.toolName, isError: false });
		paint(ctx);
	});
	pi.on("tool_execution_end", (event, ctx) => {
		const call = calls.find(item => item.id === event.toolCallId);
		if (!call || event.isError !== true) return;
		call.isError = true;
		paint(ctx);
	});
}
