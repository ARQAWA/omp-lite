import { expect, mock, test } from "bun:test";
let config = [];
mock.module("@oh-my-pi/pi-coding-agent/config/model-settings", () => ({ cfgEnabledModels: { get: () => config } }));
mock.module("@oh-my-pi/pi-coding-agent/config/settings", () => ({ settings: {} }));
const { default: modelPicker } = await import("../../../../src/modules/rqw-harness-interface/model-picker.js");
import data from "../../../../src/modules/rqw-harness-interface/model-picker.json";

const model = (provider, id, name, efforts) => ({ provider, id, name, thinking: { efforts } });
const opus = model("anthropic", "opus", "Claude Opus", ["low", "medium", "high"]);
const flash = model("opencode-go", "deepseek-v4.1-flash", "DeepSeek Flash", ["low", "high", "max"]);
const router = model("openrouter", "deepseek/deepseek-v4.1-flash-1017", "DeepSeek Flash", ["xhigh", "max"]);
const plain = model("plain-provider", "plain", "A rather long plain model name", []);
const up = "\x1b[1;2A", down = "\x1b[1;2B", left = "\x1b[D", right = "\x1b[C";
const strip = text => text.replace(/\x1b\[[\d;]*m/g, "").replaceAll("**", "");
const flush = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); };

function session({ models = [opus, flash, router, plain], level = "high", setModel } = {}) {
	const events = {}, inputs = [], dialogs = [], calls = [], notes = [];
	const pi = {
		on: (event, fn) => events[event] = fn,
		getThinkingLevel: () => level,
		setModel: value => { calls.push(["model", value]); return setModel ? setModel(value) : Promise.resolve(true); },
		setThinkingLevel: value => calls.push(["effort", value]),
	};
	const ctx = {
		agent: { kind: "main" }, mode: "tui", hasUI: true, model: models[0],
		models: { list: () => models, current: () => models[0] },
		ui: {
			notify: (...args) => notes.push(args),
			onTerminalInput: fn => { inputs.push(fn); return () => { const i = inputs.indexOf(fn); if (i >= 0) inputs.splice(i, 1); }; },
			custom: (factory, options) => new Promise(resolve => { expect(options).toBeUndefined(); dialogs.push(factory({}, { bold: text => `**${text}**` }, {}, resolve)); }),
		},
	};
	modelPicker(pi);
	const start = (event = "session_start", context = ctx) => events[event]({}, context);
	const open = (key = up) => inputs[0](key);
	const rows = (width = 120) => dialogs.at(-1).render(width).map(strip);
	return { events, inputs, dialogs, calls, notes, ctx, start, open, rows };
}

test("opening makes the first move, confirms in order and warns on failure", async () => {
	const s = session(); s.start();
	expect(s.open(down)).toEqual({ consume: true });
	expect(s.rows()).toHaveLength(9);
	expect(s.rows()[5]).toContain("DeepSeek Flash Go");
	expect(s.open(down)).toBeUndefined();
	s.dialogs[0].handleInput(right); s.dialogs[0].handleInput("\x1b[13;2~"); await flush();
	expect(s.calls).toEqual([["model", flash], ["effort", "max"]]);
	for (const [result, warning] of [[false, "No authentication for "], [new Error("oops"), "Could not switch to "]]) {
		const x = session({ setModel: () => result instanceof Error ? Promise.reject(result) : Promise.resolve(result) });
		x.start(); x.open(down); x.dialogs[0].handleInput("\r"); await flush();
		expect(x.calls).toEqual([["model", flash]]);
		expect(x.notes[0][0]).toStartWith(warning + "opencode-go/deepseek-v4.1-flash");
		expect(x.notes[0][1]).toBe("warning");
	}
});

test("escape and control-C cancel; release events never act", async () => {
	for (const cancel of ["\x1b", "\x1b[27u", "\x03"]) {
		const s = session(); s.start();
		expect(s.open("\x1b[1;2:3B")).toBeUndefined();
		s.open(down); s.dialogs[0].handleInput("\x1b[13;2:3u");
		s.dialogs[0].handleInput("\x1b[1;2:3B"); s.dialogs[0].handleInput(cancel); await flush();
		expect(s.calls).toEqual([]);
	}
});

test("case-insensitive filter includes alias and backspace restores choices", async () => {
	const s = session(); s.start(); s.open();
	s.dialogs[0].handleInput("FLASH OPENROUTER");
	expect(s.rows()[5]).toContain("DeepSeek Flash OpenRouter");
	s.dialogs[0].handleInput("z");
	expect(s.rows().join("\n")).toContain("No models");
	s.dialogs[0].handleInput("\x1b[127u");
	expect(s.rows()[5]).toContain("DeepSeek Flash OpenRouter");
	for (let i = 0; i < "FLASH OPENROUTER".length; i++) s.dialogs[0].handleInput("\x7f");
	expect(s.rows().join("\n")).toContain("Opus");
	s.dialogs[0].handleInput("\x1b[27;2;13~"); await flush();
	expect(s.calls).toEqual([["model", router], ["effort", "xhigh"]]);
});

test("edges do not wrap and efforts choose the nearest lower or minimum", async () => {
	const s = session({ models: [opus, flash, router], level: "max" }); s.start(); s.open(up);
	expect(s.rows()[5]).toContain("Opus"); s.dialogs[0].handleInput(left);
	s.dialogs[0].handleInput(down); s.dialogs[0].handleInput(down); s.dialogs[0].handleInput(down);
	expect(s.rows()[5]).toContain("OpenRouter"); s.dialogs[0].handleInput(right);
	s.dialogs[0].handleInput("\x1b[13;2u"); await flush();
	expect(s.calls).toEqual([["model", router], ["effort", "max"]]);
	const x = session({ models: [opus, flash], level: "max" }); x.start(); x.open(down);
	x.dialogs[0].handleInput(up); x.dialogs[0].handleInput("\n"); await flush();
	expect(x.calls).toEqual([["effort", "high"]]);
	const y = session({ models: [opus, plain], level: "off" }); y.start(); y.open(down);
	y.dialogs[0].handleInput("\r"); await flush(); expect(y.calls).toEqual([["model", plain]]);
	const z = session({ models: [plain, opus], level: "low" }); z.start(); z.open(down);
	z.dialogs[0].handleInput("\r"); await flush(); expect(z.calls).toEqual([["model", opus], ["effort", "low"]]);
});

test("enabledModels restricts the list; empty config shows all", () => {
	for (const [value, expected] of [[["opencode-go/*"], "Flash Go"], [[], "Opus"]]) {
		config = value; const s = session(); s.start();
		s.open(up); expect(s.rows()[5]).toContain(expected);
	}
});

test("/new and branch re-subscribe and old picker cannot apply", async () => {
	const s = session(); s.start(); s.open(down); const old = s.dialogs[0];
	s.start("session_switch"); expect(s.inputs).toHaveLength(1);
	old.handleInput("\r"); await flush(); expect(s.calls).toEqual([]);
	expect(s.open(down)).toEqual({ consume: true });
	s.dialogs[1].handleInput("\x1b"); await flush();
	s.start("session_branch"); expect(s.inputs).toHaveLength(1);
	s.events.session_shutdown(); expect(s.inputs).toHaveLength(0);
});

test("narrow width truncates names, preserves efforts, and displays required width", () => {
	const s = session({ models: [{ ...opus, name: "Claude Opus long" }, plain] }); s.start(); s.open(up);
	expect(s.rows(22)[5]).toContain("Opu… low medium high");
	expect(s.rows(22)[6]).toContain("A rather long plain…");
	expect(s.rows(21).join("")).toContain("Effort needs 22 columns");
	expect(s.rows(22)[8]).toBe("Enter/Esc");
});

test("truecolor is fixed by JSON; provider labels are absent", () => {
	const s = session(); s.start(); s.open(up);
	expect(data.colors).toEqual({ accent: "#c9a227", muted: "#b8b3aa", dim: "#96918a", error: "#ff4757", low: "#80ffc4", medium: "#00df77", high: "#c9a227", xhigh: "#b97cff", max: "#ff4757" });
	const rows = s.dialogs[0].render(120), all = rows.join("\n"), hex = name => {
		const c = data.colors[name]; return `\x1b[38;2;${parseInt(c.slice(1, 3), 16)};${parseInt(c.slice(3, 5), 16)};${parseInt(c.slice(5), 16)}m`;
	};
	for (const name of ["accent", "muted", "dim", "high"]) expect(all).toContain(hex(name));
	expect(all).not.toContain("anthropic"); expect(all).not.toContain("opencode-go"); expect(all).not.toContain("openrouter/");
	expect(rows[5]).toContain(hex("high") + "**high**\x1b[39m");
	expect(s.dialogs[0].render(10).join("")).toContain(hex("error"));
	const x = session({ models: [model("x", "y", "all", data.effortOrder)], level: "low" }); x.start(); x.open(up);
	for (const level of data.effortOrder) { expect(x.dialogs[0].render(120)[5]).toContain(hex(level) + `**${level}**\x1b[39m`); x.dialogs[0].handleInput(right); }
});

test("subagents, non-TUI and headless sessions do not subscribe", () => {
	for (const change of [{ agent: { kind: "sub" } }, { mode: "rpc" }, { hasUI: false }]) {
		const s = session(); s.start("session_start", { ...s.ctx, ...change }); expect(s.inputs).toEqual([]);
	}
});
