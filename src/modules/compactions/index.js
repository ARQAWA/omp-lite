// Shows how many compactions the session has already run.
const KEY = "40-cmp";

export function compactionCount(entries) {
	return entries.filter(entry => entry?.type === "compaction").length;
}

export function compactionsText(count) {
	return `cmp ${count}`;
}

export default function compactions(pi) {
	let live;
	const paint = () => {
		if (!live) return;
		const entries = live.sessionManager?.getEntries?.() ?? [];
		live.ui.setStatus(KEY, compactionsText(compactionCount(entries)));
	};
	pi.on("session_start", (_event, ctx) => {
		live = ctx.mode === "tui" && ctx.hasUI && ctx.agent?.kind === "main" ? ctx : undefined;
		paint();
	});
	for (const event of ["session_compact", "session_branch", "session_tree"]) pi.on(event, paint);
	pi.on("session_shutdown", () => {
		live = undefined;
	});
}
