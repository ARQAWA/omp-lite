import { expect, mock, test } from "bun:test";

mock.module("@oh-my-pi/pi-coding-agent/config/registry", () => ({
	lookup: id => (id === "memory.backend" ? { get: settings => settings.backend } : undefined),
}));
const { default: memoryGuide } = await import("../../../../src/modules/memory-guide/index.js");
const text = (await import("../../../../src/modules/memory-guide/memory-guide.json")).default;

function run(value) {
	let handler;
	memoryGuide({ pi: { settings: { backend: value } }, on: (name, fn) => name === "before_agent_start" && (handler = fn) });
	return handler({ systemPrompt: ["base"] });
}

test("mnemopi appends the block after the base prompt", () => {
	expect(run("mnemopi")).toEqual({ systemPrompt: ["base", text.block] });
});

test("memory off leaves the prompt alone", () => {
	expect(run("off")).toBeUndefined();
	expect(run("local")).toBeUndefined();
});
