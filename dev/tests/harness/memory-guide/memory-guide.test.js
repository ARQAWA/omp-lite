import { expect, mock, test } from "bun:test";

let backend;
mock.module("@oh-my-pi/pi-coding-agent/config/registry", () => ({
	lookup: id => (id === "memory.backend" ? { get: () => backend } : undefined),
}));
const { default: memoryGuide } = await import("../../../../src/modules/memory-guide/index.js");
const text = (await import("../../../../src/modules/memory-guide/memory-guide.json")).default;

function run(value) {
	backend = value;
	let handler;
	memoryGuide({ pi: { settings: {} }, on: (name, fn) => name === "before_agent_start" && (handler = fn) });
	return handler({ systemPrompt: ["base"] });
}

test("mnemopi appends the block after the base prompt", () => {
	expect(run("mnemopi")).toEqual({ systemPrompt: ["base", text.block] });
	expect(text.block).toContain("Never retain secrets");
});

test("memory off leaves the prompt alone", () => {
	expect(run("off")).toBeUndefined();
	expect(run("local")).toBeUndefined();
});
