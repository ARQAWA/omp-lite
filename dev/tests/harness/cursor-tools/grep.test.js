import { expect, test } from "bun:test";
import { contentEntries, contentLines, executeGrep, install, paginate, parseGrep, plainMessage, routeFor, searchGrep, skipMatches } from "../../../../src/modules/cursor-tools/index.js";

const match = (path, lineNumber, line, extra = {}) => ({ path, lineNumber, line, ...extra });

function fakeEngine(result) {
	const calls = [];
	return {
		calls,
		grep: async (request, options) => {
			calls.push([request, options]);
			return result;
		},
	};
}

const ctx = { cwd: "/work", invokeTool: undefined };
const request = params => parseGrep({ pattern: "TODO", ...params }).request;

test("routes rare paths and masks to the native tool", () => {
	expect(routeFor("src")).toBe("engine");
	expect(routeFor("src/a.ts")).toBe("engine");
	expect(routeFor("omp://tools/grep.md")).toBe("native");
	expect(routeFor("bundle.zip:src/a.ts")).toBe("native");
	expect(routeFor("src/a.ts:10-20")).toBe("native");
	expect(routeFor("src/a.ts:-5")).toBe("native");
	expect(routeFor("src/a.ts:50-")).toBe("native");
	expect(routeFor("src/a.ts:raw")).toBe("native");
	expect(routeFor("src/*.ts")).toBe("native");
	expect(routeFor("src; tests")).toBe("native");
});

test("parses Cursor arguments and rejects bad ones", () => {
	expect(request({ "-C": 2, "-i": true, head_limit: 5 })).toMatchObject({
		contextBefore: 2,
		contextAfter: 2,
		caseSensitive: false,
		headLimit: 5,
		mode: "content",
	});
	expect(parseGrep({ pattern: "  " }).error).toBe("pattern must not be empty");
	expect(parseGrep({ pattern: "x", output_mode: "nope" }).error).toContain("output_mode must be one of");
	expect(parseGrep({ pattern: "x", "-A": -1 }).error).toBe("-A must be a number of at least 0");
	expect(parseGrep({ pattern: "x", head_limit: 0 }).error).toBe("head_limit must be a number of at least 1");
	expect(request({ pattern: "a\nb" }).multiline).toBe(true);
});

test("context flags are ignored outside content mode", () => {
	const parsed = parseGrep({ pattern: "x", output_mode: "count", "-C": 2 });
	expect(parsed.request.contextBefore).toBeUndefined();
	expect(parsed.request.contextAfter).toBeUndefined();
	expect(plainMessage(parsed.request)).not.toContain("-A/-B/-C");
});

const node = () => chain;
const chain = new Proxy(node, { get: (_target, key) => (key === "then" ? undefined : node) });

test("a count search ignores context through the tool entry", async () => {
	const engine = fakeEngine({ matches: [match("a.ts", 1, "one"), match("a.ts", 4, "two")] });
	const tools = [];
	install({ zod: chain, registerTool: tool => tools.push(tool), on: () => {} }, { engine });
	const grep = tools.find(tool => tool.name === "grep");
	const result = await grep.execute("call", { pattern: "x", output_mode: "count", "-C": -1 }, undefined, undefined, ctx);
	expect(result.isError).toBeUndefined();
	expect(result.content[0].text).toBe("a.ts:2");
});

test("renders a match with its own context lines", () => {
	const entries = contentEntries([
		match("a.ts", 5, "hit", { contextBefore: [{ lineNumber: 4, line: "before" }], contextAfter: [{ lineNumber: 6, line: "after" }] }),
	]);
	expect(contentLines(entries[0])).toEqual(["a.ts:4-before", "a.ts:5:hit", "a.ts:6-after"]);
});

test("context before a later match stays with that match", () => {
	const entries = contentEntries([
		match("a.ts", 2, "first"),
		match("a.ts", 9, "second", { contextBefore: [{ lineNumber: 8, line: "near" }] }),
	]);
	expect(contentLines(entries[0])).toEqual(["a.ts:2:first"]);
	expect(contentLines(entries[1])).toEqual(["a.ts:8-near", "a.ts:9:second"]);
});

test("pages by whole entries and names the next offset", () => {
	const entries = [
		{ file: "x", lines: [{ lineNumber: 1, line: "a", isContext: false }] },
		{ file: "x", lines: [{ lineNumber: 2, line: "b", isContext: false }] },
	];
	const page = paginate(entries, contentLines, { offset: 0, limit: 1 });
	expect(page.text).toBe("x:1:a");
	expect(page.next).toBe(1);
});

test("an oversized entry is emitted alone, keeping both ends", () => {
	const entries = [{ file: "x", lines: [{ lineNumber: 1, line: `${"a".repeat(20000)}end`, isContext: false }] }];
	const page = paginate(entries, contentLines, {});
	expect(page.text.length).toBeLessThan(15100);
	expect(page.text).toContain("…");
	expect(page.text.endsWith("end")).toBe(true);
});

test("searches from the session directory and shows paths from it", async () => {
	const engine = fakeEngine({ matches: [match("a.ts", 1, "one")] });
	const result = await searchGrep(request({ path: "src" }), ctx, { engine });
	expect(engine.calls[0][0].path).toBe("/work/src");
	expect(result.content[0].text).toContain("src/a.ts:1:one");
});

test("offset drops rows in content mode", async () => {
	const engine = fakeEngine({ matches: [match("a.ts", 1, "a1"), match("a.ts", 5, "a5"), match("b.ts", 1, "b")] });
	const offset = await searchGrep(request({ offset: 1, head_limit: 1 }), ctx, { engine });
	expect(offset.content[0].text).toContain("a.ts:5:a5");
	expect(offset.content[0].text).toContain("of 3 matches shown. Use offset=2");
});

test("a single explicit file still honours an explicit offset", async () => {
	const file = new URL("../../../../src/modules/cursor-tools/README.md", import.meta.url).pathname;
	const engine = fakeEngine({ matches: [match(file, 1, "title"), match(file, 3, "body")] });
	const searchCtx = { cwd: process.cwd(), invokeTool: undefined };
	const first = await searchGrep(request({ path: file, output_mode: "count" }), searchCtx, { engine });
	expect(first.content[0].text).toContain("README.md:2");
	const second = await searchGrep(request({ path: file, output_mode: "count", offset: 1 }), searchCtx, { engine });
	expect(second.content[0].text).toBe("No matches found");
});

test("a file-mode page names the parameter that advances", async () => {
	const engine = fakeEngine({ matches: [match("a.ts", 1, "x"), match("b.ts", 1, "x"), match("c.ts", 1, "x")] });
	const byOffset = await searchGrep(request({ output_mode: "count", offset: 1, head_limit: 1 }), ctx, { engine });
	expect(byOffset.content[0].text).toContain("Use offset=2");
});

test("automatic multiline does not block the native branch", async () => {
	const seen = [];
	const nativeCtx = { cwd: "/work", invokeTool: async (params, options) => (seen.push(params), { content: [{ type: "text", text: "native" }] }) };
	const result = await executeGrep("call", { pattern: "a\\nb", path: "src/a.ts:1-2" }, undefined, undefined, nativeCtx);
	expect(result.isError).toBeUndefined();
	expect(seen).toHaveLength(1);
	expect(seen[0]).toEqual({ pattern: "a\\nb", path: "src/a.ts:1-2", case: true, gitignore: true });
	const explicit = await executeGrep("call", { pattern: "a\\nb", path: "src/a.ts:1-2", multiline: true }, undefined, undefined, nativeCtx);
	expect(explicit.isError).toBe(true);
	expect(explicit.content[0].text).toContain("multiline");
});

test("content search asks the engine for context and reports a next page", async () => {
	const engine = fakeEngine({ matches: [match("a.ts", 1, "one"), match("a.ts", 2, "two")] });
	const result = await searchGrep(request({ "-C": 1, head_limit: 1 }), ctx, { engine });
	expect(engine.calls[0][0]).toMatchObject({ ignoreCase: false, mode: "content", contextBefore: 1, contextAfter: 1 });
	expect(result.content[0].text).toContain("Use offset=1");
});

test("a collection cap is reported instead of looking complete", async () => {
	const engine = fakeEngine({ matches: [match("a.ts", 1, "one")], limitReached: true, skippedOversized: 2 });
	const result = await searchGrep(request({}), ctx, { engine });
	expect(result.content[0].text).toContain("stopped at 100000 matches");
	expect(result.content[0].text).toContain("2 files skipped as too large");
});

test("file modes deduplicate, count and honour offset", async () => {
	const engine = fakeEngine({ matches: [match("a.ts", 1, "x", { matchCount: 3 }), match("b.ts", 1, "x", { matchCount: 2 })] });
	const files = await searchGrep(request({ output_mode: "files_with_matches" }), ctx, { engine });
	expect(files.content[0].text).toBe("a.ts\nb.ts");
	expect(engine.calls.at(-1)[0].mode).toBe("filesWithMatches");
	const counts = await searchGrep(request({ output_mode: "count" }), ctx, { engine });
	expect(counts.content[0].text).toBe("a.ts:3\nb.ts:2");
	const paged = await searchGrep(request({ output_mode: "count", offset: 1 }), ctx, { engine });
	expect(paged.content[0].text).toContain("b.ts:2");
});

test("the native branch forwards only the fields the native tool takes", async () => {
	const seen = [];
	const nativeCtx = { cwd: "/work", invokeTool: async (params, options) => (seen.push(params), { content: [{ type: "text", text: "native" }] }) };
	const result = await executeGrep("call", { pattern: "x", path: "omp://a.md", "-i": true }, undefined, undefined, nativeCtx);
	expect(seen[0]).toEqual({ pattern: "x", path: "omp://a.md", case: false, gitignore: true });
	expect(result.content[0].text).toBe("native");
});

test("the native branch refuses arguments it cannot honour", async () => {
	const nativeCtx = { cwd: "/work", invokeTool: async () => ({ content: [{ type: "text", text: "native" }] }) };
	const result = await executeGrep("call", { pattern: "x", path: "a.zip:b", output_mode: "count" }, undefined, undefined, nativeCtx);
	expect(result.isError).toBe(true);
	expect(result.content[0].text).toContain("output_mode");
});

test("the engine is called with one options object, never a callback", async () => {
	let arity;
	const engine = { grep: (...args) => ((arity = args.length), Promise.resolve({ matches: [] })) };
	await searchGrep(request({}), ctx, { engine });
	expect(arity).toBe(1);
});

test("the engine branch reports failures and forwards cancellation", async () => {
	const engine = { grep: async () => { throw new Error("regex parse error"); } };
	const result = await executeGrep("call", { pattern: "x", path: "src" }, undefined, undefined, ctx, { engine });
	expect(result.isError).toBe(true);
	expect(result.content[0].text).toBe("regex parse error");
	const controller = new AbortController();
	const seen = fakeEngine({ matches: [] });
	await executeGrep("call", { pattern: "x" }, controller.signal, undefined, ctx, { engine: seen });
	expect(seen.calls[0][0].signal).toBe(controller.signal);
});

test("the native route pages through offset as skip", async () => {
	const seen = [];
	const ctx = { cwd: "/work", invokeTool: async params => (seen.push(params), { content: [{ type: "text", text: "Use skip=2 for the next page" }] }) };
	const result = await executeGrep("call", { pattern: "x", path: "src; other", offset: 1 }, undefined, undefined, ctx);
	expect(seen[0].skip).toBe(1);
	expect(result.content[0].text).toContain("Use offset=2");
});

test("a single-file native search drops leading match lines for offset", async () => {
	const ctx = { cwd: "/work", invokeTool: async () => ({ content: [{ type: "text", text: "*1|a\n*2|b\n*3|c" }] }) };
	const result = await executeGrep("call", { pattern: "x", path: "src/a.ts:1-3", offset: 1 }, undefined, undefined, ctx);
	expect(result.content[0].text).toBe("*2|b\n*3|c");
});

test("only a footer line is renamed, matched text is untouched", async () => {
	const ctx = { cwd: "/work", invokeTool: async () => ({ content: [{ type: "text", text: "see Use skip=2 in docs\n[Use skip=2 for the next page.]" }] }) };
	const result = await executeGrep("call", { pattern: "x", path: "src; other", offset: 1 }, undefined, undefined, ctx);
	expect(result.content[0].text).toContain("see Use skip=2 in docs");
	expect(result.content[0].text).toContain("[Use offset=2 for the next page.]");
});

test("skipMatches reports an empty page when the offset passes the last match", () => {
	expect(skipMatches("*1|a", 2)).toBe("No matches found");
});

test("a double-dot selector takes the native route and honours offset", async () => {
	const seen = [];
	const ctx = { cwd: "/work", invokeTool: async params => (seen.push(params), { content: [{ type: "text", text: "*10|a\n*20|b" }] }) };
	const result = await executeGrep("call", { pattern: "x", path: "a.ts:10..20", offset: 1 }, undefined, undefined, ctx);
	expect(seen).toHaveLength(1);
	expect(result.content[0].text).toBe("*20|b");
});

test("an archive member counts as one file for offset", async () => {
	const ctx = { cwd: "/work", invokeTool: async () => ({ content: [{ type: "text", text: "*1|a\n*2|b" }] }) };
	const result = await executeGrep("call", { pattern: "x", path: "bundle.zip:src/a.ts", offset: 1 }, undefined, undefined, ctx);
	expect(result.content[0].text).toBe("*2|b");
});

test("a native error keeps its diagnosis under offset", async () => {
	const ctx = { cwd: "/work", invokeTool: async () => ({ isError: true, content: [{ type: "text", text: "Path not found: a.ts:1-2" }] }) };
	const result = await executeGrep("call", { pattern: "x", path: "a.ts:1-2", offset: 1 }, undefined, undefined, ctx);
	expect(result.content[0].text).toBe("Path not found: a.ts:1-2");
});
