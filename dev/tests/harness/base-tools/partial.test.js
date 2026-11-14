import { expect, test } from "bun:test";
import { install, partialPatch, splitPatch } from "../../../../src/modules/base-tools/index.js";
import texts from "../../../../src/modules/base-tools/base-tools.texts.json";

const patch = (...sections) => `*** Begin Patch\n${sections.join("\n")}\n*** End Patch\n`;
const a = "*** Update File: a.txt\n@@\n-old a\n+new a";
const b = "*** Update File: b.txt\n@@\n-WRONG\n+new b";
const c = "*** Add File: c.txt\n+new c";
const a2 = "*** Update File: a.txt\n@@\n-tail\n+end";
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

test("a file that fails the dry run is left out, the others keep their order", async () => {
	const result = await partialPatch(patch(a, b, c, a2), dry(["b.txt"]));
	expect(result.input).toBe(patch(a, c, a2));
	expect(result.failed).toEqual(["[b.txt]: Failed to find expected lines in b.txt"]);
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
const call = (toolName, input, toolCallId = "one") => ({ toolName, toolCallId, input: { input } });

test("the hooks revise the edit input and report the skipped file", async () => {
	const handlers = hooks(dry(["b.txt"]));
	for (const name of ["edit", "apply_patch"]) {
		expect(await handlers.tool_call(call(name, patch(a, b, c)), {})).toEqual({ input: { input: patch(a, c) } });
		const result = handlers.tool_result({ toolName: "edit", toolCallId: "one", isError: false, content: [{ type: "text", text: "Success." }] });
		expect(result.content.map(part => part.text)).toEqual([
			`${texts.skipped.head}\n[b.txt]: Failed to find expected lines in b.txt\n${texts.skipped.tail}`,
			"Success.",
		]);
		expect(handlers.tool_result({ toolName: "edit", toolCallId: "one", isError: false, content: [] })).toBeUndefined();
	}
});

test("other tools, whole patches, a failed edit and a broken dry run change nothing", async () => {
	const handlers = hooks(dry(["b.txt"]));
	expect(await handlers.tool_call(call("write", patch(a, b)), {})).toBeUndefined();
	expect(await handlers.tool_call(call("edit", patch(a, c)), {})).toBeUndefined();
	await handlers.tool_call(call("edit", patch(a, b), "two"), {});
	expect(handlers.tool_result({ toolName: "edit", toolCallId: "two", isError: true, content: [{ type: "text", text: "boom" }] })).toBeUndefined();
	const broken = hooks(async () => {
		throw new Error("engine changed");
	});
	expect(await broken.tool_call(call("edit", patch(a, b)), {})).toBeUndefined();
});
