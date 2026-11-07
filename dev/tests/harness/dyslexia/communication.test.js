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

test("adds the exact rule to the message tail", () => {
	expect(BLOCK).toBe(fixture);
	expect(handler()({ text: "привет" }, main)).toEqual({ text: `привет\n\n${BLOCK}` });
});

test("skips subagents, commands and empty text", () => {
	const run = handler();
	expect(run({ text: "привет" }, sub)).toBeUndefined();
	expect(run({ text: "/model" }, main)).toBeUndefined();
	expect(run({ text: "! ls" }, main)).toBeUndefined();
	expect(run({ text: "$ ls" }, main)).toBeUndefined();
	expect(run({ text: "   " }, main)).toBeUndefined();
});

test("does not append twice", () => {
	expect(handler()({ text: `привет\n\n${BLOCK}` }, main)).toBeUndefined();
});
