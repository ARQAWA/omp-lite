import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import baseTools, { checkEngine, checkReference, rewritePayload, warnOnce } from "../../../../src/modules/base-tools/index.js";
import reference from "../../../../src/modules/base-tools/base-tools.reference.json";
import texts from "../../../../src/modules/base-tools/base-tools.texts.json";

const natives = JSON.parse(readFileSync(join(import.meta.dir, "native-tools.json"), "utf8"));
const live = JSON.parse(readFileSync(join(import.meta.dir, "native-live.json"), "utf8"));
const schema = name => structuredClone(natives.find(tool => tool.name === name).parameters);
const mainPayload = () => ({ tools: structuredClone(live.main) });
const childPayload = () => ({ tools: structuredClone(live.child) });

test("native main and child tools equal the reference", () => {
	expect(checkReference(mainPayload(), reference.settings)).toBeUndefined();
	expect(checkReference(childPayload(), reference.settings, "child")).toBeUndefined();
});

test("both edit schemas are accepted", () => {
	const payload = mainPayload();
	const edit = payload.tools.find(tool => tool.name === "apply_patch");
	Object.assign(edit, { type: "function", name: "edit", format: undefined, parameters: schema("edit") });
	expect(checkReference(payload, reference.settings)).toBeUndefined();
});

test("a child without edit is not a mismatch", () => {
	const payload = childPayload();
	payload.tools = payload.tools.filter(tool => tool.name !== "apply_patch");
	expect(checkReference(payload, reference.settings, "child")).toBeUndefined();
});

test("the engine exports used by files are present", async () => {
	expect(await checkEngine(async () => ({ glob() {}, grep() {}, FileType: {} }))).toBeUndefined();
	expect(await checkEngine(async () => ({ glob: 1, grep() {}, FileType: {} }))).toBe("base-tools: engine glob changed");
});

test("a changed description names its tool", () => {
	const payload = mainPayload();
	payload.tools.find(tool => tool.name === "grep").description += " changed";
	expect(checkReference(payload, reference.settings)).toBe("base-tools: native grep changed description");
});

test("changed fields name their tool", () => {
	const payload = mainPayload();
	payload.tools.find(tool => tool.name === "bash").parameters.properties.extra = { type: "string" };
	expect(checkReference(payload, reference.settings)).toBe("base-tools: native bash changed fields");
});

test("a changed setting names its key", () => {
	expect(checkReference(mainPayload(), { ...reference.settings, "tools.artifactSpillThreshold": 50 })).toBe(
		"base-tools: setting tools.artifactSpillThreshold changed",
	);
});

test("only the first mismatch in a session warns", () => {
	const state = { warned: false };
	const seen = [];
	expect(warnOnce("base-tools: native grep changed description", state, message => seen.push(message))).toBe(true);
	expect(warnOnce("base-tools: setting edit.mode changed", state, message => seen.push(message))).toBe(false);
	expect(seen).toEqual(["base-tools: native grep changed description"]);
});

test("our text is still applied on a mismatch", () => {
	const payload = mainPayload();
	payload.tools.find(tool => tool.name === "grep").description = "native changed";
	expect(checkReference(payload, reference.settings)).toContain("grep");
	rewritePayload(payload, true);
	expect(payload.tools.find(tool => tool.name === "grep").description).toBe(texts.grep.withFiles);
	expect(payload.tools.find(tool => tool.name === "apply_patch").description).toBe(texts.edit);
	expect(JSON.stringify(payload)).not.toContain("base-tools:");
});

test("the hook warns once through the module entry", async () => {
	const handlers = {};
	const optional = { optional: () => undefined };
	const pi = {
		zod: { object: () => ({}), string: () => optional, boolean: () => optional },
		on: (name, handler) => (handlers[name] = handler),
		registerTool: () => {},
	};
	baseTools(pi);
	const seen = [];
	const ctx = { agent: { kind: "main" }, ui: { notify: message => seen.push(message) } };
	await handlers.before_provider_request({ payload: { messages: [] } }, ctx);
	expect(seen).toHaveLength(0);
	const first = mainPayload();
	first.tools.find(tool => tool.name === "grep").description = "changed";
	await handlers.before_provider_request({ payload: first }, ctx);
	expect(seen).toHaveLength(1);
	expect(seen[0]).toContain("grep");
	expect(JSON.stringify(first)).not.toContain("base-tools:");
	const second = mainPayload();
	second.tools.find(tool => tool.name === "bash").description = "changed";
	await handlers.before_provider_request({ payload: second }, ctx);
	expect(seen).toHaveLength(1);
	const next = mainPayload();
	next.tools.find(tool => tool.name === "grep").description = "changed";
	await handlers.before_provider_request({ payload: next }, { ...ctx, sessionManager: { getSessionId: () => "new" } });
	expect(seen).toHaveLength(2);
});
