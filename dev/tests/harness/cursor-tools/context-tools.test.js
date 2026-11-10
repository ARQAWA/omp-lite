import { expect, test } from "bun:test";
import { mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	GLOB_DESCRIPTION,
	READ_DESCRIPTION,
	executeGlob,
	executeRead,
	globRequest,
	install,
	readRequest,
	sortByMtime,
} from "../../../../src/modules/cursor-tools/index.js";

test("glob maps the Cursor pattern and directory, keeping native fields", () => {
	expect(globRequest({ glob_pattern: "*.ts" })).toEqual({ params: { path: "**/*.ts" } });
	expect(globRequest({ glob_pattern: "src/*.js" })).toEqual({ params: { path: "**/src/*.js" } });
	for (const kept of ["**/a.ts", "/work/*.ts", "./src/*.ts", "../x/*.ts", "~/x/*.ts", "omp://tools/*.md", "a/*.ts; b/*.ts", "src", "src/a.ts"]) {
		expect(globRequest({ glob_pattern: kept })).toEqual({ params: { path: kept } });
	}
	expect(globRequest({ glob_pattern: "*.ts", target_directory: "/work/src/", hidden: false, limit: 5 })).toEqual({
		params: { path: "/work/src/**/*.ts", hidden: false, gitignore: undefined, limit: 5 },
	});
	expect(globRequest({ glob_pattern: "" }).error).toBe("glob_pattern must not be empty");
});

test("read maps Cursor offset and limit to an exact raw selector", () => {
	expect(readRequest({ path: "a.ts" })).toEqual({ params: { path: "a.ts" } });
	expect(readRequest({ path: "a.ts", offset: 10 })).toEqual({ params: { path: "a.ts:10-:raw" } });
	expect(readRequest({ path: "a.ts", offset: 10, limit: 3 })).toEqual({ params: { path: "a.ts:10-12:raw" } });
	expect(readRequest({ path: "a.ts", offset: -5 })).toEqual({ params: { path: "a.ts:-5:raw" } });
	expect(readRequest({ path: "a.ts", offset: -5, limit: 2 }).tail).toEqual({ path: "a.ts", offset: -5, limit: 2 });
	expect(readRequest({ path: "a.ts:1-3", offset: 2 }).error).toBe("path already carries a selector; drop offset and limit");
	expect(readRequest({ path: "a.ts:-5", offset: 2 }).error).toBe("path already carries a selector; drop offset and limit");
	expect(readRequest({ path: "https://example.com:8080/page", offset: 2 }).params.path).toBe("https://example.com:8080/page:2-:raw");
	expect(readRequest({ path: "a.ts:10..20", offset: 2 }).error).toBe("path already carries a selector; drop offset and limit");
	expect(readRequest({ path: "a.ts:1-3,5-10", offset: 2 }).error).toBe("path already carries a selector; drop offset and limit");
	expect(readRequest({ path: "a.ts", offset: 0 }).error).toBe("offset must be a non-zero integer");
});

test("a negative offset with a limit counts lines first, then slices", async () => {
	const seen = [];
	const ctx = {
		invokeTool: async params => {
			seen.push(params.path);
			return seen.length === 1 ? { details: { totalLines: 40 } } : { content: [{ type: "text", text: "lines" }] };
		},
	};
	const result = await executeRead("call", { path: "a.ts", offset: -5, limit: 2 }, undefined, undefined, ctx);
	expect(seen).toEqual(["a.ts:1-1:raw", "a.ts:36-37:raw"]);
	expect(result.content[0].text).toBe("lines");
});

test("xd documents support exact line windows without changing the topic", async () => {
	const tools = [];
	install({ zod: fakeZod(), registerTool: tool => tools.push(tool), on: () => {} });
	const read = tools.find(tool => tool.name === "read");
	const source = { content: [{ type: "text", text: "one\ntwo\nthree\nfour\nfive" }], details: { source: "xd" } };
	const cases = [
		[{ limit: 2 }, "one\ntwo"],
		[{ offset: 2, limit: 2 }, "two\nthree"],
		[{ offset: 4 }, "four\nfive"],
		[{ offset: -2, limit: 1 }, "four"],
		[{ offset: -2 }, "four\nfive"],
	];
	for (const [window, expected] of cases) {
		const ctx = {
			invokeTool: async params => {
				if (params.path !== "xd://eval/helpers") return { isError: true, content: [{ type: "text", text: "Unknown topic" }] };
				return source;
			},
		};
		const result = await read.execute("call", { path: "xd://eval/helpers", ...window }, undefined, undefined, ctx);
		expect(result.isError).not.toBe(true);
		expect(result.content[0].text).toBe(expected);
		expect(result.details).toEqual(source.details);
	}
	expect(source.content[0].text).toBe("one\ntwo\nthree\nfour\nfive");
});

test("xd reads keep native errors and validate windows", async () => {
	const error = { isError: true, content: [{ type: "text", text: "Unknown topic" }] };
	const result = await executeRead("call", { path: "xd://eval/missing", limit: 2 }, undefined, undefined, {
		invokeTool: async () => error,
	});
	expect(result).toBe(error);
	expect(readRequest({ path: "xd://eval/helpers", offset: 0 }).error).toBe("offset must be a non-zero integer");
	expect(readRequest({ path: "xd://eval/helpers", limit: -1 }).error).toBe("limit must be a positive integer");
});

test("the registered glob and read entries forward the mapped native call", async () => {
	const seen = [];
	const tools = [];
	install({ zod: fakeZod(), registerTool: tool => tools.push(tool), on: () => {} });
	const ctx = { invokeTool: async params => (seen.push(params), { content: [{ type: "text", text: "ok" }] }) };
	await tools.find(tool => tool.name === "glob").execute("call", { glob_pattern: "*.ts", target_directory: "/w", gitignore: false }, undefined, undefined, ctx);
	await tools.find(tool => tool.name === "read").execute("call", { path: "a.ts", offset: 3, limit: 2 }, undefined, undefined, ctx);
	expect(seen).toEqual([{ path: "/w/**/*.ts", gitignore: false }, { path: "a.ts:3-4:raw" }]);
});

test("glob and read carry the captured Cursor texts under our names", () => {
	expect(GLOB_DESCRIPTION.startsWith("Tool to search for files matching a glob pattern")).toBe(true);
	expect(GLOB_DESCRIPTION).toContain("sorted by modification time");
	expect(GLOB_DESCRIPTION).toContain("Minimize agent turns. Batch all necessary, independent searches per response. Never search unrelated paths to fill batches.");
	expect(GLOB_DESCRIPTION.includes("speculatively")).toBe(false);
	expect(READ_DESCRIPTION.startsWith("Reads a file from the local filesystem.")).toBe(true);
	expect(READ_DESCRIPTION).toContain("PDF files are converted into text content automatically");
	expect(READ_DESCRIPTION).toContain("Supported image formats: jpeg/jpg, png, gif, webp.");
	expect(READ_DESCRIPTION).toContain("Minimize agent turns. Batch all necessary, independent reads per response. Reuse available, unchanged content instead of rereading.");
	expect(READ_DESCRIPTION.includes("speculatively")).toBe(false);
});

function fakeZod() {
	const leaf = () => {
		const node = { optional: () => node, describe: () => node };
		return node;
	};
	return { string: leaf, number: leaf, boolean: leaf, object: () => leaf() };
}

test("glob returns host paths newest first", async () => {
	const dir = mkdtempSync(join(tmpdir(), "glob-mtime-"));
	try {
		const older = join(dir, "older.ts");
		const newer = join(dir, "newer.ts");
		writeFileSync(older, "a");
		writeFileSync(newer, "b");
		utimesSync(older, 1000, 1000);
		utimesSync(newer, 2000, 2000);
		expect(sortByMtime([older, newer])).toEqual([newer, older]);
		expect(sortByMtime(["older.ts", "newer.ts"], dir)).toEqual(["newer.ts", "older.ts"]);
		const tools = [];
		install({ zod: fakeZod(), registerTool: tool => tools.push(tool), on: () => {} });
		const ctx = { cwd: dir, invokeTool: async () => ({ details: { files: ["older.ts", "newer.ts"] }, content: [{ type: "text", text: "older.ts\nnewer.ts" }] }) };
		const result = await tools.find(tool => tool.name === "glob").execute("call", { glob_pattern: "*.ts" }, undefined, undefined, ctx);
		expect(result.content[0].text.split("\n")).toEqual(["newer.ts", "older.ts"]);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("glob keeps native notices and leaves oversized bodies alone", async () => {
	const dir = mkdtempSync(join(tmpdir(), "glob-notes-"));
	try {
		const first = join(dir, "a.ts");
		const second = join(dir, "[b].ts");
		writeFileSync(first, "a");
		writeFileSync(second, "b");
		utimesSync(first, 1000, 1000);
		utimesSync(second, 2000, 2000);
		const notices = "# dir/\n[b].ts\na.ts\nRequested limit 500 clamped to the max of 200\nScan incomplete, NOT proof of absence";
		const ctx = {
			cwd: dir,
			invokeTool: async () => ({ details: { files: [first, second] }, content: [{ type: "text", text: notices }] }),
		};
		const result = await executeGlob("call", { glob_pattern: "*.ts", target_directory: dir }, undefined, undefined, ctx);
		expect(result.content[0].text).toBe(
			`${second}\n${first}\nRequested limit 500 clamped to the max of 200\nScan incomplete, NOT proof of absence`,
		);
		const huge = { cwd: "/", invokeTool: async () => ({ details: { files: ["/a", "/b"].fill("/x".repeat(40000)) }, content: [{ type: "text", text: "native body" }] }) };
		const kept = await executeGlob("call", { glob_pattern: "*.ts" }, undefined, undefined, huge);
		expect(kept.content[0].text).toBe("native body");
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("a notice identical to a filename survives while other files exist", async () => {
	const dir = mkdtempSync(join(tmpdir(), "glob-name-"));
	try {
		const notice = "Requested limit 500 clamped to the max of 200";
		writeFileSync(join(dir, notice), "a");
		writeFileSync(join(dir, "b.ts"), "b");
		const ctx = {
			cwd: dir,
			invokeTool: async () => ({ details: { files: [notice, "b.ts"] }, content: [{ type: "text", text: `${notice}\n${notice}\nb.ts` }] }),
		};
		const result = await executeGlob("call", { glob_pattern: "*" }, undefined, undefined, ctx);
		const lines = result.content[0].text.split("\n");
		expect(lines.filter(line => line === notice)).toHaveLength(2);
		expect(lines.filter(line => line === "b.ts")).toHaveLength(1);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("a filename matching a notice prefix stays a single path", async () => {
	const dir = mkdtempSync(join(tmpdir(), "glob-prefix-"));
	try {
		const name = "Requested limit 500.ts";
		writeFileSync(join(dir, name), "a");
		writeFileSync(join(dir, "b.ts"), "b");
		const notice = "Requested limit 500 clamped to the max of 200";
		const ctx = {
			cwd: dir,
			invokeTool: async () => ({ details: { files: [name, "b.ts"] }, content: [{ type: "text", text: `${name}\nb.ts\n${notice}` }] }),
		};
		const result = await executeGlob("call", { glob_pattern: "*.ts" }, undefined, undefined, ctx);
		const lines = result.content[0].text.split("\n");
		expect(lines.filter(line => line === name)).toHaveLength(1);
		expect(lines.filter(line => line === notice)).toHaveLength(1);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});
