import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { rewritePayload } from "../../../../src/modules/base-tools/index.js";
import texts from "../../../../src/modules/base-tools/base-tools.texts.json";

const natives = JSON.parse(readFileSync(join(import.meta.dir, "native-tools.json"), "utf8"));
const expected = (name, hasFiles) => {
	const entry = texts[name];
	return typeof entry === "string" ? entry : hasFiles ? entry.withFiles : entry.withoutFiles;
};
const openaiPayload = (names = {}) => ({
	tools: natives.map(tool => ({
		type: "function",
		function: {
			name: names[tool.name] ?? tool.name,
			description: tool.description,
			parameters: structuredClone(tool.parameters),
		},
	})),
});

test("the six tool descriptions become ours and schemas stay byte-identical", () => {
	const payload = openaiPayload();
	const before = new Map(payload.tools.map(tool => [tool.function.name, JSON.stringify(tool.function.parameters)]));
	rewritePayload(payload, true);
	for (const tool of payload.tools) {
		expect(tool.function.description).toBe(expected(tool.function.name, true));
		expect(JSON.stringify(tool.function.parameters)).toBe(before.get(tool.function.name));
		expect(tool.function.description).not.toBe(natives.find(native => native.name === tool.function.name).description);
	}
});

test("flat and nested tool forms are rewritten", () => {
	const flat = {
		tools: natives.map(tool => ({ name: tool.name, description: tool.description, input_schema: structuredClone(tool.parameters) })),
	};
	rewritePayload(flat, true);
	for (const tool of flat.tools) expect(tool.description).toBe(expected(tool.name, true));
});

test("a leading underscore is understood", () => {
	const payload = openaiPayload({ grep: "_grep", edit: "_edit", write: "_write" });
	rewritePayload(payload, false);
	expect(payload.tools.find(tool => tool.function.name === "_grep").function.description).toBe(texts.grep.withoutFiles);
	expect(payload.tools.find(tool => tool.function.name === "_edit").function.description).toBe(texts.edit);
});

test("a second pass changes nothing", () => {
	const payload = openaiPayload();
	rewritePayload(payload, true);
	const once = JSON.stringify(payload);
	rewritePayload(payload, true);
	expect(JSON.stringify(payload)).toBe(once);
});

test("past tool calls stay untouched and do not count as available tools", () => {
	const payload = openaiPayload();
	payload.messages = [
		{ role: "assistant", content: [{ type: "tool_use", id: "one", name: "grep", input: { pattern: "x" } }] },
		{ role: "assistant", content: [{ type: "tool_use", id: "two", name: "files", input: {} }] },
	];
	rewritePayload(payload);
	expect(payload.messages[0].content[0]).not.toHaveProperty("description");
	expect(payload.tools.find(tool => tool.function.name === "grep").function.description).toBe(texts.grep.withoutFiles);
});

test("without files no description mentions files", () => {
	const payload = openaiPayload();
	rewritePayload(payload, false);
	const all = payload.tools.map(tool => tool.function.description).join("\n");
	expect(all).not.toContain("`files`");
	expect(payload.tools.find(tool => tool.function.name === "grep").function.description).toContain("Wide search:");
});

test("with files grep, glob and bash name files", () => {
	const payload = openaiPayload();
	rewritePayload(payload, true);
	for (const name of ["grep", "glob", "bash"]) {
		expect(payload.tools.find(tool => tool.function.name === name).function.description).toContain("files");
	}
});

test("the texts have a batch rule, a next step and no subagent words", () => {
	for (const name of ["grep", "glob", "read", "bash", "edit", "write"]) {
		const text = expected(name, true);
		expect(text).toContain("Next step:");
		expect(text).toMatch(/one response|ONE patch/i);
		expect(text).not.toMatch(/scout|subagent|Task \+/i);
	}
});
