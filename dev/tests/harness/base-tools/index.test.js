import { expect, test } from "bun:test";
import {
	FILES_DESCRIPTION,
	groupByDirectory,
	install,
	mapBudget,
	normalizeFiles,
	renderMap,
	renderSearch,
	runMap,
	runSearch,
} from "../../../../src/modules/base-tools/index.js";

const engine = (matches, capture) => async () => ({
	FileType: { File: 1 },
	async glob(options) {
		if (capture) capture.push(options);
		return { matches: matches.map(path => ({ path, fileType: 1 })) };
	},
});

const run = (params, matches, options = {}) =>
	runMap(params, { cwd: "/repo" }, { engine: engine(matches, options.capture), threshold: 45, ...options });

const searchEngine = (scanned, counts, content, capture) => async () => ({
	FileType: { File: 1 },
	async glob(options) {
		capture?.push({ kind: "glob", ...options });
		return {
			matches: scanned.map(entry => {
				const [path, size] = typeof entry === "string" ? [entry, 1] : [entry.path, entry.size];
				return { path, fileType: 1, size };
			}),
		};
	},
	async grep(options) {
		capture?.push({ kind: "grep", ...options });
		return options.mode === "count" ? counts : content;
	},
});

const search = (params, scanned, counts, content, options = {}) =>
	runSearch(params, { cwd: "/repo" }, {
		engine: searchEngine(scanned, counts, content, options.capture),
		threshold: 45,
		...options,
	});

test("a directory without git returns every file under the root", async () => {
	const files = ["top.txt", "src/a.ts", "src/deep/b.ts", "web/app.js"];
	const result = await run({}, files);
	expect(result.isError).toBeUndefined();
	const flat = result.content[0].text.replace(/\/\n {2}/g, "/");
	for (const file of files) expect(flat).toContain(file);
});

test("the first line is the total and the last line is one of the two labels", async () => {
	const result = await run({}, ["a.ts", "b.ts"]);
	const lines = result.content[0].text.split("\n");
	expect(lines[0]).toBe("total 2 files");
	expect(lines.at(-1)).toBe("[all 2 files listed]");
});

test("paths are grouped by their directories", () => {
	const text = renderMap(["top.txt", "src/a.ts", "src/deep/b.ts", "src/deep/c.ts"]);
	expect(text).toContain("src/\n  a.ts");
	expect(text).toContain("src/deep/\n  b.ts\n  c.ts");
	expect(text).toContain("\ntop.txt\n");
});

test("a list over the budget folds deep directories and the counts add up", () => {
	const files = [];
	for (let dir = 0; dir < 20; dir++) for (let file = 0; file < 5; file++) files.push(`src/d${dir}/file${file}.ts`);
	const full = renderMap(files);
	const budget = Buffer.byteLength(full) - 40;
	const text = renderMap(files, budget);
	expect(Buffer.byteLength(text)).toBeLessThanOrEqual(budget);
	const last = text.split("\n").at(-1);
	const match = /^\[100 files: (\d+) listed, the rest folded into (\d+) directories\]$/.exec(last);
	expect(match).not.toBeNull();
	const folded = [...text.matchAll(/src\/d\d+\/ \((\d+) files\)/g)].reduce((sum, hit) => sum + Number(hit[1]), 0);
	expect(Number(match[1]) + folded).toBe(100);
	expect(Number(match[2])).toBeGreaterThan(0);
});

test("4000 top-level directories are returned whole for the artifact", () => {
	const files = [];
	for (let dir = 0; dir < 4000; dir++) files.push(`d${dir}/file.ts`);
	const budget = 45 * 1024;
	const text = renderMap(files, budget);
	expect(Buffer.byteLength(text)).toBeGreaterThan(budget);
	expect(text.split("\n")[0]).toBe("total 4000 files");
	expect(text).toContain("d0/ (1 files)");
	expect(text).toContain("d3999/ (1 files)");
	expect(text.split("\n").at(-1)).toBe("[4000 files: 0 listed, the rest folded into 4000 directories]");
});

test("a flat folder over the budget is returned whole", () => {
	const files = [];
	for (let file = 0; file < 6000; file++) files.push(`file${file}.ts`);
	const text = renderMap(files, 45 * 1024);
	expect(Buffer.byteLength(text)).toBeGreaterThan(45 * 1024);
	expect(text.split("\n")[0]).toBe("total 6000 files");
	expect(text).toContain("file0.ts");
	expect(text).toContain("file5999.ts");
	expect(text.split("\n").at(-1)).toBe("[all 6000 files listed]");
});

test("the description names the artifact for a map too large", () => {
	expect(FILES_DESCRIPTION).toContain("artifact://N");
});

test("root files are named, never folded into an unexpandable ./ line", () => {
	const files = ["rootA.ts", "rootB.ts"];
	for (let top = 0; top < 10; top++) for (let dir = 0; dir < 100; dir++) files.push(`g${top}/d${dir}/file.ts`);
	const text = renderMap(files, 5 * 1024);
	expect(text).toContain("rootA.ts");
	expect(text).toContain("rootB.ts");
	expect(text).not.toContain("./ (");
});

test("the engine receives the mask, hidden and gitignore settings", async () => {
	const capture = [];
	await run({ glob: "**/*.ts", hidden: false, gitignore: false }, ["src/a.ts"], { capture });
	expect(capture[0].pattern).toBe("**/*.ts");
	expect(capture[0].hidden).toBe(false);
	expect(capture[0].gitignore).toBe(false);
	expect(capture[0].includeNodeModules).toBe(false);
	await run({}, ["a.ts"], { capture });
	expect(capture[1].pattern).toBe("**/*");
	expect(capture[1].hidden).toBe(true);
	expect(capture[1].gitignore).toBe(true);
});

test("a 20-word pattern lists every matched file with its count and first line", async () => {
	const pattern = "alpha|beta|gamma|delta|epsilon|zeta|eta|theta|iota|kappa|lambda|mu|nu|xi|omicron|pi|rho|sigma|tau|upsilon";
	const capture = [];
	const result = await search({ pattern }, ["src/a.ts", "src/b.ts", "src/c.ts", "src/d.ts"], {
		matches: [
			{ path: "src/a.ts", matchCount: 2 },
			{ path: "src/b.ts", matchCount: 1 },
			{ path: "src/c.ts", matchCount: 1 },
		],
		totalMatches: 4,
		filesSearched: 4,
	}, {
		matches: [
			{ path: "src/a.ts", line: "const alpha = 1;" },
			{ path: "src/b.ts", line: "beta();" },
			{ path: "src/c.ts", line: "gamma();" },
		],
	}, { capture });
	const text = result.content[0].text;
	expect(result.isError).toBeUndefined();
	expect(text.split("\n")[0]).toBe("3 files, 4 matches, searched 4 of 4 files");
	expect(text).toContain("src/a.ts (2 matches): const alpha = 1;");
	expect(text).toContain("src/b.ts (1 match): beta();");
	expect(text).toContain("src/c.ts (1 match): gamma();");
	expect(capture.filter(call => call.kind === "grep").every(call => call.pattern === pattern)).toBe(true);
	const contentCall = capture.find(call => call.kind === "grep" && call.mode === "content");
	expect(contentCall.maxCount).toBeUndefined();
	expect(contentCall.maxCountPerFile).toBe(1);
});

test("files are ordered by match count", async () => {
	const result = await search({ pattern: "x" }, ["a.ts", "b.ts", "c.ts"], {
		matches: [
			{ path: "b.ts", matchCount: 1 },
			{ path: "a.ts", matchCount: 5 },
			{ path: "c.ts", matchCount: 3 },
		],
		totalMatches: 9,
		filesSearched: 3,
	}, { matches: [{ path: "a.ts", line: "a" }, { path: "b.ts", line: "b" }, { path: "c.ts", line: "c" }] });
	const lines = result.content[0].text.split("\n");
	const at = path => lines.findIndex(line => line.startsWith(`${path} (`));
	expect(at("a.ts")).toBeLessThan(at("c.ts"));
	expect(at("c.ts")).toBeLessThan(at("b.ts"));
});

test("case defaults to sensitive and case false ignores it", async () => {
	const capture = [];
	const counts = { matches: [{ path: "a.ts", matchCount: 1 }], totalMatches: 1, filesSearched: 1 };
	const content = { matches: [{ path: "a.ts", line: "x" }] };
	await search({ pattern: "X" }, ["a.ts"], counts, content, { capture });
	expect(capture.filter(call => call.kind === "grep").every(call => call.ignoreCase === false)).toBe(true);
	capture.length = 0;
	await search({ pattern: "X", case: false }, ["a.ts"], counts, content, { capture });
	expect(capture.filter(call => call.kind === "grep").every(call => call.ignoreCase === true)).toBe(true);
});

test("case false finds the other case and case true does not", async () => {
	const engine = async () => ({
		FileType: { File: 1 },
		async glob() {
			return { matches: [{ path: "a.ts", fileType: 1, size: 1 }] };
		},
		async grep(options) {
			const hit = options.ignoreCase;
			return options.mode === "count"
				? { matches: hit ? [{ path: "a.ts", matchCount: 1 }] : [], totalMatches: hit ? 1 : 0, filesSearched: 1 }
				: { matches: hit ? [{ path: "a.ts", line: "x" }] : [] };
		},
	});
	const sensitive = await runSearch({ pattern: "X" }, { cwd: "/repo" }, { engine, threshold: 45 });
	expect(sensitive.content[0].text.split("\n")[0]).toBe("0 files, 0 matches, searched 1 of 1 files");
	const insensitive = await runSearch({ pattern: "X", case: false }, { cwd: "/repo" }, { engine, threshold: 45 });
	expect(insensitive.content[0].text).toContain("a.ts (1 match): x");
});

test("a matched directory glob counts its files like grep", async () => {
	const patterns = [];
	const engine = async () => ({
		FileType: { File: 1, Dir: 2 },
		async glob(options) {
			patterns.push(options.pattern);
			if (options.pattern === "src" || options.pattern === "src*") return { matches: [{ path: "src", fileType: 2 }] };
			if (options.pattern === "src/**") {
				return { matches: [{ path: "src/a.ts", fileType: 1, size: 1 }, { path: "src/sub", fileType: 2 }] };
			}
			return { matches: [] };
		},
		async grep(options) {
			return options.mode === "count"
				? { matches: [{ path: "src/a.ts", matchCount: 1 }], totalMatches: 1, filesSearched: 1 }
				: { matches: [{ path: "src/a.ts", line: "needle" }] };
		},
	});
	for (const glob of ["src", "src*"]) {
		patterns.length = 0;
		const result = await runSearch({ pattern: "needle", glob }, { cwd: "/repo" }, { engine, threshold: 45 });
		expect(result.content[0].text.split("\n")[0]).toBe("1 files, 1 matches, searched 1 of 1 files");
		expect(patterns).toContain("src/**");
	}
});

test("a recursive mask that matches a directory expands it", async () => {
	const engine = async () => ({
		FileType: { File: 1, Dir: 2 },
		async glob(options) {
			if (options.pattern === "**/src") return { matches: [{ path: "deep/src", fileType: 2 }] };
			if (options.pattern === "deep/src/**") return { matches: [{ path: "deep/src/a.ts", fileType: 1, size: 1 }] };
			return { matches: [] };
		},
		async grep(options) {
			return options.mode === "count"
				? { matches: [{ path: "deep/src/a.ts", matchCount: 1 }], totalMatches: 1, filesSearched: 1 }
				: { matches: [{ path: "deep/src/a.ts", line: "needle" }] };
		},
	});
	const result = await runSearch({ pattern: "needle", glob: "**/src" }, { cwd: "/repo" }, { engine, threshold: 45 });
	expect(result.content[0].text.split("\n")[0]).toBe("1 files, 1 matches, searched 1 of 1 files");
});

test("a newline escape enables multiline, as in the native grep tool", async () => {
	const capture = [];
	const result = await search({ pattern: "a\\nb" }, ["a.ts"], {
		matches: [{ path: "a.ts", matchCount: 1 }],
		totalMatches: 1,
		filesSearched: 1,
	}, { matches: [{ path: "a.ts", line: "alpha\nbeta" }] }, { capture });
	expect(capture.filter(call => call.kind === "grep").every(call => call.multiline === true)).toBe(true);
	expect(result.content[0].text).toContain("a.ts (1 match): alpha\\nbeta");
	expect(result.content[0].text).not.toContain("alpha\nbeta");
});

test("node_modules stays hidden even when the mask mentions it", async () => {
	const capture = [];
	const result = await search({ pattern: "x", glob: "**/node_modules/**" }, [
		"node_modules/pkg/a.ts",
		"src/a.ts",
	], {
		matches: [
			{ path: "node_modules/pkg/a.ts", matchCount: 2 },
			{ path: "src/a.ts", matchCount: 1 },
		],
		totalMatches: 3,
		filesSearched: 2,
	}, {
		matches: [
			{ path: "node_modules/pkg/a.ts", line: "x" },
			{ path: "src/a.ts", line: "x" },
		],
	}, { capture });
	const text = result.content[0].text;
	expect(text).not.toContain("node_modules");
	expect(text.split("\n")[0]).toBe("1 files, 1 matches, searched 1 of 1 files");
	expect(capture.filter(call => call.kind === "grep").every(call => call.glob === "**/node_modules/**")).toBe(true);
});

test("a brace mask drops node_modules and keeps the other branch", async () => {
	const capture = [];
	const result = await search({ pattern: "x", glob: "{src,node_modules}/**" }, ["src/a.ts"], {
		matches: [{ path: "src/a.ts", matchCount: 1 }],
		totalMatches: 1,
		filesSearched: 1,
	}, { matches: [{ path: "src/a.ts", line: "x" }] }, { capture });
	expect(result.content[0].text.split("\n")[0]).toBe("1 files, 1 matches, searched 1 of 1 files");
	const grep = capture.find(call => call.kind === "grep" && call.mode === "count");
	expect(grep.glob).toBe("{src,node_modules}/**");
});

test("a node_modules* mask still shows node_modules_backup", async () => {
	const capture = [];
	const result = await search({ pattern: "x", glob: "node_modules*" }, [
		"node_modules/a.ts",
		"node_modules_backup/b.ts",
	], {
		matches: [
			{ path: "node_modules/a.ts", matchCount: 1 },
			{ path: "node_modules_backup/b.ts", matchCount: 1 },
		],
		totalMatches: 2,
		filesSearched: 2,
	}, {
		matches: [
			{ path: "node_modules/a.ts", line: "x" },
			{ path: "node_modules_backup/b.ts", line: "x" },
		],
	}, { capture });
	const text = result.content[0].text;
	expect(text).toContain("node_modules_backup/b.ts");
	expect(text).not.toContain("node_modules/a.ts");
	expect(capture.find(call => call.kind === "grep" && call.mode === "count").glob).toBe("node_modules*");
});

test("a node_modules root stays hidden without loading the engine", async () => {
	const engine = async () => {
		throw new Error("engine must not load");
	};
	const map = await runMap({ path: "node_modules" }, { cwd: "/repo" }, { engine, threshold: 45 });
	expect(map.content[0].text).toBe("total 0 files\n[all 0 files listed]");
	const search = await runSearch({ path: "node_modules", pattern: "x" }, { cwd: "/repo" }, { engine, threshold: 45 });
	expect(search.content[0].text).toBe("0 files, 0 matches, searched 0 of 0 files\nNo files matched.\n[all 0 files listed]");
});

test("a skipped file still shows in searched K of T", async () => {
	const result = await search({ pattern: "x", glob: "{src,node_modules}/**" }, [
		"node_modules/pkg/a.ts",
		"src/a.ts",
		"src/b.bin",
	], {
		matches: [{ path: "src/a.ts", matchCount: 1 }],
		totalMatches: 1,
		filesSearched: 2,
	}, { matches: [{ path: "src/a.ts", line: "x" }] });
	expect(result.content[0].text.split("\n")[0]).toBe("1 files, 1 matches, searched 1 of 2 files");
});

test("all engine passes share one 30-second deadline", async () => {
	const realNow = Date.now;
	let now = 0;
	Date.now = () => now;
	const timeouts = [];
	try {
		const engine = async () => ({
			FileType: { File: 1 },
			async glob(options) {
				timeouts.push(options.timeoutMs);
				now += 20000;
				return { matches: [{ path: "a.ts", fileType: 1, size: 1 }] };
			},
			async grep(options) {
				timeouts.push(options.timeoutMs);
				return options.mode === "count"
					? { matches: [{ path: "a.ts", matchCount: 1 }], totalMatches: 1, filesSearched: 1 }
					: { matches: [{ path: "a.ts", line: "x" }] };
			},
		});
		await runSearch({ pattern: "x" }, { cwd: "/repo" }, { engine, threshold: 45 });
		expect(timeouts).toEqual([30000, 10000, 10000]);
	} finally {
		Date.now = realNow;
	}
});

test("a pass after the deadline is a timeout error", async () => {
	const realNow = Date.now;
	let now = 0;
	Date.now = () => now;
	try {
		const engine = async () => ({
			FileType: { File: 1 },
			async glob() {
				now += 31000;
				return { matches: [] };
			},
			async grep() {
				throw new Error("grep must not run");
			},
		});
		const result = await runSearch({ pattern: "x" }, { cwd: "/repo" }, { engine, threshold: 45 });
		expect(result.isError).toBe(true);
		expect(result.content[0].text).toContain("timed out");
	} finally {
		Date.now = realNow;
	}
});

test("a matched file over 4 MiB is named in the searched-in-part line", async () => {
	const result = await search({ pattern: "x" }, [{ path: "big.ts", size: 5 * 1024 * 1024 }, "small.ts"], {
		matches: [{ path: "big.ts", matchCount: 1 }, { path: "small.ts", matchCount: 1 }],
		totalMatches: 2,
		filesSearched: 2,
	}, { matches: [{ path: "big.ts", line: "x" }, { path: "small.ts", line: "x" }] });
	expect(result.content[0].text).toContain("searched in part (first 4 MiB): big.ts");
});

test("a long tail is folded by directory and the counts add up", () => {
	const entries = [];
	for (let dir = 0; dir < 10; dir++) for (let file = 0; file < 10; file++) entries.push({ path: `src/d${dir}/f${file}.ts`, count: 1 });
	const text = renderSearch(entries, new Map(), { matches: 100, searched: 100, total: 100, oversized: [] }, 500);
	const last = text.split("\n").at(-1);
	const match = /^\[100 files: (\d+) listed, the rest folded into (\d+) directories\]$/.exec(last);
	expect(match).not.toBeNull();
	const folded = [...text.matchAll(/src\/d\d+\/ \((\d+) files, (\d+) matches\)/g)].reduce((sum, hit) => sum + Number(hit[1]), 0);
	expect(Number(match[1]) + folded).toBe(100);
	expect(Number(match[2])).toBeGreaterThan(0);
});

test("an invalid regex is passed through literally, without a tool error", async () => {
	const capture = [];
	const result = await search({ pattern: "(" }, ["a.ts"], {
		matches: [{ path: "a.ts", matchCount: 1 }],
		totalMatches: 1,
		filesSearched: 1,
	}, { matches: [{ path: "a.ts", line: "(" }] }, { capture });
	expect(result.isError).toBeUndefined();
	expect(result.content[0].text).toContain("a.ts (1 match): (");
	expect(capture.filter(call => call.kind === "grep").every(call => call.pattern === "(")).toBe(true);
});

test("a whitespace-only pattern is a clear error", async () => {
	const capture = [];
	const result = await search({ pattern: "   " }, ["a.ts"], {
		matches: [],
		totalMatches: 0,
		filesSearched: 1,
	}, { matches: [] }, { capture });
	expect(result.isError).toBe(true);
	expect(result.content[0].text).toContain("pattern must not be empty");
	expect(capture.length).toBe(0);
});

test("zero matches gives a clear answer with K of T", async () => {
	const result = await search({ pattern: "zzz" }, ["a.ts", "b.ts"], {
		matches: [],
		totalMatches: 0,
		filesSearched: 2,
	}, { matches: [] });
	const lines = result.content[0].text.split("\n");
	expect(lines[0]).toBe("0 files, 0 matches, searched 2 of 2 files");
	expect(lines).toContain("No files matched.");
	expect(lines.at(-1)).toBe("[all 0 files listed]");
});

test("a long match line is clipped to the column budget", async () => {
	const result = await search({ pattern: "x" }, ["a.ts"], {
		matches: [{ path: "a.ts", matchCount: 1 }],
		totalMatches: 1,
		filesSearched: 1,
	}, { matches: [{ path: "a.ts", line: "x".repeat(600) }] });
	const shown = result.content[0].text.split("\n").find(line => line.startsWith("a.ts ("));
	const value = shown.slice(shown.indexOf("): ") + 3);
	expect(Buffer.byteLength(value)).toBeLessThanOrEqual(512);
	expect(value.endsWith("...")).toBe(true);
});

test("a timeout is an error, not a partial list", async () => {
	const result = await runMap({}, { cwd: "/repo" }, {
		engine: async () => {
			throw new Error("glob timed out after 30s");
		},
		threshold: 45,
	});
	expect(result.isError).toBe(true);
	expect(result.content[0].text).toContain("timed out");
	expect(result.content[0].text).not.toContain("total");
});

test("a missing engine or a missing glob function is a clear error", async () => {
	const missing = await runMap({}, { cwd: "/repo" }, {
		engine: async () => {
			throw new Error("Cannot find module '@oh-my-pi/pi-natives'");
		},
		threshold: 45,
	});
	expect(missing.isError).toBe(true);
	expect(missing.content[0].text).toContain("native engine unavailable");
	const noGlob = await runMap({}, { cwd: "/repo" }, { engine: async () => ({}), threshold: 45 });
	expect(noGlob.isError).toBe(true);
	expect(noGlob.content[0].text).toContain("no glob function");
});

test("the schema exposes path, glob, pattern, case, hidden and gitignore", () => {
	const tools = [];
	const field = () => ({ optional: () => field() });
	install({ zod: { string: field, boolean: field, object: shape => shape }, registerTool: config => tools.push(config) });
	expect(tools[0].name).toBe("files");
	expect(Object.keys(tools[0].parameters).sort()).toEqual(["case", "gitignore", "glob", "hidden", "path", "pattern"]);
	expect(tools[0].description).toBe(FILES_DESCRIPTION);
});

test("the budget is the spill threshold minus five kilobytes", () => {
	expect(mapBudget(50)).toBe(45 * 1024);
	expect(mapBudget(100)).toBe(95 * 1024);
	expect(mapBudget(undefined)).toBe(45 * 1024);
});

test("engine paths are normalized, deduplicated and sorted", () => {
	expect(normalizeFiles(["/repo/b.ts", "a.ts", "./a.ts", "src/c.ts"], "/repo")).toEqual(["a.ts", "b.ts", "src/c.ts"]);
	expect(groupByDirectory(["src/b.ts", "src/a.ts", "root.ts"]).map(group => [group.dir, group.names])).toEqual([
		["", ["root.ts"]],
		["src", ["a.ts", "b.ts"]],
	]);
});
