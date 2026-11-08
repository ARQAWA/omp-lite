import { expect, test } from "bun:test";
import subagentReuse, { MARKER, reused } from "../../../../src/modules/subagent-reuse/index.js";

function handler() {
	let registered;
	subagentReuse({ on: (_name, fn) => (registered = fn) });
	return registered;
}

const sub = { agent: { kind: "sub" } };
const main = { agent: { kind: "main" } };
const user = text => ({ role: "user", content: text });
const irc = (message, fromParent = true) => ({
	role: "custom",
	customType: "irc:incoming",
	details: { fromParent, message },
});
const prior = [user("first task"), { role: "assistant", content: "first answer" }];

test("keeps only the new task and everything after it", () => {
	const messages = [...prior, irc("[task Probe#2] second task"), { role: "assistant", content: "partial" }];
	expect(reused(messages)).toEqual([messages[2], messages[3]]);
	expect(reused(messages)).not.toBe(messages);
});

test("leading whitespace is not a marker", () => {
	expect(reused([...prior, irc(" \n[task Probe#2] second task")])).toBeUndefined();
});

test("the last marker wins", () => {
	const messages = [...prior, irc("[task Probe#2] second"), irc("[task Probe#3] third")];
	expect(reused(messages)).toEqual([messages[3]]);
});

test("ignores parent messages without a marker", () => {
	expect(reused([...prior, irc("what did you find?")])).toBeUndefined();
});

test("ignores peer messages and malformed markers", () => {
	expect(reused([...prior, irc("[task Probe#2] second", false)])).toBeUndefined();
	expect(reused([...prior, irc("[task #2] second")])).toBeUndefined();
	expect(reused([...prior, irc("[task Probe#x] second")])).toBeUndefined();
});

test("the marker pattern is anchored", () => {
	expect(MARKER.test("[task Probe#2] second")).toBe(true);
	expect(MARKER.test("see [task Probe#2] second")).toBe(false);
});

test("subagents are sliced and the main session is untouched", () => {
	const messages = [...prior, irc("[task Probe#2] second task")];
	expect(handler()({ messages }, sub)).toEqual({ messages: [messages[2]] });
	expect(handler()({ messages }, main)).toBeUndefined();
});

test("an ordinary subagent request is untouched", () => {
	expect(handler()({ messages: prior }, sub)).toBeUndefined();
});
