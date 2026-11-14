import { expect, test } from "bun:test";
import dyslexia, { BLOCK } from "../../../../src/modules/dyslexia/index.js";

const main = { agent: { kind: "main" } };
const sub = { agent: { kind: "sub" } };
const part = text => ({ type: "text", text });
const tail = `\n\n${BLOCK}`;

function handler() {
	const names = [];
	let fn;
	dyslexia({ on: (name, handle) => (names.push(name), (fn = handle)) });
	expect(names).toEqual(["context"]);
	return fn;
}

test("every user message of a request ends with the rule once, other roles stay", () => {
	const typed = { role: "user", content: [part("a")] };
	const assistant = { role: "assistant", content: [part("x")] };
	const legacy = { role: "user", content: "b" };
	const pasted = { role: "user", content: [part("c"), { type: "image", data: "x", mimeType: "image/png" }] };
	const run = handler();
	const out = run({ messages: [typed, assistant, legacy, pasted] }, main).messages;
	expect(out[0].content).toEqual([part(`a${tail}`)]);
	expect(out[1]).toBe(assistant);
	expect(out[2].content).toBe(`b${tail}`);
	expect(out[3].content).toEqual([...pasted.content, part(BLOCK)]);
	expect(run({ messages: out }, main)).toBeUndefined();
});

test("subagents get nothing", () => {
	expect(handler()({ messages: [{ role: "user", content: "a" }] }, sub)).toBeUndefined();
});

test("the rule keeps every ordered item and ends with the mixed message line", () => {
	for (const item of ["at most 8 words", "at most 4 sentences", "Bold", "Short steps", "«ты»", "Numbered lists", "lowercase", "special typographic", "overrides all other communication rules"]) expect(BLOCK).toContain(item);
	expect(BLOCK.endsWith("then ask one yes/no question about the change.")).toBe(true);
});
