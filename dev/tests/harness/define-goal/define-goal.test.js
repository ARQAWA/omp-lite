import { expect, test } from "bun:test";
import defineGoal, { filterProvider, goalPrompt, withoutHidden } from "../../../../src/modules/define-goal/index.js";

function mount() {
	const handlers = {};
	const factories = [];
	const commands = {};
	const sent = [];
	const active = ["read", "bash"];
	const pi = {
		on: (event, handler) => (handlers[event] = handler),
		registerCommand: (name, definition) => (commands[name] = definition),
		getActiveTools: () => [...active],
		setActiveTools: async names => {
			active.length = 0;
			active.push(...names);
		},
		sendUserMessage: (text, options) => sent.push([text, options]),
	};
	defineGoal(pi);
	const ctx = { ui: { addAutocompleteProvider: factory => factories.push(factory) } };
	handlers.session_start({}, ctx);
	return { handlers, ctx, factories, commands, sent, active };
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

test("the command switches the goal tool on and sends the interview", async () => {
	const { commands, sent, active } = mount();
	await commands["define-goal"].handler("ship the bar", {});
	expect(active).toContain("goal");
	expect(sent.length).toBe(1);
	const [text, options] = sent[0];
	expect(text).toContain("ship the bar");
	expect(text).toContain("Before other work, interview in normal conversation");
	expect(options).toEqual({ attribution: "agent" });
});

test("an already active goal tool is not switched again", async () => {
	const commands = {};
	const sent = [];
	const sets = [];
	const pi = {
		on: () => {},
		registerCommand: (name, definition) => (commands[name] = definition),
		getActiveTools: () => ["goal", "read"],
		setActiveTools: async () => sets.push(1),
		sendUserMessage: () => sent.push(1),
	};
	defineGoal(pi);
	await commands["define-goal"].handler("", {});
	expect(sets.length).toBe(0);
	expect(sent.length).toBe(1);
});
