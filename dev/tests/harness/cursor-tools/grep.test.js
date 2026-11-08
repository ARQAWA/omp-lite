import { expect, test } from "bun:test";
import { executeGrep, parseGrep, routeFor, searchGrep } from "../../../../src/modules/cursor-tools/grep.js";
import { contentEntries, contentLines, paginate } from "../../../../src/modules/cursor-tools/render.js";

const match = (path, lineNumber, line, extra = {}) => ({ path, lineNumber, line, ...extra });

function fakeEngine(result) {
	const calls = [];
	return {
		calls,
		grep: async request => {
			calls.push(request);
			return result;
		},
	};
}

const ctx = { cwd: "/work", invokeTool: undefined };

test("routes rare paths to the native tool", () => {
	expect(routeFor("src")).toBe("engine");
	expect(routeFor("src/a.ts")).toBe("engine");
	expect(routeFor("omp://tools/grep.md")).toBe("native");
	expect(routeFor("local://notes/a.md")).toBe("native");
	expect(routeFor("bundle.zip:src/a.ts")).toBe("native");
	expect(routeFor("src/a.ts:10-20")).toBe("native");
	expect(routeFor("src/a.ts:raw")).toBe("native");
	expect(routeFor("src; tests")).toBe("native");
});

test("parses Cursor arguments and rejects bad ones", () => {
	const { request } = parseGrep({ pattern: "x", "-C": 2, "-i": true, head_limit: 5 });
	expect(request).toMatchObject({ contextBefore: 2, contextAfter: 2, caseSensitive: false, headLimit: 5, mode: "content" });
	expect(parseGrep({ pattern: "  " }).error).toBe("pattern must not be empty");
	expect(parseGrep({ pattern: "x", output_mode: "nope" }).error).toContain("output_mode must be one of");
	expect(parseGrep({ pattern: "x", "-A": -1 }).error).toBe("-A must be a non-negative number");
});

test("renders matches with their context lines and keeps one entry per match", () => {
	const entries = contentEntries([
		match("a.ts", 5, "hit", { contextBefore: [{ lineNumber: 4, line: "before" }], contextAfter: [{ lineNumber: 6, line: "after" }] }),
	]);
	expect(entries).toHaveLength(1);
	expect(contentLines(entries[0])).toEqual(["a.ts:4-before", "a.ts:5:hit", "a.ts:6-after"]);
});

test("context before the first match belongs to that match", () => {
	const entries = contentEntries([match("a.ts", 2, "hit", { contextBefore: [{ lineNumber: 1, line: "top" }] })]);
	expect(contentLines(entries[0])).toEqual(["a.ts:1-top", "a.ts:2:hit"]);
});

test("pages by whole entries and names the next offset", () => {
	const entries = [{ lines: [{ lineNumber: 1, line: "a", isContext: false }], file: "x" }, { lines: [{ lineNumber: 2, line: "b", isContext: false }], file: "x" }];
	const page = paginate(entries, contentLines, { offset: 0, limit: 1 });
	expect(page.text).toBe("x:1:a");
	expect(page.next).toBe(1);
});

test("an entry larger than the page is emitted alone and cut", () => {
	const entries = [{ lines: [{ lineNumber: 1, line: "y".repeat(20000), isContext: false }], file: "x" }];
	const page = paginate(entries, contentLines, {});
	expect(page.text.length).toBeLessThan(15100);
	expect(page.text).toContain("…");
	expect(page.next).toBeUndefined();
});

test("content search asks the engine for context and reports a next page", async () => {
	const engine = fakeEngine({
		matches: [match("a.ts", 1, "one"), match("a.ts", 2, "two")],
	});
	const request = parseGrep({ pattern: "x", "-C": 1, head_limit: 1 }).request;
	const result = await searchGrep(request, ctx, { engine });
	expect(engine.calls[0]).toMatchObject({ ignoreCase: false, mode: "content", contextBefore: 1, contextAfter: 1 });
	expect(result.content[0].text).toContain("a.ts:1:one");
	expect(result.content[0].text).toContain("Use offset=1");
});

test("files mode deduplicates and counts mode sums", async () => {
	const engine = fakeEngine({ matches: [match("a.ts", 1, "x", { matchCount: 3 }), match("b.ts", 1, "x", { matchCount: 2 })] });
	const files = await searchGrep(parseGrep({ pattern: "x", output_mode: "files_with_matches" }).request, ctx, { engine });
	expect(files.content[0].text).toBe("a.ts\nb.ts");
	expect(engine.calls.at(-1).mode).toBe("filesWithMatches");
	const counts = await searchGrep(parseGrep({ pattern: "x", output_mode: "count" }).request, ctx, { engine });
	expect(counts.content[0].text).toBe("a.ts:3\nb.ts:2");
	expect(engine.calls.at(-1).mode).toBe("count");
});

test("native branch forwards only the fields the native tool takes", async () => {
	const seen = [];
	const nativeCtx = { cwd: "/work", invokeTool: async (params, options) => (seen.push(params), { content: [{ type: "text", text: "native" }] }) };
	const result = await executeGrep("call", { pattern: "x", path: "omp://a.md", "-i": true }, undefined, undefined, nativeCtx);
	expect(seen[0]).toEqual({ pattern: "x", path: "omp://a.md", case: false, gitignore: true, skip: undefined });
	expect(result.content[0].text).toBe("native");
});

test("native branch refuses arguments it cannot honour", async () => {
	const nativeCtx = { cwd: "/work", invokeTool: async () => ({ content: [{ type: "text", text: "native" }] }) };
	const result = await executeGrep("call", { pattern: "x", path: "a.zip:b", output_mode: "count" }, undefined, undefined, nativeCtx);
	expect(result.isError).toBe(true);
	expect(result.content[0].text).toContain("output_mode");
});

test("engine branch reports engine failures as tool errors", async () => {
	const engine = { grep: async () => { throw new Error("regex parse error"); } };
	const result = await executeGrep("call", { pattern: "x", path: "src" }, undefined, undefined, ctx, { engine });
	expect(result.isError).toBe(true);
	expect(result.content[0].text).toBe("regex parse error");
});
