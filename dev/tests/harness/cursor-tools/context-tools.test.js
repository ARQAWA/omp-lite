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
	expect(globRequest({ glob_pattern: "*.ts" })).toEqual({ params: { path: "*.ts" } });
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
	expect(READ_DESCRIPTION.startsWith("Reads a file from the local filesystem.")).toBe(true);
	expect(READ_DESCRIPTION).toContain("PDF files are converted into text content automatically");
	expect(READ_DESCRIPTION).toContain("Supported image formats: jpeg/jpg, png, gif, webp.");
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
		const ctx = { cwd: dir, invokeTool: async () => ({ details: { files: [older, newer] }, content: [{ type: "text", text: "# dir/\nolder.ts\nnewer.ts" }] }) };
		const result = await tools.find(tool => tool.name === "glob").execute("call", { glob_pattern: "*.ts", target_directory: dir }, undefined, undefined, ctx);
		expect(result.content[0].text.split("\n")).toEqual([newer, older]);
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
		const notices = "# dir/\n[b].ts\na.ts\nRequested limit 500 clamped to the max of 200";
		const ctx = {
			cwd: dir,
			invokeTool: async () => ({ details: { files: [first, second] }, content: [{ type: "text", text: notices }] }),
		};
		const result = await executeGlob("call", { glob_pattern: "*.ts", target_directory: dir }, undefined, undefined, ctx);
		expect(result.content[0].text).toBe(`${second}\n${first}\nRequested limit 500 clamped to the max of 200`);
		const huge = { cwd: "/", invokeTool: async () => ({ details: { files: ["/a", "/b"].fill("/x".repeat(40000)) }, content: [{ type: "text", text: "native body" }] }) };
		const kept = await executeGlob("call", { glob_pattern: "*.ts" }, undefined, undefined, huge);
		expect(kept.content[0].text).toBe("native body");
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});
