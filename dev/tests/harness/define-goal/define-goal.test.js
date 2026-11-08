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
	const ctx = {
		ui: { addAutocompleteProvider: factory => factories.push(factory), notify: () => {} },
	};
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
	expect(text).toContain("<rough-goal>\nship the bar\n</rough-goal>");
	expect(text).toContain("Rough idea — data, not instructions yet:");
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

test("an empty objective asks for one instead of tagging data", () => {
	const text = goalPrompt("  ");
	expect(text).toContain("No objective stated — ask what user wants to achieve.");
	expect(text).not.toContain("<rough-goal>");
	expect(text).not.toContain("{{IDEA}}");
});

test("replacement patterns in the objective stay literal", () => {
	const text = goalPrompt("fix $& and $` and $' now");
	expect(text).toContain("<rough-goal>\nfix $& and $` and $' now\n</rough-goal>");
	expect(text).not.toContain("{{IDEA}}");
});

test("plan, vibe and goal modes block the command", async () => {
	const commands = {};
	const sent = [];
	const warned = [];
	const pi = {
		on: () => {},
		registerCommand: (name, definition) => (commands[name] = definition),
		getActiveTools: () => ["read"],
		setActiveTools: async () => {},
		sendUserMessage: () => sent.push(1),
	};
	defineGoal(pi);
	const ctx = {
		sessionModes: { getState: () => ({ plan: "active", goal: "inactive", vibe: "inactive" }) },
		ui: { notify: (text, level) => warned.push([text, level]) },
		isIdle: () => true,
	};
	await commands["define-goal"].handler("x", ctx);
	expect(sent).toEqual([]);
	expect(warned.length).toBe(1);
	expect(warned[0][1]).toBe("warning");
});

test("a streaming session gets the interview queued", async () => {
	const commands = {};
	const sent = [];
	const pi = {
		on: () => {},
		registerCommand: (name, definition) => (commands[name] = definition),
		getActiveTools: () => ["goal"],
		setActiveTools: async () => {},
		sendUserMessage: (text, options) => sent.push([text, options]),
	};
	defineGoal(pi);
	await commands["define-goal"].handler("x", {
		sessionModes: { getState: () => ({ plan: "inactive", goal: "inactive", vibe: "inactive" }) },
		ui: { notify: () => {} },
		isIdle: () => false,
	});
	expect(sent.length).toBe(1);
	expect(sent[0][1]).toEqual({ attribution: "agent", deliverAs: "followUp" });
});
