import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import dyslexia, { BLOCK } from "../../../../src/modules/dyslexia/index.js";

const fixture = readFileSync(new URL("./fixture.md", import.meta.url), "utf8").trimEnd();

function handler() {
	let registered;
	dyslexia({ on: (_name, fn) => (registered = fn) });
	return registered;
}

const main = { agent: { kind: "main" } };
const sub = { agent: { kind: "sub" } };
const user = text => ({ role: "user", content: text });

test("adds the exact rule to every user message", () => {
	expect(BLOCK).toBe(fixture);
	const result = handler()({ messages: [user("привет")] }, main);
	expect(result).toEqual({ messages: [user(`привет\n\n${BLOCK}`)] });
});

test("keeps image messages and appends a text block", () => {
	const messages = [user([{ type: "image", data: "x", mimeType: "image/png" }])];
	const result = handler()({ messages }, main);
	expect(result.messages[0].content).toEqual([messages[0].content[0], { type: "text", text: BLOCK }]);
});

test("skips subagents and non-user messages", () => {
	expect(handler()({ messages: [user("привет")] }, sub)).toBeUndefined();
	expect(handler()({ messages: [{ role: "assistant", content: "ответ" }] }, main)).toBeUndefined();
});

test("does not append twice", () => {
	const once = handler()({ messages: [user("привет")] }, main);
	expect(handler()(once, main)).toBeUndefined();
});
