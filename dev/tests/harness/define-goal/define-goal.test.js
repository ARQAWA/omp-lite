import { expect, test } from "bun:test";
import defineGoal, { filterProvider, withoutHidden } from "../../../../src/modules/define-goal/index.js";

function mount() {
	const handlers = {};
	const factories = [];
	const pi = { on: (event, handler) => (handlers[event] = handler) };
	defineGoal(pi);
	const ctx = { ui: { addAutocompleteProvider: factory => factories.push(factory) } };
	handlers.session_start({}, ctx);
	return { handlers, ctx, factories };
}

class Provider {
	#tag = "ok";
	triggerCharacters = ["/"];
	async getSuggestions() {
		return { items: [{ value: "guided-goal" }, { value: "define-goal" }, { value: "goal" }], prefix: "/" };
	}
	applyCompletion() {
		return this.#tag;
	}
	getInlineHint() {
		return this.#tag;
	}
}

test("hides only the built-in guided-goal entry", () => {
	const items = [{ value: "guided-goal" }, { value: "/guided-goal" }, { value: "define-goal" }, { value: "goal" }];
	expect(withoutHidden(items).map(item => item.value)).toEqual(["define-goal", "goal"]);
});

test("filters the built-in entry and keeps provider behavior", async () => {
	const wrapped = filterProvider(new Provider());
	expect((await wrapped.getSuggestions()).items.map(item => item.value)).toEqual(["define-goal", "goal"]);
	expect(wrapped.applyCompletion()).toBe("ok");
	expect(wrapped.getInlineHint()).toBe("ok");
	expect(wrapped.triggerCharacters).toEqual(["/"]);
});

test("wraps the provider once per ui", () => {
	const { handlers, ctx, factories } = mount();
	handlers.session_start({}, ctx);
	expect(factories.length).toBe(1);
});
