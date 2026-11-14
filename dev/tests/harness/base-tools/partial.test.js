import { expect, test } from "bun:test";
import { resolve } from "node:path";
import { install, partialPatch, splitPatch } from "../../../../src/modules/base-tools/index.js";
import texts from "../../../../src/modules/base-tools/base-tools.texts.json";

const patch = (...sections) => `*** Begin Patch\n${sections.join("\n")}\n*** End Patch\n`;
const a = "*** Update File: a.txt\n@@\n-old a\n+new a";
const b = "*** Update File: b.txt\n@@\n-WRONG\n+new b";
const c = "*** Add File: c.txt\n+new c";
const d = "*** Update File: d.txt\n@@\n-WRONG\n+new d";
const a2 = "*** Update File: a.txt\n@@\n-tail\n+end";
const b2 = "*** Update File: b.txt\n@@\n-WRONG too\n+later";
// Stands in for the native engine: a patch that touches a bad file fails as a whole.
const dry = (bad, calls = []) => async input => {
	calls.push(input);
	const hit = bad.find(path => input.includes(`File: ${path}`));
	return hit ? { isError: true, text: `Failed to find expected lines in ${hit}` } : { isError: false, text: "ok" };
};

test("a patch splits into file sections in order", () => {
	expect(splitPatch(patch(a, b, a2)).map(section => section.path)).toEqual(["a.txt", "b.txt", "a.txt"]);
	expect(splitPatch("[a.txt#AB12]\nPUT 1.=1:\n+x")).toBeUndefined();
	expect(splitPatch(patch("stray line", a))).toBeUndefined();
});

test("a failing file is left out whole, every section of it is kept as sent", async () => {
	const result = await partialPatch(patch(a, b, c, a2, b2), dry(["b.txt"]));
	expect(result.input).toBe(patch(a, c, a2));
	expect(result.skipped).toEqual([{ path: "b.txt", reason: "Failed to find expected lines in b.txt", patch: `${b}\n${b2}` }]);
});

test("a patch that fits whole is not touched and costs one dry run", async () => {
	const calls = [];
	expect(await partialPatch(patch(a, b, c), dry([], calls))).toBeUndefined();
	expect(calls).toHaveLength(1);
});

test("one file, every file failing, and URL targets stay with the native edit", async () => {
	const calls = [];
	expect(await partialPatch(patch(a, a2), dry(["a.txt"], calls))).toBeUndefined();
	expect(calls).toHaveLength(0);
	expect(await partialPatch(patch(a, b), dry(["a.txt", "b.txt"]))).toBeUndefined();
	expect(await partialPatch(patch(a, b, "*** Add File: local://c.txt\n+x"), dry(["b.txt"], calls))).toBeUndefined();
	expect(calls).toHaveLength(0);
});

const hooks = dryRun => {
	const handlers = {};
	const optional = { optional: () => undefined };
	install(
		{ zod: { object: () => ({}), string: () => optional, boolean: () => optional }, on: (name, handler) => (handlers[name] = handler), registerTool() {} },
		{ dry: dryRun },
	);
	return handlers;
};
const ctx = { cwd: "/work" };
const call = (toolName, input, toolCallId = "one") => ({ toolName, toolCallId, input: { input } });
const result = (toolCallId, extra) => ({ toolName: "edit", toolCallId, isError: false, content: [{ type: "text", text: "Success." }], ...extra });
const reasonOf = name => `Failed to find expected lines in ${name}.txt`;
const section = (name, text) => `[${name}.txt]: ${reasonOf(name)}\n${texts.skipped.section}\n${text}`;
const failed = name => ({ path: resolve("/work", `${name}.txt`), diff: "", isError: true, errorText: reasonOf(name) });

test("several files written: the result is an error, the note keeps the removed sections, every skipped file gets a red entry", async () => {
	const handlers = hooks(dry(["b.txt", "d.txt"]));
	const done = [{ path: "/work/a.txt", diff: "+new a" }, { path: "/work/c.txt", diff: "+new c" }];
	for (const name of ["edit", "apply_patch"]) {
		expect(await handlers.tool_call(call(name, patch(a, b, c, d)), ctx)).toEqual({ input: { input: patch(a, c) } });
		const native = result("one", { details: { diff: "native diff", firstChangedLine: 3, perFileResults: done } });
		expect(handlers.tool_result(native)).toEqual({
			isError: true,
			content: [{ type: "text", text: [texts.skipped.head, section("b", b), section("d", d), texts.skipped.tail].join("\n") }, ...native.content],
			details: { diff: "native diff", firstChangedLine: 3, perFileResults: [...done, failed("b"), failed("d")] },
		});
		expect(handlers.tool_result(result("one"))).toBeUndefined();
	}
});

test("one file written: its own details become the first entry", async () => {
	const handlers = hooks(dry(["b.txt"]));
	await handlers.tool_call(call("edit", patch(a, b)), ctx);
	const one = { diff: "native diff", firstChangedLine: 1, path: "/work/a.txt", op: "update" };
	expect(handlers.tool_result(result("one", { details: one })).details).toEqual({
		diff: "native diff",
		firstChangedLine: 1,
		perFileResults: [one, failed("b")],
	});
});

test("a native failure keeps its own error and details, the note is still first", async () => {
	const handlers = hooks(dry(["b.txt"]));
	await handlers.tool_call(call("edit", patch(a, b)), ctx);
	const native = result("one", { isError: true, content: [{ type: "text", text: "boom" }], details: { diff: "", errorKind: "parse" } });
	expect(handlers.tool_result(native)).toStrictEqual({
		content: [{ type: "text", text: [texts.skipped.head, section("b", b), texts.skipped.tail].join("\n") }, ...native.content],
	});
});

test("a success without details still reports the skipped file; other cases change nothing", async () => {
	const handlers = hooks(dry(["b.txt"]));
	expect(await handlers.tool_call(call("write", patch(a, b)), ctx)).toBeUndefined();
	expect(await handlers.tool_call(call("edit", patch(a, c)), ctx)).toBeUndefined();
	await handlers.tool_call(call("edit", patch(a, b), "two"), ctx);
	expect(handlers.tool_result(result("two")).details.perFileResults).toEqual([failed("b")]);
	const broken = hooks(async () => {
		throw new Error("engine changed");
	});
	expect(await broken.tool_call(call("edit", patch(a, b)), ctx)).toBeUndefined();
	expect(broken.tool_result(result("one"))).toBeUndefined();
});
