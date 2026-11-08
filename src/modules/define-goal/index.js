// Hides the built-in /guided-goal entry so /define-goal is the only goal interview command.
// Autocomplete items carry the bare name in `value` ("guided-goal"), without the slash.
const HIDDEN = new Set(["guided-goal"]);

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

export default function defineGoal(pi) {
	const wired = new WeakSet();
	pi.on("session_start", (_event, ctx) => {
		const ui = ctx.ui;
		if (!ui || typeof ui.addAutocompleteProvider !== "function" || wired.has(ui)) return;
		wired.add(ui);
		ui.addAutocompleteProvider(filterProvider);
	});
}
