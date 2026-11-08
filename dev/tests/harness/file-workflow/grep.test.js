import { afterAll, beforeEach, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { native } from "./stubs.js";

const { parseGrepArgs, toInt32 } = await import("../../../../src/modules/file-workflow/tools/grep/args.js");
const { buildSearchRequest } = await import("../../../../src/modules/file-workflow/tools/grep/request.js");
const { applyPagination, formatSearchResult, SearchResultCache } = await import(
	"../../../../src/modules/file-workflow/tools/grep/format.js"
);
const grep = (await import("../../../../src/modules/file-workflow/tools/grep/index.js")).default;

let registered;
grep({ registerTool: (tool) => (registered = tool) });
const dir = mkdtempSync(join(tmpdir(), "file-workflow-grep-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));
const execute = (params) => registered.execute("call", params, undefined, undefined, { cwd: dir });

let calls;
beforeEach(() => {
	calls = [];
	native.grep = async (args) => (calls.push(args), { matches: [], totalMatches: 0 });
});

test("parseGrepArgs refuses an empty pattern", () => {
	const parsed = parseGrepArgs({ pattern: "" });
	expect(parsed.error).toBe('Invalid arguments:\npattern: pattern is empty. Pass "." to match every line.');
});

test("parseGrepArgs needs a pattern at all", () => {
	expect(parseGrepArgs({})).toEqual({ error: "Invalid arguments:\npattern: Required" });
});

test("parseGrepArgs refuses a negative context flag", () => {
	expect(parseGrepArgs({ pattern: "x", "-A": -1 }).error).toBe("Invalid arguments:\n-A: Must be 0 or more context lines.");
});

test("parseGrepArgs refuses a negative head_limit", () => {
	expect(parseGrepArgs({ pattern: "x", head_limit: -1 }).error).toContain("head_limit: Number must be greater than or equal to 0");
});

test("parseGrepArgs refuses a foreign output_mode", () => {
	expect(parseGrepArgs({ pattern: "x", output_mode: "paths" }).error).toContain(
		"output_mode: Invalid enum value. Expected 'content' | 'files_with_matches' | 'count', received 'paths'",
	);
});

test("parseGrepArgs reads numeric strings and boolean spellings", () => {
	const parsed = parseGrepArgs({ pattern: "x", "-C": "2", "-i": "yes", offset: "3" });
	expect([parsed.args["-C"], parsed.args["-i"], parsed.args.offset, parsed.args.multiline]).toEqual([2, true, 3, false]);
});

test("parseGrepArgs defaults to content mode", () => {
	expect(parseGrepArgs({ pattern: "x" }).args.output_mode).toBeUndefined();
});

test("toInt32 rounds and clamps into the int32 range", () => {
	expect([toInt32(1.2, Math.floor), toInt32(-5, Math.ceil), toInt32(2 ** 31, Math.ceil), toInt32(NaN, Math.ceil)]).toEqual([1, 0, 2_147_483_647, 0]);
	expect(toInt32(undefined, Math.ceil)).toBeUndefined();
});

test("buildSearchRequest maps the flags onto the native request", () => {
	const request = buildSearchRequest({ pattern: "x", "-B": 2, "-A": 3, "-C": undefined, "-i": true, multiline: true });
	expect(request).toEqual({
		pattern: "x",
		path: undefined,
		glob: undefined,
		type: undefined,
		outputMode: "content",
		caseInsensitive: true,
		multiline: true,
		contextBefore: 2,
		contextAfter: 3,
		context: undefined,
	});
});

test("buildSearchRequest keeps the chosen output mode", () => {
	expect(buildSearchRequest({ pattern: "x", output_mode: "count", "-i": false, multiline: false }).outputMode).toBe("count");
});

test("applyPagination returns the same union for the first full page", () => {
	const union = { mode: "files_with_matches", value: { files: ["a"], totalFiles: 1, clientTruncated: false, ripgrepTruncated: false } };
	expect(applyPagination(union, 0, undefined)).toBe(union);
});

test("applyPagination cuts files and records the page", () => {
	const union = { mode: "files_with_matches", value: { files: ["a", "b"], totalFiles: 2, clientTruncated: false, ripgrepTruncated: false } };
	const page = applyPagination(union, 1, 1);
	expect(page.value.files).toEqual(["b"]);
	expect([page.value.offsetApplied, page.value.headLimitApplied]).toEqual([1, 1]);
});

test("applyPagination past the end empties the page and marks truncation", () => {
	const union = { mode: "count", value: { counts: [{ file: "a", count: 1 }], totalFiles: 1, totalMatches: 1, clientTruncated: false, ripgrepTruncated: false } };
	const page = applyPagination(union, 5, 1);
	expect([page.value.counts, page.value.clientTruncated]).toEqual([[], false]);
});

test("applyPagination keeps the context lines that belong to a kept match", () => {
	const union = {
		mode: "content",
		value: {
			matches: [
				{
					file: "a.js",
					matches: [
						{ lineNumber: 1, content: "before", isContextLine: true },
						{ lineNumber: 2, content: "hit", isContextLine: false },
						{ lineNumber: 3, content: "after", isContextLine: true },
					],
				},
			],
			totalLines: 3,
			totalMatchedLines: 1,
			clientTruncated: false,
			ripgrepTruncated: false,
		},
	};
	const page = applyPagination(union, 0, 1);
	expect(page.value.matches[0].matches.map((line) => line.lineNumber)).toEqual([1, 2, 3]);
});

test("formatSearchResult wraps the block in workspace_result", () => {
	const success = {
		pattern: "hit",
		path: undefined,
		root: "/work",
		union: {
			mode: "content",
			value: {
				matches: [{ file: "a.js", matches: [{ lineNumber: 1, content: "hit", isContextLine: false }] }],
				totalLines: 1,
				totalMatchedLines: 1,
				clientTruncated: false,
				ripgrepTruncated: false,
			},
		},
	};
	expect(formatSearchResult(success)).toBe('<workspace_result workspace_path="/work">\na.js\n  1:hit\n</workspace_result>');
});

test("SearchResultCache misses, hits and evicts the oldest", () => {
	const cache = new SearchResultCache(2);
	const key = (pattern) => ({ pattern, caseInsensitive: false, multiline: false });
	expect(cache.get(key("a"))).toBeUndefined();
	cache.set(key("a"), { hit: "a" });
	expect(cache.get(key("a"))).toEqual({ hit: "a" });
	cache.set(key("b"), { hit: "b" });
	cache.set(key("c"), { hit: "c" });
	expect(cache.get(key("a"))).toBeUndefined();
	expect(cache.get(key("c"))).toEqual({ hit: "c" });
});

test("SearchResultCache keeps five results by default", () => {
	const cache = new SearchResultCache();
	for (const pattern of ["a", "b", "c", "d", "e"]) cache.set({ pattern, caseInsensitive: false, multiline: false }, { pattern });
	expect(cache.entries.length).toBe(5);
	expect(cache.get({ pattern: "a", caseInsensitive: false, multiline: false })).toEqual({ pattern: "a" });
});

test("execute searches and formats a content result", async () => {
	native.grep = async (args) => (calls.push(args), { matches: [{ path: "a.js", lineNumber: 4, line: "one hit" }], totalMatches: 1 });
	const result = await execute({ pattern: "one hit" });
	expect(result.content[0].text).toBe(`<workspace_result workspace_path="${dir}">\na.js\n  4:one hit\n</workspace_result>`);
	expect([calls[0].pattern, calls[0].mode, calls[0].path]).toEqual(["one hit", "content", dir]);
});

test("execute sends -i and the file mode to the engine", async () => {
	native.grep = async (args) => (calls.push(args), { matches: [{ path: "a.js" }], totalMatches: 1 });
	await execute({ pattern: "second hit", "-i": true, output_mode: "files_with_matches" });
	expect([calls[0].ignoreCase, calls[0].mode]).toEqual([true, "files_with_matches"]);
});

test("execute reports a regex error in plain words", async () => {
	native.grep = async () => {
		throw new Error("regex parse error:\n    x(\n     ^\nerror: unclosed group");
	};
	const result = await execute({ pattern: "third hit (" });
	expect(result.isError).toBe(true);
	expect(result.content[0].text).toContain('Error running tool: rg: regex parse error: invalid regex "third hit (": unclosed group.');
	expect(result.content[0].text).toContain("Escape special characters");
});

test("execute parses the arguments before searching", async () => {
	const result = await execute({ pattern: "" });
	expect(result.isError).toBe(true);
	expect(result.content[0].text).toContain('pattern: pattern is empty. Pass "." to match every line.');
	expect(calls).toEqual([]);
});

test("execute pages a cached result without a new search", async () => {
	native.grep = async (args) => (
		calls.push(args),
		{ matches: [{ path: "a.js", lineNumber: 1, line: "fourth" }, { path: "b.js", lineNumber: 2, line: "fourth" }], totalMatches: 2 }
	);
	const first = await execute({ pattern: "fourth", head_limit: 1 });
	const second = await execute({ pattern: "fourth", head_limit: 1, offset: 1 });
	expect(calls.length).toBe(1);
	expect(first.content[0].text).toContain("a.js");
	expect(second.content[0].text).toContain("b.js");
	expect(second.content[0].text).not.toContain("a.js");
});
