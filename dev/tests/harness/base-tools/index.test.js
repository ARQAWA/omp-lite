import { expect, test } from "bun:test";
import {
	FILES_DESCRIPTION,
	groupByDirectory,
	install,
	mapBudget,
	normalizeFiles,
	renderMap,
	runMap,
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

test("thousands of one-file directories still stay under the budget", () => {
	const files = [];
	for (let dir = 0; dir < 4000; dir++) files.push(`d${dir}/file.ts`);
	const budget = 45 * 1024;
	const text = renderMap(files, budget);
	expect(Buffer.byteLength(text)).toBeLessThanOrEqual(budget);
	expect(text.split("\n")[0]).toBe("total 4000 files");
	expect(text.split("\n").at(-1)).toBe("[4000 files: 0 listed, the rest folded into 1 directories]");
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

test("the schema exposes only path, glob, hidden and gitignore", () => {
	const tools = [];
	const field = () => ({ optional: () => field() });
	install({ zod: { string: field, boolean: field, object: shape => shape }, registerTool: config => tools.push(config) });
	expect(tools[0].name).toBe("files");
	expect(Object.keys(tools[0].parameters).sort()).toEqual(["gitignore", "glob", "hidden", "path"]);
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
