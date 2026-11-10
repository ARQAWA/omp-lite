import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { relative } from "node:path";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { contentEntries, contentKeys, contentLines, executeGrep, hostList, install, paginate, parseGrep, parseHostSelector, plainMessage, routeFor, searchGrep, skipMatches } from "../../../../src/modules/cursor-tools/index.js";

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
	// The collapsed and the `www.` spelling of an address are the native tool's; a Windows drive is a path.
	expect(routeFor("https:/example.com")).toBe("native");
	expect(routeFor("www.example.com")).toBe("native");
	expect(routeFor("skill:/name")).toBe("native");
	expect(routeFor("C:/work/src")).toBe("engine");
});

test("an address without `://` reaches the native tool, an existing path of that name wins", async () => {
	const dir = mkdtempSync(join(tmpdir(), "grep-address-"));
	try {
		const seen = [];
		const nativeCtx = { cwd: dir, invokeTool: async params => (seen.push(params.path), { content: [{ type: "text", text: "native" }] }) };
		const engine = fakeEngine({ matches: [] });
		for (const path of ["www.example.com", "https:/example.com/page"]) await executeGrep("call", { pattern: "x", path }, undefined, undefined, nativeCtx, { engine });
		expect(seen).toEqual(["www.example.com", "https:/example.com/page"]);
		expect(engine.calls).toEqual([]);
		mkdirSync(join(dir, "www.example.com"));
		await executeGrep("call", { pattern: "x", path: "www.example.com" }, undefined, undefined, nativeCtx, { engine });
		expect(engine.calls[0][0].path).toBe(join(dir, "www.example.com"));
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
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
	const entries = contentEntries(
		[match("a.ts", 5, "hit", { contextBefore: [{ lineNumber: 4, line: "before" }], contextAfter: [{ lineNumber: 6, line: "after" }] })],
		undefined,
		1,
		1,
	);
	expect(contentLines(entries[0])).toEqual(["a.ts:4-before", "a.ts:5:hit", "a.ts:6-after"]);
});

test("context before a later match stays with that match", () => {
	const entries = contentEntries(
		[match("a.ts", 2, "first"), match("a.ts", 9, "second", { contextBefore: [{ lineNumber: 8, line: "near" }] })],
		undefined,
		1,
	);
	expect(contentLines(entries[0])).toEqual(["a.ts:2:first"]);
	expect(contentLines(entries[1])).toEqual(["a.ts:8-near", "a.ts:9:second"]);
});

// The engine hands line 11 to the match it follows and gives the next match no line before it.
const neighbours = [
	match("a.ts", 10, "first", { contextBefore: [{ lineNumber: 9, line: "nine" }], contextAfter: [{ lineNumber: 11, line: "eleven" }] }),
	match("a.ts", 12, "second", { contextAfter: [{ lineNumber: 13, line: "thirteen" }] }),
];

test("every match keeps its whole window and a page prints a shared line once", () => {
	const entries = contentEntries(neighbours, undefined, 1, 1);
	expect(contentLines(entries[0])).toEqual(["a.ts:9-nine", "a.ts:10:first", "a.ts:11-eleven"]);
	expect(contentLines(entries[1])).toEqual(["a.ts:11-eleven", "a.ts:12:second", "a.ts:13-thirteen"]);
	const whole = ["a.ts:9-nine", "a.ts:10:first", "a.ts:11-eleven", "a.ts:12:second", "a.ts:13-thirteen"];
	const page = list => paginate(list, contentLines, { anchor: entry => entry.at, keys: contentKeys }).text.split("\n");
	expect(page(entries)).toEqual(whole);
	// Inside another window a match is context; on a page with its own entry it is a match again.
	const wide = contentEntries(neighbours, undefined, 2, 2);
	expect(contentLines(wide[0])).toEqual(["a.ts:9-nine", "a.ts:10:first", "a.ts:11-eleven", "a.ts:12-second"]);
	expect(contentLines(wide[1])).toEqual(["a.ts:10-first", "a.ts:11-eleven", "a.ts:12:second", "a.ts:13-thirteen"]);
	expect(wide[1].at).toBe(2);
	expect(page(wide)).toEqual(whole);
});

test("a page break keeps the context on both sides", async () => {
	const engine = fakeEngine({ matches: neighbours });
	const first = await searchGrep(request({ "-C": 1, head_limit: 1 }), ctx, { engine });
	expect(first.content[0].text).toBe("a.ts:9-nine\na.ts:10:first\na.ts:11-eleven\n[1+ of 2 matches shown. Use offset=1 for the next page.]");
	const second = await searchGrep(request({ "-C": 1, head_limit: 1, offset: 1 }), ctx, { engine });
	expect(second.content[0].text).toBe("a.ts:11-eleven\na.ts:12:second\na.ts:13-thirteen");
	// One match per page, and the lines past the neighbour match stay in the window.
	const wide = await searchGrep(request({ "-A": 3, head_limit: 1 }), ctx, { engine });
	expect(wide.content[0].text).toBe("a.ts:10:first\na.ts:11-eleven\na.ts:12-second\na.ts:13-thirteen\n[1+ of 2 matches shown. Use offset=1 for the next page.]");
});

test("an existing path with mask characters is searched by the engine", async () => {
	const dir = mkdtempSync(join(tmpdir(), "grep-mask-"));
	try {
		mkdirSync(join(dir, "app", "[id]"), { recursive: true });
		writeFileSync(join(dir, "a[b].txt"), "x\n");
		const engine = fakeEngine({ matches: [match(join(dir, "a[b].txt"), 1, "x")] });
		const counts = await executeGrep("call", { pattern: "x", path: "a[b].txt", output_mode: "count" }, undefined, undefined, { cwd: dir, invokeTool: undefined }, { engine });
		expect(counts.content[0].text).toBe("a[b].txt:1");
		await executeGrep("call", { pattern: "x", path: "app/[id]", type: "ts" }, undefined, undefined, { cwd: dir, invokeTool: undefined }, { engine });
		expect(engine.calls[1][0].path).toBe(join(dir, "app", "[id]"));
		// A name that does not exist is a mask: the engine walks its directory and the mask filters the files.
		const walk = fakeEngine({ matches: [match("cd.txt", 1, "x", { matchCount: 2 })] });
		const mask = await executeGrep("call", { pattern: "x", path: "c[d].txt", output_mode: "count" }, undefined, undefined, { cwd: dir, invokeTool: undefined }, { engine: walk });
		expect(walk.calls[0][0].path).toBe(dir);
		expect(walk.calls[0][0].glob).toBe("c[d].txt");
		expect(mask.content[0].text).toBe("cd.txt:2");
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("a file over the engine window found in a directory walk is named in a note", async () => {
	const dir = mkdtempSync(join(tmpdir(), "grep-window-"));
	try {
		writeFileSync(join(dir, "big.log"), Buffer.alloc(4 * 1024 * 1024 + 1, "x"));
		const walk = await searchGrep(request({}), { cwd: dir }, { engine: fakeEngine({ matches: [match("big.log", 1, "TODO")] }) });
		expect(walk.content[0].text).toBe("big.log:1:TODO\n[only the first 4 MiB searched in big.log; search such a file by its own path]");
		const named = await searchGrep(request({ path: "big.log" }), { cwd: dir }, { engine: fakeEngine({ matches: [match(join(dir, "big.log"), 1, "TODO")] }) });
		expect(named.content[0].text).toBe("big.log:1:TODO");
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
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

test("an over-long match line is emitted alone and whole", () => {
	const long = `${"a".repeat(20000)}end`;
	const entries = [{ file: "x", lines: [{ lineNumber: 1, line: long, isContext: false }] }, { file: "x", lines: [{ lineNumber: 2, line: "b", isContext: false }] }];
	const page = paginate(entries, contentLines, {});
	expect(page.text).toBe(`x:1:${long}`);
	expect(page.next).toBe(1);
});

test("an oversized entry keeps its match line and the nearest context", () => {
	const context = number => ({ lineNumber: number, line: `${number}${"c".repeat(1000)}`, isContext: true });
	const lines = [...Array.from({ length: 20 }, (_, i) => context(i + 1)), { lineNumber: 21, line: "the match", isContext: false }, ...Array.from({ length: 20 }, (_, i) => context(i + 22))];
	const anchor = entry => entry.lines.findIndex(line => !line.isContext);
	const page = paginate([{ file: "x", lines }], contentLines, { anchor });
	const rows = page.text.split("\n");
	expect(page.text.length).toBeLessThan(15100);
	expect(rows).toContain("x:21:the match");
	expect([rows[0], rows.at(-1)]).toEqual(["…", "…"]);
	expect(rows[1].startsWith("x:14-14c")).toBe(true);
	expect(rows.at(-2).startsWith("x:28-28c")).toBe(true);
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

test("a comma or space joined list of existing paths is searched by the engine, another one by the native tool", async () => {
	const dir = mkdtempSync(join(tmpdir(), "grep-joined-"));
	try {
		mkdirSync(join(dir, "src"));
		mkdirSync(join(dir, "tests"));
		const engine = fakeEngine({ matches: [] });
		const seen = [];
		const nativeCtx = { cwd: dir, invokeTool: async params => (seen.push(params.path), { content: [{ type: "text", text: "native" }] }) };
		for (const path of ["src, tests", "src tests"]) await executeGrep("call", { pattern: "x", path, "-C": 1 }, undefined, undefined, nativeCtx, { engine });
		expect(engine.calls.map(call => call[0].path)).toEqual([join(dir, "src"), join(dir, "tests"), join(dir, "src"), join(dir, "tests")]);
		expect(seen).toEqual([]);
		await executeGrep("call", { pattern: "x", path: "src, gone" }, undefined, undefined, nativeCtx, { engine });
		expect(seen).toEqual(["src, gone"]);
		const refused = await executeGrep("call", { pattern: "x", path: "src, gone", "-C": 1 }, undefined, undefined, nativeCtx, { engine });
		expect(refused.content[0].text).toContain("not supported for archive, selector, path-list or URL searches");
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("the line cap comes from the output setting and a cut line shows its column", async () => {
	const engine = fakeEngine({ matches: [match("a.ts", 3, "...x NEEDLE y...", { truncated: true, column: 40002 })] });
	const result = await searchGrep(request({ path: "src" }), ctx, { engine, maxColumns: 768 });
	expect(engine.calls[0][0].maxColumns).toBe(768);
	expect(result.content[0].text).toBe("src/a.ts:3:...x NEEDLE y... [col 40002]");
	await searchGrep(request({ path: "src" }), ctx, { engine, maxColumns: 0 });
	expect("maxColumns" in engine.calls[1][0]).toBe(false);
});

test("a mask in the path goes to the engine as its file filter and keeps every Cursor argument", async () => {
	const dir = mkdtempSync(join(tmpdir(), "grep-mask-"));
	try {
		mkdirSync(join(dir, "src"));
		mkdirSync(join(dir, "tests"));
		const engine = fakeEngine({ matches: [match("a.js", 1, "x"), match("a.test.js", 2, "x")] });
		const seen = [];
		const nativeCtx = { cwd: dir, invokeTool: async params => (seen.push(params.path), { content: [{ type: "text", text: "native" }] }) };
		const one = await executeGrep("call", { pattern: "x", path: "src/*.js", head_limit: 5, "-C": 1, type: "js", multiline: true }, undefined, undefined, nativeCtx, { engine });
		// The mask after a directory names the entries of that directory: the engine must not make it recursive.
		expect(engine.calls[0][0]).toMatchObject({ path: join(dir, "src"), glob: "*.js", recursive: false, type: "js", maxCount: 100000 });
		expect(one.content[0].text).toBe("src/a.js:1:x\nsrc/a.test.js:2:x");
		// A bare mask matches at any depth, as in the native tool.
		await executeGrep("call", { pattern: "x", path: "*.js" }, undefined, undefined, nativeCtx, { engine });
		expect(engine.calls[1][0]).toMatchObject({ path: dir, glob: "*.js" });
		expect("recursive" in engine.calls[1][0]).toBe(false);
		await executeGrep("call", { pattern: "x", path: "src/*.js, tests/**/*.{js,ts}", head_limit: 5 }, undefined, undefined, nativeCtx, { engine });
		expect(engine.calls.slice(2).map(call => [call[0].path, call[0].glob])).toEqual([[join(dir, "src"), "*.js"], [join(dir, "tests"), "**/*.{js,ts}"]]);
		// The `glob` argument narrows the files of a mask here, and such a search is collected whole.
		const narrowed = await executeGrep("call", { pattern: "x", path: "src/*.js", glob: "*.test.js", output_mode: "files_with_matches" }, undefined, undefined, nativeCtx, { engine });
		expect(engine.calls.at(-1)[0].glob).toBe("*.js");
		expect("maxCount" in engine.calls.at(-1)[0]).toBe(false);
		expect(narrowed.content[0].text).toBe("src/a.test.js");
		expect(seen).toEqual([]);
		await executeGrep("call", { pattern: "x", path: "gone/*.js" }, undefined, undefined, nativeCtx, { engine });
		expect(seen).toEqual(["gone/*.js"]);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("a line selector collects its file whole, another search stops at the collection limit", async () => {
	const engine = fakeEngine({ matches: [match("/work/a.ts", 150000, "x")] });
	const result = await searchGrep({ ...request({ path: "/work/a.ts" }), ranges: [[140000, 160000]] }, ctx, { engine });
	expect("maxCount" in engine.calls[0][0]).toBe(false);
	expect(result.content[0].text).toContain(":150000:x");
	await searchGrep(request({ path: "src" }), ctx, { engine });
	expect(engine.calls[1][0].maxCount).toBe(100000);
	// The page offset is applied after the search, so the collection reaches past it.
	const far = fakeEngine({ matches: [], limitReached: true });
	const page = await searchGrep(request({ path: "src", offset: 100000 }), ctx, { engine: far });
	expect(far.calls[0][0].maxCount).toBe(200000);
	expect(page.content[0].text).toContain("collection stopped at 200000 matches");
	// The engine raises its flag on the first match of a named file too: that is not a full collection.
	const single = fakeEngine({ matches: [match("/work/a.ts", 0, "")], limitReached: true, totalMatches: 2 });
	const files = await searchGrep(request({ path: "/work/a.ts", output_mode: "files_with_matches" }), ctx, { engine: single });
	expect(files.content[0].text).not.toContain("collection stopped");
});

test("`!` entries of a path list are exclusions with the native rules", async () => {
	const dir = mkdtempSync(join(tmpdir(), "grep-exclude-"));
	try {
		mkdirSync(join(dir, "src"));
		writeFileSync(join(dir, "src", "a.test.ts"), "x\n");
		writeFileSync(join(dir, "!keep.txt"), "x\n");
		const engine = fakeEngine({ matches: [] });
		const run = path => executeGrep("call", { pattern: "x", path, head_limit: 5 }, undefined, undefined, { cwd: dir, invokeTool: undefined }, { engine });
		// A bare name is dropped at any depth; a path only under the working directory, rebased onto the root.
		await run("src;!*.test.ts;!vendor;!src/legacy;!./gen");
		expect(engine.calls[0][0]).toMatchObject({ path: join(dir, "src"), exclude: ["*.test.ts", "vendor", "/legacy"] });
		// Exclusions alone search the working directory.
		await run("!*.test.ts;!./gen");
		expect(engine.calls[1][0]).toMatchObject({ path: dir, exclude: ["*.test.ts", "/gen"] });
		// A named file is searched even when an exclusion matches it, and an existing `!name` is a path.
		await run("src/a.test.ts;!*.test.ts");
		expect(engine.calls[2][0].path).toBe(join(dir, "src", "a.test.ts"));
		expect("exclude" in engine.calls[2][0]).toBe(false);
		await run("src;!keep.txt");
		expect(engine.calls.slice(3).map(call => call[0].path)).toEqual([join(dir, "src"), join(dir, "!keep.txt")]);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
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
	for (const path of ["bundle.zip:src/a.ts", "pkg.whl:pkg/a.py", "ext.vsix:extension/file.txt", "pkg.tar.gz:src/a.ts", "bundle.tar:src/a.ts"]) {
		const ctx = { cwd: "/work", invokeTool: async () => ({ content: [{ type: "text", text: "*1|a\n*2|b" }] }) };
		const result = await executeGrep("call", { pattern: "x", path, offset: 1 }, undefined, undefined, ctx);
		expect(result.content[0].text).toBe("*2|b");
	}
});

test("a native error keeps its diagnosis under offset", async () => {
	const ctx = { cwd: "/work", invokeTool: async () => ({ isError: true, content: [{ type: "text", text: "Path not found: a.ts:1-2" }] }) };
	const result = await executeGrep("call", { pattern: "x", path: "a.ts:1-2", offset: 1 }, undefined, undefined, ctx);
	expect(result.content[0].text).toBe("Path not found: a.ts:1-2");
});

test("a one-file page from a remote multi-file scope keeps its match", async () => {
	const ctx = {
		cwd: "/work",
		invokeTool: async () => ({ details: { files: ["ssh://host/dir/a.ts"] }, content: [{ type: "text", text: "*1|a" }] }),
	};
	const result = await executeGrep("call", { pattern: "x", path: "ssh://host/dir", offset: 1 }, undefined, undefined, ctx);
	expect(result.content[0].text).toBe("*1|a");
});

test("a host file selector routes to the engine and filters the range", async () => {
	const dir = mkdtempSync(join(tmpdir(), "grep-selector-"));
	try {
		const file = join(dir, "a.ts");
		writeFileSync(file, "x\n".repeat(30));
		expect(parseHostSelector(`${file}:10-20`)).toEqual({ base: file, ranges: [[10, 20]] });
		expect(parseHostSelector(`${file}:10-`)).toEqual({ base: file, ranges: [[10, Infinity]] });
		expect(parseHostSelector(`${file}:5`)).toEqual({ base: file, ranges: [[5, Infinity]] });
		expect(parseHostSelector(`${file}:L5+L3`)).toEqual({ base: file, ranges: [[5, 7]] });
		expect(parseHostSelector("a.ts:10-20", dir)).toEqual({ base: file, ranges: [[10, 20]] });
		expect(parseHostSelector(`${file}:2,5`)).toEqual({ base: file, ranges: [[2, 2], [5, 5]] });
		expect(parseHostSelector("bundle.zip:src/a.ts")).toBeUndefined();
		expect(routeFor("dir:L10-L20")).toBe("native");
		const engine = fakeEngine({
			matches: [match(file, 5, "a"), match(file, 10, "b"), match(file, 15, "c"), match(file, 25, "d")],
		});
		const result = await executeGrep("call", { pattern: "x", path: `${file}:10-20`, offset: 1 }, undefined, undefined, { cwd: dir, invokeTool: undefined }, { engine });
		expect(engine.calls).toHaveLength(1);
		expect(engine.calls[0][0].path).toBe(file);
		expect(result.content[0].text).toBe("a.ts:15:c");
		const counts = await executeGrep("call", { pattern: "x", path: "a.ts:10-20", output_mode: "count" }, undefined, undefined, { cwd: dir, invokeTool: undefined }, { engine });
		expect(counts.content[0].text).toBe("a.ts:2");
		expect(engine.calls[1][0].mode).toBe("content");
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("a literal filename with a colon beats selector parsing", () => {
	const dir = mkdtempSync(join(tmpdir(), "grep-literal-"));
	try {
		writeFileSync(join(dir, "a.ts"), "x");
		writeFileSync(join(dir, "a.ts:10-20"), "literal");
		expect(parseHostSelector("a.ts:10-20", dir)).toBeUndefined();
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("a literal colon filename uses the engine in count mode", async () => {
	const dir = mkdtempSync(join(tmpdir(), "grep-literal-count-"));
	try {
		writeFileSync(join(dir, "a.ts:10-20"), "literal");
		writeFileSync(join(dir, "bundle.zip:10-20"), "literal");
		const engine = {
			calls: [],
			grep: async request => {
				engine.calls.push([request]);
				const path = request.path.endsWith("bundle.zip:10-20") ? join(dir, "bundle.zip:10-20") : join(dir, "a.ts:10-20");
				return { matches: [match(path, 1, "literal")] };
			},
		};
		const result = await executeGrep("call", { pattern: "literal", path: "a.ts:10-20", output_mode: "count" }, undefined, undefined, { cwd: dir, invokeTool: undefined }, { engine });
		expect(engine.calls).toHaveLength(1);
		expect(engine.calls[0][0].path).toBe(join(dir, "a.ts:10-20"));
		expect(result.content[0].text).toBe("a.ts:10-20:1");
		const archiveName = await executeGrep("call", { pattern: "literal", path: "bundle.zip:10-20", output_mode: "count" }, undefined, undefined, { cwd: dir, invokeTool: undefined }, { engine });
		expect(engine.calls[1][0].path).toBe(join(dir, "bundle.zip:10-20"));
		expect(archiveName.content[0].text).toBe("bundle.zip:10-20:1");
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("a semicolon list stays a list even when the whole text exists as a file", async () => {
	const dir = mkdtempSync(join(tmpdir(), "grep-list-"));
	try {
		const list = "bundle.zip:x;other:10-20";
		writeFileSync(join(dir, list), "literal");
		const seen = [];
		const ctx = { cwd: dir, invokeTool: async params => (seen.push(params), { content: [{ type: "text", text: "native" }] }) };
		const result = await executeGrep("call", { pattern: "x", path: list }, undefined, undefined, ctx);
		expect(seen).toHaveLength(1);
		expect(seen[0].path).toBe(list);
		expect(result.content[0].text).toBe("native");
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("a pure host list searches each entry with the engine", async () => {
	const dir = mkdtempSync(join(tmpdir(), "grep-list-"));
	try {
		writeFileSync(join(dir, "a.ts"), "x");
		mkdirSync(join(dir, "sub"));
		writeFileSync(join(dir, "sub", "b.ts"), "x");
		expect(hostList("a.ts; sub", dir)).toEqual(["a.ts", "sub"]);
		expect(hostList("a.ts;ssh://h/x", dir)).toBeUndefined();
		expect(hostList("a.ts;missing", dir)).toBeUndefined();
		const engine = {
			calls: [],
			grep: async request => {
				engine.calls.push(request.path);
				const file = request.path.endsWith("sub") ? join(dir, "sub", "b.ts") : join(dir, "a.ts");
				return { matches: [match(file, 1, "hit")] };
			},
		};
		const result = await executeGrep("call", { pattern: "x", path: "a.ts; sub" }, undefined, undefined, { cwd: dir, invokeTool: undefined }, { engine });
		expect(engine.calls).toHaveLength(2);
		expect(result.content[0].text).toBe("a.ts:1:hit\nsub/b.ts:1:hit");
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("a host list returns every engine match without the native 200 cap", async () => {
	const dir = mkdtempSync(join(tmpdir(), "grep-many-"));
	try {
		writeFileSync(join(dir, "a.ts"), "x");
		const matches = Array.from({ length: 250 }, (_, index) => match(join(dir, "a.ts"), index + 1, `line ${index + 1}`));
		const engine = { calls: [], grep: async request => (engine.calls.push(request.path), { matches }) };
		const result = await executeGrep("call", { pattern: "x", path: "a.ts;a.ts" }, undefined, undefined, { cwd: dir, invokeTool: undefined }, { engine });
		expect(engine.calls).toHaveLength(1);
		expect(result.content[0].text.split("\n")).toHaveLength(250);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("non-host lists keep the native route through the tool entry", async () => {
	const dir = mkdtempSync(join(tmpdir(), "grep-native-list-"));
	try {
		writeFileSync(join(dir, "a.ts"), "x");
		for (const path of ["a.ts;ssh://h/x", "a.ts;gone/*.ts", "a.ts;missing", "a.ts;"]) {
			const seen = [];
			const ctx = { cwd: dir, invokeTool: async params => (seen.push(params), { content: [{ type: "text", text: "native" }] }) };
			const result = await executeGrep("call", { pattern: "x", path }, undefined, undefined, ctx);
			expect(seen).toHaveLength(1);
			expect(result.content[0].text).toBe("native");
		}
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("list results resolve against their own root and stay cwd-relative", async () => {
	const dir = mkdtempSync(join(tmpdir(), "grep-list-roots-"));
	const outside = mkdtempSync(join(tmpdir(), "grep-list-outside-"));
	try {
		mkdirSync(join(dir, "d1"));
		mkdirSync(join(dir, "d2"));
		writeFileSync(join(dir, "d1", "a.ts"), "x");
		writeFileSync(join(dir, "d2", "a.ts"), "x");
		writeFileSync(join(outside, "z.ts"), "x");
		const engine = {
			calls: [],
			grep: async request => {
				engine.calls.push(request.path);
				if (request.path.endsWith("d1")) return { matches: [{ path: "a.ts", lineNumber: 1, line: "first" }] };
				if (request.path.endsWith("d2")) return { matches: [{ path: "a.ts", lineNumber: 1, line: "second" }] };
				return { matches: [{ path: join(outside, "z.ts"), lineNumber: 1, line: "third" }] };
			},
		};
		const result = await executeGrep("call", { pattern: "x", path: "d1;d2" }, undefined, undefined, { cwd: dir, invokeTool: undefined }, { engine });
		expect(result.content[0].text).toBe("d1/a.ts:1:first\nd2/a.ts:1:second");
		const away = await executeGrep("call", { pattern: "x", path: "d1;d2" }, undefined, undefined, { cwd: dir, invokeTool: undefined }, { engine: { calls: [], grep: async () => ({ matches: [{ path: join(outside, "z.ts"), lineNumber: 1, line: "third" }] }) } });
		expect(away.content[0].text).toBe(relative(dir, join(outside, "z.ts")) + ":1:third");
	} finally {
		rmSync(dir, { recursive: true, force: true });
		rmSync(outside, { recursive: true, force: true });
	}
});
