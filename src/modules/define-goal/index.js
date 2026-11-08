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
	return PROMPT.replace("{{IDEA}}", block);
}

export default function defineGoal(pi) {
	pi.registerCommand("define-goal", {
		description: "Define the goal in chat, then start goal mode",
		handler: async (args, _ctx) => {
			const active = pi.getActiveTools();
			if (!active.includes("goal")) await pi.setActiveTools([...active, "goal"]);
			pi.sendUserMessage(goalPrompt(args), { attribution: "agent" });
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
