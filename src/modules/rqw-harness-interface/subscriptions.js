import { execFile } from "node:child_process";
import { reportMatchesActiveAccount } from "@oh-my-pi/pi-coding-agent/slash-commands/helpers/active-oauth-account";

const readUsage = () => new Promise((resolve, reject) => execFile("omp", ["usage", "--json"], { timeout: 20000, maxBuffer: 1 << 20 }, (error, stdout) => error ? reject(error) : resolve(stdout)));
const groups = [["anthropic", "10-cc", "CC", ["7d"]], ["openai-codex", "20-cx", "CX", ["7d"]], ["opencode-go", "30-go", "Go", ["7d", "monthly"]]];

export default function subscriptions(pi, read = readUsage) {
	pi.on("session_start", (_event, ctx) => {
		if (ctx.mode !== "tui" || !ctx.hasUI || ctx.agent?.kind !== "main") return;
		let busy = false;
		const paint = async () => {
			if (busy) return;
			busy = true;
			try {
				const reports = JSON.parse(await read()).reports ?? [];
				const selected = new Map(reports.map(report => [report.provider, report]));
				for (const provider of selected.keys()) {
					const active = ctx.modelRegistry?.authStorage.oauth.accounts(provider, ctx.sessionManager.getSessionId()).find(account => account.active);
					const matches = active && reports.filter(report => report.provider === provider && reportMatchesActiveAccount(report, active));
					if (matches?.length === 1) selected.set(provider, matches[0]);
				}
				const marks = groups.map(([provider, key, label, windows]) => {
					const values = windows.map(id => selected.get(provider)?.limits?.find(limit => limit.scope?.shared && !limit.scope.tier && limit.window?.id === id)?.amount?.remainingFraction).filter(value => typeof value === "number").map(value => `${Math.round(value * 100)}%`);
					return [key, values.length ? `${label} ${values.join("/")}` : undefined];
				});
				for (const [key, value] of marks.filter(([, value]) => !value)) ctx.ui.setStatus(key, value);
				for (const [key, value] of marks.filter(([, value]) => value)) ctx.ui.setStatus(key, value);
			} catch {} finally { busy = false; }
		};
		void paint();
		ctx.setInterval(paint, 300000);
	});
}
