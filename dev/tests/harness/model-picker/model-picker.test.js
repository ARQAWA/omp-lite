import { expect, test } from "bun:test";
import modelPicker, {
	ModelPicker,
	arrowDirection,
	commitSelection,
	configuredEffort,
	filterModels,
	levelsFor,
	modelLabel,
	nearestLevel,
	openPicker,
	parseArrow,
	shiftArrow,
} from "../../../../src/modules/model-picker/index.js";

const theme = { fg: (role, text) => `{${role}|${text}}`, bold: text => `**${text}**` };
const model = (provider, id, name, efforts) => ({ provider, id, name, thinking: efforts ? { efforts } : undefined });

const opus = model("anthropic", "opus-4-5", "Claude Opus 4.5", ["minimal", "low", "medium", "high"]);
const flash = model("deepseek", "deepseek-flash", "DeepSeek Flash", ["low", "medium", "high", "max"]);
const plain = model("openai", "gpt-plain", "GPT Plain");

const picker = (models, initial = {}) => {
	const done = [];
	const instance = new ModelPicker(models, initial, theme, value => done.push(value));
	return { instance, done };
};

test("levelsFor puts auto, off and the model efforts in picker order", () => {
	expect(levelsFor(opus)).toEqual(["auto", "off", "minimal", "low", "medium", "high"]);
	expect(levelsFor(model("x", "y", "Y", ["high", "low"]))).toEqual(["auto", "off", "low", "high"]);
	expect(levelsFor(plain)).toEqual(["auto", "off"]);
	expect(nearestLevel(opus, "max")).toBe("high");
	expect(nearestLevel(opus, "auto")).toBe("auto");
	expect(nearestLevel(plain, "high")).toBe("off");
});

test("modelLabel drops the Claude prefix and control characters", () => {
	expect(modelLabel(opus)).toBe("Opus 4.5");
	expect(modelLabel(model("x", "y", "DeepSeek  Flash"))).toBe("DeepSeek Flash");
	expect(modelLabel(model("x", "y", "Bad\u0007Name"))).toBe("Bad Name");
	expect(modelLabel(model("x", "y", ""))).toBe("y");
});

test("filterModels matches provider, id and name without case", () => {
	expect(filterModels([opus, flash], "anthro")).toEqual([opus]);
	expect(filterModels([opus, flash], "DEEPSEEK-FLASH")).toEqual([flash]);
	expect(filterModels([opus, flash], "opus")).toEqual([opus]);
	expect(filterModels([opus, flash], "")).toEqual([opus, flash]);
});

test("arrows parse legacy, kitty and release forms", () => {
	expect(shiftArrow("\x1b[1;2A")).toBe("up");
	expect(shiftArrow("\x1b[1;2:2D")).toBe("left");
	expect(shiftArrow("\x1b[1;2:3A")).toBeUndefined();
	expect(shiftArrow("\x1b[A")).toBeUndefined();
	expect(shiftArrow("\x1b[1;6B")).toBeUndefined();
	expect(parseArrow("\x1b[1D")).toEqual({ direction: "left", modifier: 1, event: 1 });
	expect(arrowDirection("\x1b[B")).toBe("down");
	expect(arrowDirection("\x1b[1;2C")).toBe("right");
});

test("Enter, Shift+Enter and Esc close the picker", () => {
	const one = picker([opus], { model: opus });
	one.instance.handleInput("\x1b[13;2u");
	expect(one.done).toEqual([{ model: opus, effort: "auto" }]);

	const two = picker([opus], { model: opus });
	two.instance.handleInput("\x1b[27;2;13~");
	expect(two.done[0].model).toBe(opus);

	const three = picker([opus], { model: opus });
	three.instance.handleInput("\r");
	expect(three.done.length).toBe(1);

	const four = picker([opus], { model: opus });
	four.instance.handleInput("\x1b[27u");
	expect(four.done).toEqual([undefined]);

	const released = picker([opus], { model: opus });
	released.instance.handleInput("\x1b[13;2:3u");
	expect(released.done).toEqual([]);
});

test("letters filter the list and Backspace restores it", () => {
	const { instance } = picker([opus, flash], { model: opus });
	instance.handleInput("deep");
	expect(instance.visible).toEqual([flash]);
	expect(instance.render(120).join("\n")).toContain("Filter: deep");
	for (let index = 0; index < 4; index += 1) instance.handleInput("\x7f");
	expect(instance.visible).toEqual([opus, flash]);
	expect(instance.render(120).join("\n")).toContain("Filter: ");
});

test("arrows move model and effort without wrapping", () => {
	const { instance } = picker([opus, flash], { model: opus, effort: "auto" });
	instance.handleInput("\x1b[B");
	expect(instance.current.model).toBe(flash);
	instance.handleInput("\x1b[B");
	expect(instance.current.model).toBe(flash);
	instance.handleInput("\x1b[A");
	expect(instance.current.model).toBe(opus);
	instance.handleInput("\x1b[A");
	expect(instance.current.model).toBe(opus);

	instance.handleInput("\x1b[C");
	expect(instance.current.effort).toBe("off");
	instance.handleInput("\x1b[D");
	expect(instance.current.effort).toBe("auto");
	instance.handleInput("\x1b[D");
	expect(instance.current.effort).toBe("auto");

	const lower = picker([opus, flash], { model: flash, effort: "max" });
	lower.instance.handleInput("\x1b[A");
	expect(lower.instance.current).toEqual({ model: opus, effort: "high" });
	lower.instance.handleInput("\x1b[C");
	expect(lower.instance.current.effort).toBe("high");
});

test("render marks the selection and paints every effort", () => {
	const { instance } = picker([opus, flash], { model: opus, effort: "auto" });
	const rows = instance.render(120).join("\n");
	expect(rows).toContain("{accent|› }");
	expect(rows).toContain("{text|**Opus 4.5**}");
	expect(rows).toContain("\x1b[38;5;250m");
	for (const level of ["minimal", "low", "medium", "high"]) expect(rows).toContain(level);
	instance.handleInput("\x1b[C");
	expect(instance.render(120).join("\n")).toContain("\x1b[38;5;252m");
});

test("an empty list renders No models", () => {
	const { instance } = picker([]);
	const rows = instance.render(80);
	expect(rows[0]).toContain("Model / effort");
	expect(rows.join("\n")).toContain("{muted|No models}");
	instance.handleInput("\x1b[B");
	instance.handleInput("\r");
	expect(instance.current.model).toBeUndefined();
});

test("configuredEffort prefers the configured auto entry", () => {
	const ctx = branch => ({ sessionManager: { getBranch: () => branch } });
	const pi = { getThinkingLevel: () => "medium" };
	expect(
		configuredEffort(
			ctx([
				{ type: "thinking_level_change", configured: "high", thinkingLevel: "high" },
				{ type: "message" },
				{ type: "thinking_level_change", configured: "auto", thinkingLevel: "high" },
			]),
			pi,
		),
	).toBe("auto");
	expect(configuredEffort(ctx([{ type: "thinking_level_change", thinkingLevel: "low" }]), pi)).toBe("low");
	expect(configuredEffort(ctx([]), pi)).toBe("medium");
});

test("commitSelection switches model first, then effort", async () => {
	const calls = [];
	const pi = {
		setModel: value => (calls.push(["model", value.id]), Promise.resolve(true)),
		setThinkingLevel: value => calls.push(["effort", value]),
	};
	const notes = [];
	const ctx = {
		model: opus,
		models: { current: () => opus },
		ui: { notify: (message, type) => notes.push([message, type]) },
	};
	await commitSelection(pi, ctx, { model: opus, effort: "high" });
	expect(calls).toEqual([["effort", "high"]]);
	calls.length = 0;
	await commitSelection(pi, ctx, { model: flash, effort: "max" });
	expect(calls).toEqual([
		["model", "deepseek-flash"],
		["effort", "max"],
	]);
	expect(notes).toEqual([]);
});

test("a refused model wastes no effort change and warns", async () => {
	const calls = [];
	const notes = [];
	const pi = { setModel: () => Promise.resolve(false), setThinkingLevel: value => calls.push(value) };
	const ctx = {
		model: opus,
		models: { current: () => opus },
		ui: { notify: (message, type) => notes.push([message, type]) },
	};
	await commitSelection(pi, ctx, { model: flash, effort: "max" });
	expect(calls).toEqual([]);
	expect(notes).toEqual([["No authentication for deepseek/deepseek-flash", "warning"]]);
});

function session({ models, custom }) {
	const handlers = {};
	const inputs = [];
	const pi = { on: (event, handler) => (handlers[event] = handler) };
	modelPicker(pi);
	const ctx = {
		mode: "tui",
		hasUI: true,
		agent: { kind: "main" },
		model: models[0],
		sessionManager: { getBranch: () => [] },
		models: { list: () => models, current: () => models[0] },
		ui: {
			notify: () => {},
			custom,
			onTerminalInput: handler => {
				inputs.push(handler);
				return () => inputs.splice(inputs.indexOf(handler), 1);
			},
		},
	};
	return { handlers, inputs, pi, ctx };
}

test("Shift+arrow opens one picker at a time", async () => {
	const notes = [];
	let mounted = 0;
	let close;
	const custom = factory => {
		mounted += 1;
		return new Promise(resolve => {
			const component = factory({}, theme, {}, resolve);
			close = input => component.handleInput(input);
		});
	};
	const env = session({ models: [opus, flash], custom });
	env.ctx.ui.notify = (message, type) => notes.push([message, type]);
	env.handlers.session_start({}, env.ctx);

	expect(env.inputs[0]("\x1b[1;2B")).toEqual({ consume: true });
	expect(mounted).toBe(1);
	expect(env.inputs[0]("\x1b[1;2A")).toBeUndefined();
	expect(mounted).toBe(1);

	close("\x1b[27u");
	await Bun.sleep(0);
	expect(env.inputs[0]("\x1b[1;2C")).toEqual({ consume: true });
	expect(mounted).toBe(2);
	expect(notes).toEqual([]);
});

test("an empty model list warns and reopens", async () => {
	const notes = [];
	let mounted = 0;
	const env = session({
		models: [],
		custom: () => {
			mounted += 1;
			return new Promise(() => {});
		},
	});
	env.ctx.ui.notify = (message, type) => notes.push([message, type]);
	env.handlers.session_start({}, env.ctx);

	expect(env.inputs[0]("\x1b[1;2A")).toEqual({ consume: true });
	await Bun.sleep(0);
	expect(mounted).toBe(0);
	expect(notes).toEqual([["No models available", "warning"]]);
	expect(env.inputs[0]("\x1b[1;2A")).toEqual({ consume: true });
	await Bun.sleep(0);
	expect(notes.length).toBe(2);
});

test("subagents and non-TUI modes never listen", () => {
	const custom = () => new Promise(() => {});
	const sub = session({ models: [opus], custom });
	sub.ctx.agent = { kind: "sub" };
	sub.handlers.session_start({}, sub.ctx);
	expect(sub.inputs).toEqual([]);

	const rpc = session({ models: [opus], custom });
	rpc.ctx.mode = "rpc";
	rpc.handlers.session_start({}, rpc.ctx);
	expect(rpc.inputs).toEqual([]);
});

test("openPicker applies the choice and ignores stale dialogs", async () => {
	const calls = [];
	const pi = {
		setModel: value => (calls.push(["model", value.id]), Promise.resolve(true)),
		setThinkingLevel: value => calls.push(["effort", value]),
	};
	const notes = [];
	const ctx = {
		mode: "tui",
		hasUI: true,
		model: opus,
		sessionManager: { getBranch: () => [{ type: "thinking_level_change", configured: "auto" }] },
		models: { list: () => [opus, flash], current: () => opus },
		ui: {
			notify: (message, type) => notes.push([message, type]),
			custom: factory =>
				new Promise(resolve => {
					const component = factory({}, theme, {}, resolve);
					component.handleInput("\x1b[B");
					component.handleInput("\x1b[13;2u");
				}),
		},
	};
	await openPicker(pi, ctx);
	expect(calls).toEqual([
		["model", "deepseek-flash"],
		["effort", "auto"],
	]);
	expect(notes).toEqual([]);

	calls.length = 0;
	await openPicker(pi, ctx, () => false);
	expect(calls).toEqual([]);
});
