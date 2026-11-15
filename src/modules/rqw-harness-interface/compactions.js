export default function compactions(pi) {
	let live;
	const paint = () => {
		if (live) live.ui.setStatus("40-cmp", `cmp ${live.sessionManager.getEntries().filter(entry => entry.type === "compaction").length}`);
	};
	const attach = (_event, ctx) => {
		live = ctx.mode === "tui" && ctx.hasUI && ctx.agent.kind === "main" ? ctx : undefined;
		paint();
	};
	for (const event of ["session_start", "session_switch"]) pi.on(event, attach);
	for (const event of ["session_compact", "session_branch"]) pi.on(event, paint);
	pi.on("session_shutdown", () => { live = undefined; });
}
