import { expect, test } from "bun:test";
import { inFlight } from "../../../../src/modules/file-workflow/shared/paging.js";

const { formatWriteRuns, parseWriteItems, runWriteItems, writeResult } = await import(
	"../../../../src/modules/file-workflow/tools/write/items.js"
);
const write = (await import("../../../../src/modules/file-workflow/tools/write/index.js")).default;

let registered;
write({ registerTool: (tool) => (registered = tool) });

const cwd = "/w";
const ok = (text) => ({ content: [{ type: "text", text }] });

test("parseWriteItems reads one file", () => {
	expect(parseWriteItems({ path: "a.txt", content: "x" })).toEqual({ items: [{ path: "a.txt", content: "x" }], single: true });
});

test("parseWriteItems reads several files", () => {
	const files = [{ path: "a.txt", content: "x" }];
	expect(parseWriteItems({ files })).toEqual({ items: files, single: false });
});

test("parseWriteItems lets a bare path through to the native write", () => {
	expect(parseWriteItems({ path: "local://notes.md" })).toEqual({ native: { path: "local://notes.md" } });
});

test("parseWriteItems refuses both shapes and neither", () => {
	expect(parseWriteItems({}).error).toBe("Give either path and content, or files.");
	expect(parseWriteItems({ path: "a.txt", content: "x", files: [{ path: "b.txt", content: "y" }] }).error).toBe(
		"Give either path and content, or files.",
	);
});

test("parseWriteItems keeps an empty content", () => {
	expect(parseWriteItems({ path: "a.txt", content: "" })).toEqual({ items: [{ path: "a.txt", content: "" }], single: true });
});

test("runWriteItems reports written files with their native result", async () => {
	const runs = await runWriteItems([{ path: "a.txt", content: "x" }], async () => ok("written"), cwd);
	expect(runs).toEqual([{ path: "a.txt", status: "written", text: "written", raw: { content: [{ type: "text", text: "written" }] } }]);
});

test("runWriteItems reports a native error and a thrown one", async () => {
	const failed = await runWriteItems([{ path: "a.txt", content: "x" }], async () => ({ ...ok("denied"), isError: true }), cwd);
	expect(failed[0]).toEqual({ path: "a.txt", status: "failed", message: "denied", text: "" });
	const thrown = await runWriteItems([{ path: "b.txt", content: "x" }], async () => {
		throw new Error("boom");
	}, cwd);
	expect(thrown[0]).toEqual({ path: "b.txt", status: "failed", message: "boom", text: "" });
});

test("runWriteItems refuses a file another call holds", async () => {
	inFlight.add("/w/a.txt");
	try {
		const runs = await runWriteItems([{ path: "a.txt", content: "x" }], async () => ok("never"), cwd);
		expect(runs).toEqual([{ path: "a.txt", status: "busy", text: "" }]);
	} finally {
		inFlight.delete("/w/a.txt");
	}
});

test("formatWriteRuns lists written, busy and failed files", () => {
	const runs = [
		{ path: "a.txt", status: "written", text: "ok" },
		{ path: "b.txt", status: "busy", text: "" },
		{ path: "c.txt", status: "failed", message: "denied", text: "" },
	];
	expect(formatWriteRuns(runs)).toBe(
		"Written: a.txt\n  ok\nBusy, not written (another write or edit of this file is in progress): b.txt\nFailed: c.txt: denied",
	);
});

test("writeResult hands back the native result of a single written file", () => {
	const raw = ok("native");
	expect(writeResult([{ path: "a.txt", status: "written", text: "native", raw }], true)).toBe(raw);
});

test("writeResult sums up several files", () => {
	const result = writeResult(
		[
			{ path: "a.txt", status: "written", text: "ok" },
			{ path: "b.txt", status: "failed", message: "denied", text: "" },
		],
		false,
	);
	expect(result.content).toEqual([{ type: "text", text: "Written: a.txt\n  ok\nFailed: b.txt: denied" }]);
	expect(result.details).toEqual({
		files: [
			{ path: "a.txt", status: "written" },
			{ path: "b.txt", status: "failed", message: "denied" },
		],
	});
	expect(result.isError).toBe(true);
});

test("execute writes one file and returns the native result", async () => {
	const calls = [];
	const raw = ok("native");
	const result = await registered.execute("call", { path: "a.txt", content: "x" }, undefined, undefined, {
		cwd,
		invokeTool: async (args) => (calls.push(args), raw),
	});
	expect(calls).toEqual([{ path: "a.txt", content: "x" }]);
	expect(result).toBe(raw);
});

test("execute writes several files and reports a busy one", async () => {
	const calls = [];
	inFlight.add("/w/b.txt");
	try {
		const result = await registered.execute("call", { files: [{ path: "a.txt", content: "x" }, { path: "b.txt", content: "y" }] }, undefined, undefined, {
			cwd,
			invokeTool: async (args) => (calls.push(args), ok("ok")),
		});
		expect(calls).toEqual([{ path: "a.txt", content: "x" }]);
		expect(result.content[0].text).toBe("Written: a.txt\n  ok\nBusy, not written (another write or edit of this file is in progress): b.txt");
		expect(result.isError).toBe(true);
	} finally {
		inFlight.delete("/w/b.txt");
	}
});

test("execute sends a bare path to the native write", async () => {
	const calls = [];
	await registered.execute("call", { path: "local://notes.md" }, undefined, undefined, {
		cwd,
		invokeTool: async (args) => (calls.push(args), ok("done")),
	});
	expect(calls).toEqual([{ path: "local://notes.md" }]);
});

test("execute refuses a call that gives neither shape", async () => {
	const result = await registered.execute("call", {}, undefined, undefined, { cwd, invokeTool: async () => ok("never") });
	expect(result).toEqual({ content: [{ type: "text", text: "Give either path and content, or files." }], isError: true });
});
