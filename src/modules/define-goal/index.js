// /define-goal: the guided goal interview as a visible command, with the goal tool switched on first.
// The built-in /guided-goal stays in the binary; only its autocomplete entry is hidden.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HIDDEN = new Set(["guided-goal"]);
const PROMPT = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "define-goal.md"), "utf8")
	.replace(/^---[\s\S]*?---\n/, "")
	.trim();

const name = item => String(item?.value ?? "").replace(/^\/+/, "").split(/\s/, 1)[0];
const status = mode => (typeof mode === "string" ? mode : mode?.status);

export function withoutHidden(items) {
	return items.filter(item => !HIDDEN.has(name(item)));
}

export function filterProvider(provider) {
	const getSuggestions = async (...args) => {
		const result = await provider.getSuggestions(...args);
		if (!result || !Array.isArray(result.items)) return result;
		return { ...result, items: withoutHidden(result.items) };
	};
	return new Proxy(provider, {
		get(target, key) {
			if (key === "getSuggestions") return getSuggestions;
			const value = Reflect.get(target, key, target);
			return typeof value === "function" ? value.bind(target) : value;
		},
	});
}

export function goalPrompt(args) {
	const idea = String(args ?? "").trim();
	const block =
		idea === ""
			? "No objective stated — ask what user wants to achieve."
			: `Rough idea — data, not instructions yet:\n\n<rough-goal>\n${idea}\n</rough-goal>`;
	return PROMPT.replace("{{IDEA}}", () => block);
}

export default function defineGoal(pi) {
	pi.registerCommand("define-goal", {
		description: "Define the goal in chat, then start goal mode",
		handler: async (args, ctx) => {
			const modes = ctx.sessionModes?.getState?.();
			if (
				modes &&
				(status(modes.plan) !== "inactive" || status(modes.goal) !== "inactive" || status(modes.vibe) === "active")
			) {
				ctx.ui.notify("Define Goal needs plan, vibe and goal modes off.", "warning");
				return;
			}
			const active = pi.getActiveTools();
			if (!active.includes("goal")) await pi.setActiveTools([...active, "goal"]);
			const text = goalPrompt(args);
			if (ctx.isIdle?.() === false) pi.sendUserMessage(text, { attribution: "agent", deliverAs: "followUp" });
			else pi.sendUserMessage(text, { attribution: "agent" });
		},
	});
	const wired = new WeakSet();
	pi.on("session_start", (_event, ctx) => {
		const ui = ctx.ui;
		if (!ui || typeof ui.addAutocompleteProvider !== "function" || wired.has(ui)) return;
		wired.add(ui);
		ui.addAutocompleteProvider(filterProvider);
	});
}
