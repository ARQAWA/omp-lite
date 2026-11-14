// Shows how many compactions the session has already run.
const KEY = "40-cmp";

export default function compactions(pi) {
	let live;
	const paint = () => {
		if (!live) return;
		const n = live.sessionManager.getEntries().filter(entry => entry.type === "compaction").length;
		live.ui.setStatus(KEY, `cmp ${n}`);
	};
	const attach = (_event, ctx) => {
		live = ctx.mode === "tui" && ctx.hasUI && ctx.agent.kind === "main" ? ctx : undefined;
		paint();
	};
	pi.on("session_start", attach);
	pi.on("session_switch", attach);
	for (const event of ["session_compact", "session_branch"]) pi.on(event, paint);
	pi.on("session_shutdown", () => {
		live = undefined;
	});
}
