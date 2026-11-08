import { afterAll, beforeEach, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { native } from "./stubs.js";

const { buildGlobRequest, formatGlob, mapToGlob, normalizeGlob, parseGlobArgs } = await import(
	"../../../../src/modules/file-workflow/tools/glob/glob.js"
);
const glob = (await import("../../../../src/modules/file-workflow/tools/glob/index.js")).default;

let registered;
glob({ registerTool: (tool) => (registered = tool) });

const dir = mkdtempSync(join(tmpdir(), "file-workflow-glob-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));
const execute = (params) => registered.execute("call", params, undefined, undefined, { cwd: dir });

let calls;
beforeEach(() => {
	calls = [];
	native.glob = async (args) => (calls.push(args), { matches: [] });
});

const listing = (files, extra) => ({
	path: undefined,
	files,
	totalFiles: files.length,
	clientTruncated: false,
	ripgrepTruncated: false,
	...extra,
});

test("parseGlobArgs needs a glob_pattern", () => {
	expect(parseGlobArgs({})).toEqual({ error: "Invalid arguments:\nglob_pattern: Required" });
	expect(parseGlobArgs({ glob_pattern: 3 }).error).toBe("Invalid arguments:\nglob_pattern: Expected string, received number");
});

test("parseGlobArgs refuses an empty pattern", () => {
	expect(parseGlobArgs({ glob_pattern: "" }).error).toBe('Invalid arguments:\nglob_pattern: glob_pattern is empty. Pass "*" to match every file.');
});

test("parseGlobArgs keeps the optional target_directory", () => {
	expect(parseGlobArgs({ glob_pattern: "*.ts" })).toEqual({ args: { glob_pattern: "*.ts", target_directory: undefined } });
	expect(parseGlobArgs({ glob_pattern: "*.ts", target_directory: "/w" }).args.target_directory).toBe("/w");
});

test("normalizeGlob adds the recursive prefix", () => {
	expect([normalizeGlob("*.ts"), normalizeGlob("/x.js"), normalizeGlob("x/"), normalizeGlob("**/y")]).toEqual([
		"**/*.ts",
		"**/x.js",
		"**/x",
		"**/y",
	]);
});

test("normalizeGlob turns backslashes into slashes and an empty pattern into **/", () => {
	expect([normalizeGlob("a\\b"), normalizeGlob("")]).toEqual(["**/a/b", "**/"]);
});

test("buildGlobRequest lists files of the target directory", () => {
	expect(buildGlobRequest({ glob_pattern: "*.ts", target_directory: "/w/sub" })).toEqual({
		pattern: "",
		path: "/w/sub",
		glob: "**/*.ts",
		outputMode: "files_with_matches",
		caseInsensitive: false,
		multiline: false,
	});
});

test("mapToGlob is undefined for a content result", () => {
	expect(mapToGlob({ union: { mode: "content", value: {} }, root: "/w", path: undefined })).toBeUndefined();
});

test("mapToGlob makes paths relative to the requested folder", () => {
	const success = {
		root: "/w",
		path: "sub",
		union: { mode: "files_with_matches", value: { files: ["sub/a.ts"], totalFiles: 1, clientTruncated: false, ripgrepTruncated: false } },
	};
	expect(mapToGlob(success).files).toEqual(["a.ts"]);
});

test("mapToGlob keeps the file name when the file is the target itself", () => {
	const result = mapToGlob({ root: "/w", path: "/w/sub", union: { mode: "files_with_matches", value: { files: ["sub"], totalFiles: 1, clientTruncated: false, ripgrepTruncated: false } } });
	expect(result.files).toEqual(["sub"]);
});

test("formatGlob lists one file with the total", () => {
	expect(formatGlob(listing(["a.ts"]), ".")).toBe("Result of search in '.' (total 1 file):\n- a.ts\n");
});

test("formatGlob names an empty result", () => {
	expect(formatGlob(listing([]), ".")).toBe("Result of search in '.': 0 files found\n");
});

test("formatGlob cuts a long listing and counts the rest", () => {
	const files = Array.from({ length: 3000 }, (_, i) => `file-${i}-${"x".repeat(20)}.ts`);
	const text = formatGlob(listing(files), ".");
	expect(text).toContain("more files ... (Do a more specific search if needed)");
	expect(text.length).toBeLessThan(52_000);
});

test("formatGlob notes a truncated ripgrep walk", () => {
	const text = formatGlob(listing(["a.ts"], { ripgrepTruncated: true }), ".");
	expect(text).toBe("Result of search in '.':\n- a.ts\n[Results truncated. At least 1 file in total. Narrow the search with a more specific target_directory or glob_pattern.]\n");
});

test("execute lists the matching files", async () => {
	native.glob = async (args) => (calls.push(args), { matches: [{ path: join(dir, "a.ts") }, { path: join(dir, "b.ts") }] });
	const result = await execute({ glob_pattern: "*.ts" });
	expect(result.content[0].text).toBe("Result of search in '.' (total 2 files):\n- a.ts\n- b.ts\n");
	expect([calls[0].pattern, calls[0].path]).toEqual(["**/*.ts", dir]);
});

test("execute reports a search failure", async () => {
	native.glob = async () => {
		throw new Error("regex parse error:\nerror: unclosed group");
	};
	const result = await execute({ glob_pattern: "*.ts" });
	expect(result.isError).toBe(true);
	expect(result.content[0].text).toBe("regex parse error:\nerror: unclosed group");
});

test("execute checks the arguments before walking", async () => {
	const result = await execute({ glob_pattern: "" });
	expect(result.isError).toBe(true);
	expect(result.content[0].text).toContain('glob_pattern: glob_pattern is empty. Pass "*" to match every file.');
	expect(calls).toEqual([]);
});
