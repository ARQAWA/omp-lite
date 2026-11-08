// Shows how many background jobs the session is still running in the status line.
const INTERVAL_MS = 2000;

export function jobsText(running) {
	return running > 0 ? `⚙ ${running}` : undefined;
}

export default function backgroundJobs(pi) {
	pi.on("session_start", (_event, ctx) => {
		if (ctx.mode !== "tui" || !ctx.hasUI || ctx.agent?.kind !== "main") return;
		const paint = () => {
			const running = ctx.getAsyncJobSnapshot?.()?.running?.length ?? 0;
			ctx.ui.setStatus("50-jobs", jobsText(running));
		};
		paint();
		ctx.setInterval(paint, INTERVAL_MS);
	});
}
