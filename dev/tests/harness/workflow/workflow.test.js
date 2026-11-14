import { expect, test } from "bun:test";
import dyslexia, { BLOCK as DYSLEXIA } from "../../../../src/modules/dyslexia/index.js";
import workflow, { BLOCK } from "../../../../src/modules/workflow/index.js";

const TEXT = `## Workflow

Do all that was ordered and nothing beyond it. Follow exact instructions exactly. Take the shortest, simplest path: no extras, no overengineering, no guesses. An unordered part seems critical: ask the owner first.`;

function handler(extension = workflow) {
	let registered;
	extension({ on: (_name, fn) => (registered = fn) });
	return registered;
}

const main = { agent: { kind: "main" } };
const sub = { agent: { kind: "sub" } };
const user = text => ({ role: "user", content: text });
const count = (text, part) => text.split(part).length - 1;

test("appends the exact hint for the main session", () => {
	expect(BLOCK).toBe(TEXT);
	const result = handler()({ messages: [user("привет")] }, main);
	expect(result).toEqual({ messages: [user(`привет\n\n${BLOCK}`)] });
});

test("keeps image messages and appends a text block", () => {
	const part = { type: "text", text: "привет" };
	const image = { type: "image", data: "x", mimeType: "image/png" };
	const messages = [user([part]), user([part, image]), user([image])];
	const result = handler()({ messages }, main);
	expect(result.messages[0].content).toEqual([{ ...part, text: `привет\n\n${BLOCK}` }]);
	expect(result.messages[1].content).toEqual([part, image, { type: "text", text: BLOCK }]);
	expect(result.messages[2].content).toEqual([image, { type: "text", text: BLOCK }]);
});

test("skips subagents and non-user messages", () => {
	expect(handler()({ messages: [user("привет")] }, sub)).toBeUndefined();
	expect(handler()({ messages: [{ role: "assistant", content: "ответ" }] }, main)).toBeUndefined();
});

test("does not append twice", () => {
	const once = handler()({ messages: [user("привет")] }, main);
	expect(handler()(once, main)).toBeUndefined();
});

test("works together with dyslexia in both orders", () => {
	for (const order of [[workflow, dyslexia], [dyslexia, workflow]]) {
		let event = { messages: [user("привет")] };
		for (const extension of order) event = handler(extension)(event, main) ?? event;
		const text = event.messages[0].content;
		expect(count(text, BLOCK)).toBe(1);
		expect(count(text, DYSLEXIA)).toBe(1);
	}
});
