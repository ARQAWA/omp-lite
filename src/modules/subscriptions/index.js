// Publishes subscription limits as status marks: CC, CX and Go.
// Data comes from `omp usage --json`; subscriptions without a window stay silent.
import { execFile } from "node:child_process";

const KEYS = ["10-cc", "20-cx", "30-go"];
const INTERVAL_MS = 300000;
const TIMEOUT_MS = 20000;

const percent = amount => {
	const fraction = amount?.remainingFraction;
	return typeof fraction === "number" ? `${Math.round(fraction * 100)}%` : undefined;
};

const windowOf = (report, id) => report?.limits?.find(limit => limit.window?.id === id);

export function marks(reports) {
	const byProvider = new Map(reports.map(report => [report.provider, report]));
	const out = [];
	const cc = percent(windowOf(byProvider.get("anthropic"), "7d")?.amount);
	if (cc) out.push(["10-cc", `CC ${cc}`]);
	const cx = percent(windowOf(byProvider.get("openai-codex"), "7d")?.amount);
	if (cx) out.push(["20-cx", `CX ${cx}`]);
	const go = byProvider.get("opencode-go");
	const goWindows = [percent(windowOf(go, "7d")?.amount), percent(windowOf(go, "monthly")?.amount)].filter(Boolean);
	if (goWindows.length > 0) out.push(["30-go", `Go ${goWindows.join("/")}`]);
	return out;
}

function readUsage() {
	return new Promise((resolve, reject) => {
		execFile("omp", ["usage", "--json"], { timeout: TIMEOUT_MS, maxBuffer: 1 << 20 }, (error, stdout) =>
			error ? reject(error) : resolve(stdout),
		);
	});
}

export default function subscriptions(pi, read = readUsage) {
	pi.on("session_start", (_event, ctx) => {
		if (ctx.mode !== "tui" || !ctx.hasUI || ctx.agent?.kind !== "main") return;
		let busy = false;
		const paint = async () => {
			if (busy) return;
			busy = true;
			try {
				const reports = JSON.parse(await read()).reports ?? [];
				const current = marks(reports);
				const present = new Set(current.map(([key]) => key));
				for (const key of KEYS) if (!present.has(key)) ctx.ui.setStatus(key, undefined);
				for (const [key, text] of current) ctx.ui.setStatus(key, text);
			} catch {
				// A failed read keeps the last good marks on screen.
			} finally {
				busy = false;
			}
		};
		void paint();
		ctx.setInterval(() => void paint(), INTERVAL_MS);
	});
}
