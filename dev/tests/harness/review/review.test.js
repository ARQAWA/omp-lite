import { expect, test } from "bun:test";
import { appendFileSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { check, freeze, replies, slice } from "../../../../src/modules/review/index.js";

const message = (role, content) => JSON.stringify({ type: "message", timestamp: `t-${role}`, message: { role, content } });
const session = [
	JSON.stringify({ type: "session", id: "s1" }),
	message("user", "старая задача"),
	message("user", [{ type: "text", text: "сохрани защиту от повторного выставления" }]),
	message("assistant", [
		{ type: "thinking", thinking: "hidden" },
		{ type: "toolCall", name: "bash", arguments: { command: "git diff" } },
		{ type: "text", text: "готово" },
	]),
	message("assistant", [{ type: "toolCall", name: "read", arguments: {} }]),
	message("toolResult", [{ type: "text", text: "tool output" }]),
	JSON.stringify({ type: "custom", data: "x" }),
	"{broken",
].join("\n");

function review(facts) {
	const dir = mkdtempSync(join(tmpdir(), "review-"));
	const file = join(dir, "s.jsonl");
	writeFileSync(file, session);
	slice(dir, [[file, 2]]);
	writeFileSync(join(dir, "facts.md"), facts);
	freeze(dir);
	return dir;
}

test("replies keep only owner and agent text", () => {
	const dir = mkdtempSync(join(tmpdir(), "review-"));
	writeFileSync(join(dir, "s.jsonl"), session);
	expect(replies(join(dir, "s.jsonl"))).toEqual([
		{ role: "user", time: "t-user", text: "старая задача" },
		{ role: "user", time: "t-user", text: "сохрани защиту от повторного выставления" },
		{ role: "assistant", time: "t-assistant", text: "готово" },
	]);
});

test("replies follow the active branch and skip abandoned ones", () => {
	const entry = (id, parentId, role, content) => JSON.stringify({ type: "message", id, parentId, timestamp: `t-${id}`, message: { role, content } });
	const dir = mkdtempSync(join(tmpdir(), "review-"));
	const lines = [
		JSON.stringify({ type: "session", id: "s1" }),
		entry("a", null, "user", "задача"),
		entry("b", "a", "assistant", "ответ"),
		entry("c", "b", "user", "черновик"),
		entry("d", "c", "assistant", "брошенный ответ"),
		entry("e", "b", "user", "уточнение"),
		entry("f", "e", "assistant", "готово"),
		JSON.stringify({ type: "custom", id: "g", parentId: "f" }),
		"",
	];
	writeFileSync(join(dir, "s.jsonl"), lines.join("\n"));
	expect(replies(join(dir, "s.jsonl")).map(reply => reply.text)).toEqual(["задача", "ответ", "уточнение", "готово"]);
});

test("slice starts at the given reply", () => {
	const text = readFileSync(join(review("# Facts\n"), "slice.md"), "utf8");
	expect(text).toContain("## 2 user t-user\n\nсохрани защиту");
	expect(text).not.toContain("старая задача");
	expect(text).not.toContain("tool output");
});

test("slice ends at the given reply", () => {
	const dir = mkdtempSync(join(tmpdir(), "review-"));
	writeFileSync(join(dir, "s.jsonl"), session);
	slice(dir, [[join(dir, "s.jsonl"), 1, 2]]);
	const text = readFileSync(join(dir, "slice.md"), "utf8");
	expect(text).toContain("## 1 user t-user\n\nстарая задача");
	expect(text).toContain("## 2 user t-user\n\nсохрани защиту");
	expect(text).not.toContain("готово");
});

test("a frozen fact file with real quotes passes", () => {
	expect(check(review("R1. guard\n> сохрани защиту\n> от повторного   выставления\n"))).toEqual([]);
});

test("a changed fact file fails the hash", () => {
	const dir = review("R1. guard\n");
	appendFileSync(join(dir, "facts.md"), "R2. extra\n");
	expect(check(dir)).toEqual(["facts changed after freeze"]);
});

test("a quote absent from the slice is caught", () => {
	expect(check(review("> старая задача\n> добавь журнал\n"))).toEqual([
		"quote not in slice: старая задача",
		"quote not in slice: добавь журнал",
	]);
});
