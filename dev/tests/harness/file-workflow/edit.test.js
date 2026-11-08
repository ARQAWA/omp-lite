import { afterAll, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { registry } from "./stubs.js";

const REPLACE_TEXT = readFileSync(new URL("../../../../src/modules/file-workflow/tools/edit/description.md", import.meta.url), "utf8").trim();

const { chooseEditMode, cleanParams, replaceItems } = await import("../../../../src/modules/file-workflow/tools/edit/args.js");
const { formatPatchRuns, groupPatchSections, lineSimilarity, nearestMatchText, parsePatch, splitFileLines } = await import(
	"../../../../src/modules/file-workflow/tools/edit/patch.js"
);
const { inFlight, lockKey } = await import("../../../../src/modules/file-workflow/shared/paging.js");
const edit = (await import("../../../../src/modules/file-workflow/tools/edit/index.js")).default;

const field = (type) => ({ type, optional: () => field(type) });
const zod = {
	object: (shape) => ({ type: "object", shape }),
	string: () => field("string"),
	boolean: () => field("boolean"),
	array: (item) => field("array"),
};

const handlers = {};
let registered;
const pi = { zod, registerTool: (tool) => (registered = tool), on: (name, fn) => (handlers[name] = fn), pi: { settings: {} } };
edit(pi);

const dir = mkdtempSync(join(tmpdir(), "file-workflow-edit-"));
writeFileSync(join(dir, "a.txt"), "hello world\nsecond line\n");
afterAll(() => rmSync(dir, { recursive: true, force: true }));

let calls;
const ctx = (invoke) => ({ cwd: dir, invokeTool: (args) => (calls.push(args), invoke(args)), models: { current: () => ({ id: "claude-opus-5" }) } });
const execute = (params, invoke) => registered.execute("call", params, undefined, undefined, ctx(invoke));
const ok = (text) => ({ content: [{ type: "text", text }] });

test("cleanParams drops the empty fields GPT sends", () => {
	expect(cleanParams({ path: "", old_string: "", new_string: "x" })).toEqual({ new_string: "x" });
	expect(cleanParams({ path: "a", old_string: "x", new_string: "", edits: [] })).toEqual({ path: "a", old_string: "x", new_string: "" });
});

test("chooseEditMode gives GPT the patch mode", () => {
	expect([chooseEditMode({ id: "gpt-5.2-codex" }), chooseEditMode("GPT-6"), chooseEditMode({ id: "claude-opus-5" })]).toEqual([
		"apply_patch",
		"apply_patch",
		"replace",
	]);
	expect([chooseEditMode(undefined), chooseEditMode(""), chooseEditMode({})]).toEqual(["replace", "replace", "replace"]);
});

test("replaceItems takes one replacement", () => {
	expect(replaceItems({ path: "a", old_string: "x", new_string: "y", replace_all: true })).toEqual({
		items: [{ path: "a", old_string: "x", new_string: "y", replace_all: true }],
		single: true,
	});
});

test("replaceItems takes the edits array", () => {
	const edits = [{ path: "a", old_string: "x", new_string: "y" }];
	expect(replaceItems({ edits })).toEqual({ items: edits, single: false });
});

test("replaceItems refuses both shapes and neither", () => {
	expect(replaceItems({}).error).toBe("Give either path, old_string and new_string, or edits.");
	expect(replaceItems({ path: "a", old_string: "x", new_string: "y", edits: [{ path: "b", old_string: "x", new_string: "y" }] }).error).toBe(
		"Give either path, old_string and new_string, or edits.",
	);
});

test("parsePatch reads add, update and delete sections", () => {
	const sections = parsePatch(
		["*** Begin Patch", "*** Add File: new.txt", "+one", "*** Update File: a.txt", "@@", "-x", "+y", "*** Delete File: gone.txt", "*** End Patch"].join("\n"),
	);
	expect(sections.map((section) => [section.path, section.kind])).toEqual([
		["new.txt", "add"],
		["a.txt", "update"],
		["gone.txt", "delete"],
	]);
	expect(sections[1].hunks).toEqual([["@@", "-x", "+y"]]);
});

test("parsePatch reads a move", () => {
	const sections = parsePatch(["*** Begin Patch", "*** Update File: a.txt", "*** Move to: b.txt", "@@", "-x", "+y", "*** End Patch"].join("\n"));
	expect([sections[0].move, sections[0].path]).toEqual([true, "a.txt"]);
});

test("parsePatch refuses a broken envelope and a broken header", () => {
	expect(parsePatch("*** Update File: a\n")).toBeUndefined();
	expect(parsePatch(["*** Begin Patch", "*** Update File: a", "*** Oops", "*** End Patch"].join("\n"))).toBeUndefined();
});

test("splitFileLines drops a BOM, the CR and the empty last line", () => {
	expect(splitFileLines("\ufeffa\r\nb\r\n")).toEqual(["a", "b"]);
	expect([splitFileLines(""), splitFileLines("a\nb")]).toEqual([[], ["a", "b"]]);
});

test("lineSimilarity runs from 0 to 1", () => {
	expect([lineSimilarity("abc", "abc"), lineSimilarity("", ""), lineSimilarity("abc", "xyz"), lineSimilarity("ab", "")]).toEqual([1, 1, 0, 0]);
	expect(lineSimilarity("abcd", "abxy")).toBe(0.5);
});

test("nearestMatchText returns undefined when the file cannot be read", () => {
	expect(nearestMatchText("gone.txt", "x", dir)).toBeUndefined();
	expect(nearestMatchText("a.txt", "", dir)).toBeUndefined();
});

test("nearestMatchText shows the closest block with line numbers", () => {
	expect(nearestMatchText("a.txt", "hello  world\nsecond line", dir)).toBe("Nearest match in a.txt (lines 1-2):\n1|hello world\n2|second line");
});

test("groupPatchSections groups by file", () => {
	const sections = parsePatch(
		["*** Begin Patch", "*** Update File: a.txt", "@@", "-x", "+y", "*** Update File: b.txt", "@@", "-x", "+y", "*** Update File: a.txt", "@@", "-x", "+y", "*** End Patch"].join("\n"),
	);
	const groups = groupPatchSections(sections, "/w");
	expect([...groups.keys()]).toEqual(["/w/a.txt", "/w/b.txt"]);
	expect(groups.get("/w/a.txt").length).toBe(2);
});

test("formatPatchRuns lists applied, busy and failed files", () => {
	const runs = [
		{ path: "a.txt", status: "edited", applied: 1, total: 1, results: [ok("M a.txt")], appliedHunks: [], rejections: [] },
		{ path: "b.txt", status: "busy", applied: 0, total: 1, results: [], appliedHunks: [], rejections: [] },
		{ path: "c.txt", status: "failed", applied: 0, total: 1, results: [], appliedHunks: [], rejections: [], failure: "no match" },
	];
	expect(formatPatchRuns(runs)).toBe(
		"Applied: a.txt (1 hunk(s))\n  M a.txt\nBusy, not edited (another write or edit of this file is in progress): b.txt\nRejected: c.txt: no match\nApplied 1 of 3 hunks; rejected 2.",
	);
});

test("formatPatchRuns names the hunks of a partial patch", () => {
	const runs = [
		{
			path: "a.txt",
			status: "partial",
			applied: 1,
			total: 2,
			results: [ok("M a.txt")],
			appliedHunks: [1],
			rejections: [{ index: 2, total: 2, text: "no match", lines: [] }],
		},
	];
	expect(formatPatchRuns(runs)).toBe("Applied: a.txt (hunks 1 of 2)\n  M a.txt\nRejected: a.txt, hunk 2 of 2:\nno match\nApplied 1 of 2 hunks; rejected 1.");
});

test("execute applies a whole patch in one native call", async () => {
	calls = [];
	const input = ["*** Begin Patch", "*** Update File: a.txt", "@@", "-x", "+y", "*** End Patch"].join("\n");
	const result = await execute({ input }, () => ({ content: [{ type: "text", text: "M a.txt" }], details: { diff: "@@ diff @@" } }));
	expect(calls).toEqual([{ input }]);
	expect(result.content[0].text).toBe("Applied: a.txt (1 hunk(s))\n  M a.txt");
	expect([result.details.diff, result.isError]).toEqual(["@@ diff @@", false]);
});

test("execute retries the hunks of a rejected patch one by one", async () => {
	calls = [];
	const input = ["*** Begin Patch", "*** Update File: a.txt", "@@", "-x", "+y", "@@", "-p", "+q", "*** End Patch"].join("\n");
	let call = 0;
	const result = await execute({ input }, () => {
		call++;
		if (call === 1) return { content: [{ type: "text", text: "no match" }], isError: true };
		return call === 2 ? ok("M a.txt") : { content: [{ type: "text", text: "no match" }], isError: true };
	});
	expect(calls.length).toBe(3);
	expect(result.content[0].text).toContain("Applied: a.txt (hunks 1 of 2)");
	expect(result.content[0].text).toContain("Rejected: a.txt, hunk 2 of 2:");
	expect(result.isError).toBe(true);
});

test("execute hands an unparsable patch to the native edit unchanged", async () => {
	calls = [];
	const result = await execute({ input: "not a patch" }, () => ok("native"));
	expect(calls).toEqual([{ input: "not a patch" }]);
	expect(result).toEqual({ content: [{ type: "text", text: "native" }] });
});

test("execute replaces one piece of text and returns the native result", async () => {
	calls = [];
	const result = await execute({ path: "a.txt", old_string: "hello", new_string: "bye" }, () => ok("1 replacement"));
	expect(calls).toEqual([{ path: "a.txt", old_string: "hello", new_string: "bye" }]);
	expect(result).toEqual({ content: [{ type: "text", text: "1 replacement" }] });
});

test("execute reports a busy file without editing it", async () => {
	calls = [];
	inFlight.add(lockKey("a.txt", dir));
	try {
		const result = await execute({ path: "a.txt", old_string: "hello", new_string: "bye" }, () => ok("never"));
		expect(result).toEqual({
			content: [{ type: "text", text: "Busy, not edited (another write or edit of this file is in progress): a.txt" }],
			isError: true,
		});
		expect(calls).toEqual([]);
	} finally {
		inFlight.delete(lockKey("a.txt", dir));
	}
});

test("execute shows the nearest match when a replacement fails", async () => {
	calls = [];
	const result = await execute({ path: "a.txt", old_string: "hello  world", new_string: "bye" }, () => ({
		content: [{ type: "text", text: "No match found" }],
		isError: true,
	}));
	expect(result.isError).toBe(true);
	expect(result.content[0].text).toBe("No match found\nNearest match in a.txt (lines 1-1):\n1|hello world");
});

test("execute applies several edits of several files", async () => {
	calls = [];
	const edits = [
		{ path: "a.txt", old_string: "hello", new_string: "bye" },
		{ path: "b.txt", old_string: "x", new_string: "y" },
	];
	const result = await execute({ edits }, () => ok("1 replacement"));
	expect(calls.length).toBe(2);
	expect(result.content[0].text).toBe("Edited: a.txt (1 replacement(s))\n  1 replacement\nEdited: b.txt (1 replacement(s))\n  1 replacement");
	expect(result.isError).toBe(false);
});

test("execute refuses a call that gives neither shape", async () => {
	const result = await execute({ path: "a.txt" }, () => ok("never"));
	expect(result).toEqual({
		content: [{ type: "text", text: "Give either path, old_string and new_string, or edits." }],
		isError: true,
	});
});

test("the session start hook sets the native mode for both families", () => {
	registry.length = 0;
	handlers.session_start({}, { models: { current: () => ({ id: "gpt-5.2" }) } });
	expect(registered.description).toBe("edit description apply_patch");
	expect(registered.customWireName).toBe("apply_patch");
	expect(registered.customFormat).toEqual({ syntax: "lark", definition: "edit grammar apply_patch" });
	handlers.turn_start({}, { models: { current: () => ({ id: "claude-opus-5" }) } });
	expect(registered.description).toBe(REPLACE_TEXT);
	expect(registry).toEqual([
		["edit.mode", "replace"],
		["edit.modelVariants", { gpt: "apply_patch" }],
	]);
	expect(registered.customWireName).toBeUndefined();
});
