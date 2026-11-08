import { afterAll, beforeEach, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { native } from "./stubs.js";

const { classifyRipgrepMessage, searchWorkspace } = await import(
	"../../../../src/modules/file-workflow/shared/search/engine.js"
);
const { formatBlock, formatSearchError, GREP_CHAR_BUDGET } = await import(
	"../../../../src/modules/file-workflow/shared/search/format.js"
);

const dir = mkdtempSync(join(tmpdir(), "file-workflow-search-"));
const outside = mkdtempSync(join(tmpdir(), "file-workflow-outside-"));
writeFileSync(join(dir, "a.txt"), "one\ntwo\n");
writeFileSync(join(dir, "b.txt"), "three\nfour\n");
writeFileSync(join(outside, "x.txt"), "far\n");

afterAll(() => {
	rmSync(dir, { recursive: true, force: true });
	rmSync(outside, { recursive: true, force: true });
});

let calls;
beforeEach(() => {
	calls = [];
	native.grep = async (args) => {
		calls.push(args);
		return { matches: [], totalMatches: 0 };
	};
	native.glob = async (args) => {
		calls.push(args);
		return { matches: [] };
	};
});

const request = (extra) => ({ pattern: "hit", outputMode: "content", caseInsensitive: false, multiline: false, ...extra });

test("classifyRipgrepMessage explains an unbalanced bracket", () => {
	const message = 'regex parse error:\n    a(\n     ^\nerror: unclosed group\n';
	const text = classifyRipgrepMessage(message, "a(");
	expect(text).toContain('invalid regex "a("');
	expect(text).toContain("Escape special characters");
});

test("classifyRipgrepMessage names a regex error without the escape hint", () => {
	expect(classifyRipgrepMessage("regex parse error:\nerror: repetition quantifier expects a valid decimal", "a{")).toBe(
		'rg: regex parse error: invalid regex "a{": repetition quantifier expects a valid decimal.',
	);
});

test("classifyRipgrepMessage leaves any other message alone", () => {
	expect(classifyRipgrepMessage("ripgrep died", "x")).toBe("ripgrep died");
	expect(classifyRipgrepMessage("regex parse error:\nerror: unclosed group")).toBe("regex parse error:\nerror: unclosed group");
});

test("a content search groups context around each match", async () => {
	native.grep = async (args) => (calls.push(args), {
		matches: [
			{
				path: "b.txt",
				lineNumber: 2,
				line: "hit",
				contextBefore: [{ lineNumber: 1, line: "three" }],
				contextAfter: [{ lineNumber: 3, line: "five" }],
			},
		],
		totalMatches: 1,
	});
	const result = await searchWorkspace(request({ contextBefore: 1 }), dir);
	expect(result.root).toBe(dir);
	expect(result.path).toBeUndefined();
	expect(result.union).toEqual({
		mode: "content",
		value: {
			matches: [
				{
					file: "b.txt",
					matches: [
						{ lineNumber: 1, content: "three", isContextLine: true },
						{ lineNumber: 2, content: "hit", isContextLine: false },
						{ lineNumber: 3, content: "five", isContextLine: true },
					],
				},
			],
			totalLines: 3,
			totalMatchedLines: 1,
			clientTruncated: false,
			ripgrepTruncated: false,
		},
	});
	expect(calls[0].path).toBe(dir);
	expect([calls[0].mode, calls[0].contextBefore, calls[0].contextAfter]).toEqual(["content", 1, undefined]);
});

test("a count search totals the matches per file", async () => {
	native.grep = async (args) => (calls.push(args), {
		matches: [
			{ path: "a.txt", matchCount: 2 },
			{ path: "b.txt", matchCount: 3 },
		],
		totalMatches: 5,
	});
	const result = await searchWorkspace(request({ outputMode: "count" }), dir);
	expect(result.union.mode).toBe("count");
	expect(result.union.value.counts.map((entry) => entry.count).sort()).toEqual([2, 3]);
	expect([result.union.value.totalFiles, result.union.value.totalMatches]).toEqual([2, 5]);
	expect(calls[0].mode).toBe("count");
});

test("a glob listing walks the files instead of grepping", async () => {
	native.glob = async () => ({ matches: [{ path: join(dir, "b.txt") }, { path: join(dir, "a.txt") }] });
	const result = await searchWorkspace(request({ pattern: "", glob: "**/*.txt", outputMode: "files_with_matches" }), dir);
	expect(result.union.mode).toBe("files_with_matches");
	expect([...result.union.value.files].sort()).toEqual(["a.txt", "b.txt"]);
	expect(result.union.value.totalFiles).toBe(2);
});

test("a search outside the workspace prints absolute paths", async () => {
	native.grep = async () => ({ matches: [{ path: join(outside, "x.txt"), lineNumber: 1, line: "far" }], totalMatches: 1 });
	const result = await searchWorkspace(request({ path: outside }), dir);
	expect(result.path).toBe(outside);
	expect(result.union.value.matches[0].file).toBe(join(outside, "x.txt"));
});

test("a missing path is reported as a path error", async () => {
	native.grep = async () => {
		throw new Error("ripgrep failed");
	};
	await expect(searchWorkspace(request({ path: "gone" }), dir)).rejects.toThrow(`Path does not exist: ${join(dir, "gone")}`);
});

test("formatBlock lists matching lines without a footer when it showed everything", () => {
	const union = {
		mode: "content",
		value: {
			matches: [{ file: "a.js", matches: [{ lineNumber: 3, content: "x", isContextLine: false }] }],
			totalLines: 1,
			totalMatchedLines: 1,
			clientTruncated: false,
			ripgrepTruncated: false,
		},
	};
	expect(formatBlock(union, GREP_CHAR_BUDGET)).toBe("a.js\n  3:x");
});

test("formatBlock names an empty result", () => {
	const union = { mode: "content", value: { matches: [], totalLines: 0, totalMatchedLines: 0, clientTruncated: false, ripgrepTruncated: false } };
	expect(formatBlock(union, GREP_CHAR_BUDGET)).toBe("No matches found");
});

test("formatBlock pages a content result with the next offset", () => {
	const matches = Array.from({ length: 2 }, (_, i) => ({ lineNumber: i + 3, content: `line ${i + 3}`, isContextLine: false }));
	const union = {
		mode: "content",
		value: {
			matches: [{ file: "a.js", matches }],
			totalLines: 2,
			totalMatchedLines: 5,
			clientTruncated: true,
			ripgrepTruncated: false,
			headLimitApplied: 2,
			offsetApplied: 2,
		},
	};
	expect(formatBlock(union, GREP_CHAR_BUDGET)).toBe(
		"a.js\n  3:line 3\n  4:line 4\n[Showing 3-4 of at least 5 matching lines. Use offset=4 to see more, or narrow the search.]",
	);
});

test("formatBlock cuts a long block to the budget", () => {
	const lines = Array.from({ length: 50 }, (_, i) => ({ lineNumber: i + 1, content: "y".repeat(20), isContextLine: false }));
	const union = {
		mode: "content",
		value: { matches: [{ file: "a.js", matches: lines }], totalLines: 50, totalMatchedLines: 50, clientTruncated: false, ripgrepTruncated: false },
	};
	const text = formatBlock(union, 400);
	expect(text).toContain("[Results truncated.");
	expect(text).toContain("Use offset=15 to see more, or narrow the search.]");
	expect(text.length).toBeLessThan(700);
});

test("formatSearchError prefixes the message", () => {
	expect(formatSearchError("boom")).toBe("Error running tool: boom");
});

test("formatBlock lists a count result as file:count", () => {
	const union = {
		mode: "count",
		value: { counts: [{ file: "a.js", count: 2 }], totalFiles: 1, totalMatches: 2, clientTruncated: false, ripgrepTruncated: false },
	};
	expect(formatBlock(union, GREP_CHAR_BUDGET)).toBe("a.js:2");
});
