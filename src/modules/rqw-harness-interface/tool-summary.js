import data from "./tool-summary.json";

export default function toolSummary(pi) {
	let calls = [];
	const paint = ctx => {
		if (ctx.mode !== "tui" || !ctx.hasUI || ctx.agent.kind !== "main") return;
		const counts = {};
		for (const call of calls) {
			const kind = data.tools[call.name] ?? "other";
			counts[kind] = (counts[kind] ?? 0) + 1;
			if (call.isError) counts.fail = (counts.fail ?? 0) + 1;
		}
		const line = Object.entries(data.labels).filter(([key]) => counts[key]).map(([key, label]) => `${label} ${counts[key]}`).join(" · ");
		ctx.ui.setWidget("tool-summary", line ? [line] : undefined, { placement: "belowEditor" });
	};
	const reset = (_event, ctx) => { calls = []; paint(ctx); };
	for (const event of ["agent_start", "before_agent_start"]) pi.on(event, reset);
	pi.on("tool_execution_start", (event, ctx) => { calls.push({ id: event.toolCallId, name: event.toolName }); paint(ctx); });
	pi.on("tool_execution_end", (event, ctx) => {
		const call = calls.find(item => item.id === event.toolCallId);
		if (call && event.isError === true) { call.isError = true; paint(ctx); }
	});
}
