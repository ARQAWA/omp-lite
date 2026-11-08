import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { native } from "./stubs.js";

native.bounds = () => [1, 10];

const { parseReadArgs } = await import("../../../../src/modules/file-workflow/tools/read/args.js");
const { computeReadSlice, formatReadCodeBlock, isBinary, readTextRange } = await import(
	"../../../../src/modules/file-workflow/tools/read/lines.js"
);
const { growToBlocks, renderRead } = await import("../../../../src/modules/file-workflow/tools/read/render.js");
const read = (await import("../../../../src/modules/file-workflow/tools/read/index.js")).default;

let registered;
read({ registerTool: (tool) => (registered = tool) });
const execute = (params, ctx) => registered.execute("call", params, undefined, undefined, ctx);

let dir;
beforeAll(() => {
	dir = mkdtempSync(join(tmpdir(), "file-workflow-read-"));
	writeFileSync(join(dir, "plain.txt"), "one\ntwo\nthree");
	writeFileSync(join(dir, "block.js"), Array.from({ length: 30 }, (_, i) => `line ${i + 1}`).join("\n"));
});
afterAll(() => rmSync(dir, { recursive: true, force: true }));

test("parseReadArgs needs a path", () => {
	expect(() => parseReadArgs({})).toThrow("path: Required");
	expect(() => parseReadArgs(null)).toThrow("argument: Expected object, received null");
});

test("parseReadArgs keeps an empty path for the caller to reject", () => {
	expect(parseReadArgs({ path: "" })).toEqual({ path: "", offset: undefined, limit: undefined });
});

test("parseReadArgs reads a zero offset as the first line", () => {
	expect(parseReadArgs({ path: "a", offset: 0 })).toEqual({ path: "a", offset: 1, limit: undefined });
});

test("parseReadArgs keeps a negative offset", () => {
	expect(parseReadArgs({ path: "a", offset: -5 }).offset).toBe(-5);
});

test("parseReadArgs rejects a limit below one", () => {
	expect(() => parseReadArgs({ path: "a", limit: 0 })).toThrow("limit: Limit must be >= 1.");
});

test("parseReadArgs reads a numeric string and rejects other text", () => {
	expect(parseReadArgs({ path: "a", offset: "3" }).offset).toBe(3);
	expect(() => parseReadArgs({ path: "a", offset: "x" })).toThrow("offset: Expected number, received string");
	expect(() => parseReadArgs({ path: "a", offset: 1.5 })).toThrow("offset: Expected integer, received float");
});

test("readTextRange returns an empty file as one empty line", () => {
	expect(readTextRange("", undefined, undefined)).toEqual({ content: "", totalLines: 1, rangeApplied: false });
});

test("readTextRange strips CRLF when they are at least 5 percent of lines", () => {
	expect(readTextRange("a\r\nb\r\nc\r\nd\r\ne", undefined, undefined).content).toBe("a\nb\nc\nd\ne");
});

test("readTextRange keeps a lone CRLF under the threshold", () => {
	const text = `a\r\n${"b\n".repeat(25)}`;
	expect(readTextRange(text, undefined, undefined).content.startsWith("a\r\n")).toBe(true);
});

test("readTextRange counts a negative offset from the end", () => {
	expect(readTextRange("1\n2\n3\n4\n5", -2, undefined)).toEqual({ content: "4\n5", totalLines: 5, rangeApplied: true });
});

test("readTextRange returns the whole text for an offset past the end", () => {
	expect(readTextRange("1\n2", 10, undefined)).toEqual({ content: "1\n2", totalLines: 2, rangeApplied: false });
});

test("readTextRange stops at the end for a limit past it", () => {
	expect(readTextRange("1\n2\n3\n4\n5", 4, 10).content).toBe("4\n5");
});

test("computeReadSlice is undefined without offset and limit", () => {
	expect(computeReadSlice(5, undefined, undefined)).toBeUndefined();
});

test("computeReadSlice resolves a negative offset", () => {
	expect(computeReadSlice(5, -2, undefined)).toEqual({ start: 3, end: 5, readRange: { startLine: 4, endLine: 5 } });
});

test("computeReadSlice rejects an offset past the end", () => {
	expect(() => computeReadSlice(5, 10, undefined)).toThrow("Offset 10 is beyond file length (5 lines)");
});

test("computeReadSlice limits the range", () => {
	expect(computeReadSlice(5, 2, 2)).toEqual({ start: 1, end: 3, readRange: { startLine: 2, endLine: 3 } });
});

test("formatReadCodeBlock leaves a whole file alone", () => {
	expect(formatReadCodeBlock("a\nb", { startLine: 1, endLine: 2 }, 2)).toBe("a\nb");
});

test("formatReadCodeBlock marks the hidden head and tail", () => {
	expect(formatReadCodeBlock("b", { startLine: 3, endLine: 3 }, 4)).toBe(
		"... 2 lines not shown ...\nb\n... 1 line not shown ...",
	);
});

test("formatReadCodeBlock says one line not shown", () => {
	expect(formatReadCodeBlock("b", { startLine: 2, endLine: 2 }, 2)).toBe("... 1 line not shown ...\nb");
});

test("growToBlocks leaves the range alone without bounds", () => {
	expect(growToBlocks("a\nb\nc", undefined, 2, 1)).toEqual({ offset: 2, limit: 1 });
	expect(growToBlocks("a\nb\nc", [], 2, 1)).toEqual({ offset: 2, limit: 1 });
});

test("growToBlocks widens to the reported boundaries", () => {
	expect(growToBlocks("a\nb\nc\nd\ne\nf", [1, 5], 3, 1)).toEqual({ offset: 1, limit: 5 });
});

test("growToBlocks stops 150 lines away", () => {
	const content = Array.from({ length: 400 }, () => "x").join("\n");
	expect(growToBlocks(content, [1], 300, 1)).toEqual({ offset: 300, limit: 1 });
});

test("renderRead names an empty file", () => {
	expect(renderRead({ content: "", totalLines: 1, rangeApplied: false }, undefined, undefined)).toBe("File is empty.");
});

test("renderRead returns a short file whole", () => {
	expect(renderRead({ content: "a\nb", totalLines: 2, rangeApplied: false }, undefined, undefined)).toBe("a\nb");
});

test("renderRead cuts a long first read and points at the next offset", () => {
	const content = Array.from({ length: 1002 }, (_, i) => `${i + 1}`).join("\n");
	const text = renderRead({ content, totalLines: 1002, rangeApplied: false }, undefined, undefined);
	expect(text.endsWith("... 2 lines not shown ...\n[Use offset=1001 to continue.]")).toBe(true);
});

test("renderRead refuses more than 100 000 characters", () => {
	expect(() => renderRead({ content: "x".repeat(100_001), totalLines: 1, rangeApplied: false }, undefined, undefined)).toThrow(
		"exceeds maximum allowed characters",
	);
});

test("isBinary looks for a NUL byte in the first 8000 bytes", () => {
	expect(isBinary(Buffer.from("abc"))).toBe(false);
	expect(isBinary(Buffer.from([0x61, 0x00, 0x62]))).toBe(true);
	const late = Buffer.alloc(8001, "a");
	late[8000] = 0;
	expect(isBinary(late)).toBe(false);
});

test("execute reads a file relative to cwd", async () => {
	expect(await execute({ path: "plain.txt" }, { cwd: dir })).toEqual({
		content: [{ type: "text", text: "one\ntwo\nthree" }],
	});
});

test("execute reports a missing file", async () => {
	expect(await execute({ path: "gone.txt" }, { cwd: dir })).toEqual({
		content: [{ type: "text", text: "Error: File not found" }],
		isError: true,
	});
});

test("execute grows a code range to the enclosing blocks", async () => {
	const result = await execute({ path: "block.js", offset: 5, limit: 2 }, { cwd: dir });
	expect(result.content[0].text.split("\n").slice(0, 2)).toEqual(["line 1", "line 2"]);
	expect(result.content[0].text.endsWith("line 10\n... 20 lines not shown ...")).toBe(true);
});

test("execute delegates an internal URL to the native read", async () => {
	const calls = [];
	const ctx = { cwd: dir, invokeTool: async (args) => (calls.push(args), { content: [{ type: "text", text: "ok" }] }) };
	expect(await execute({ path: "local://notes.md" }, ctx)).toEqual({ content: [{ type: "text", text: "ok" }] });
	expect(calls).toEqual([{ path: "local://notes.md" }]);
});

test("execute sends an image path to the native read", async () => {
	const calls = [];
	const ctx = { cwd: dir, invokeTool: async (args) => (calls.push(args), { content: [{ type: "text", text: "img" }] }) };
	await execute({ path: "shot.png" }, ctx);
	expect(calls).toEqual([{ path: join(dir, "shot.png") }]);
});
