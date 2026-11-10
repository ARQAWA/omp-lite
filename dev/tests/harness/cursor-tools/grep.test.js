import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { relative } from "node:path";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { contentEntries, contentLines, executeGrep, hostList, install, paginate, parseGrep, parseHostSelector, plainMessage, routeFor, searchGrep, skipMatches } from "../../../../src/modules/cursor-tools/index.js";

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
		for (const path of ["a.ts;ssh://h/x", "a.ts;*.ts", "a.ts;missing", "a.ts;"]) {
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
