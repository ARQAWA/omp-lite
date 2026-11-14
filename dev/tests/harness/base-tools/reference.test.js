import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import baseTools, { checkEngine, checkReference, rewritePayload, warnOnce } from "../../../../src/modules/base-tools/index.js";
import reference from "../../../../src/modules/base-tools/base-tools.reference.json";
import texts from "../../../../src/modules/base-tools/base-tools.texts.json";

const natives = JSON.parse(readFileSync(join(import.meta.dir, "native-tools.json"), "utf8"));
const mainTask = JSON.parse(readFileSync(join(import.meta.dir, "native-main-task.json"), "utf8")).tools;
const mainNoTask = JSON.parse(readFileSync(join(import.meta.dir, "native-main-notask.json"), "utf8")).tools;
const realChild = JSON.parse(readFileSync(join(import.meta.dir, "native-child.json"), "utf8")).tools;
const schema = name => structuredClone(natives.find(tool => tool.name === name).parameters);
const flat = list => list.map(tool => tool.function ?? tool);
const mainPayload = () => ({ tools: flat(structuredClone(mainTask)) });
const childPayload = () => ({ tools: flat(structuredClone(realChild)) });

test("native main and child tools equal the reference", () => {
	expect(checkReference(mainPayload(), reference.settings)).toBeUndefined();
	expect(checkReference({ tools: flat(structuredClone(mainNoTask)) }, reference.settings)).toBeUndefined();
	expect(checkReference(childPayload(), reference.settings, "child")).toBeUndefined();
});

test("both edit schemas are accepted", () => {
	const payload = mainPayload();
	const edit = payload.tools.find(tool => ["edit", "apply_patch"].includes(tool.name));
	Object.assign(edit, { type: "function", name: "edit", format: undefined, parameters: schema("edit") });
	expect(checkReference(payload, reference.settings)).toBeUndefined();
});

test("a child without edit is not a mismatch", () => {
	const payload = childPayload();
	payload.tools = payload.tools.filter(tool => !["edit", "apply_patch"].includes(tool.name));
	expect(checkReference(payload, reference.settings, "child")).toBeUndefined();
});

test("the engine exports used by files are present", async () => {
	const engine = { glob() {}, grep() {}, FileType: {}, EditSession() {}, EditStore() {} };
	expect(await checkEngine(async () => engine)).toBeUndefined();
	expect(await checkEngine(async () => ({ ...engine, glob: 1 }))).toBe("base-tools: engine glob changed");
	expect(await checkEngine(async () => ({ ...engine, EditSession: undefined }))).toBe("base-tools: engine EditSession changed");
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
	payload.tools.push({
		type: "custom",
		name: "apply_patch",
		description: reference.main.edit.description,
		format: Object.fromEntries(reference.main.edit.fields.map(field => [field, ""])),
	});
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

test("the Windows line of native bash is not a mismatch", () => {
	const windows = "Windows host, emulated bash environment: write bash, NEVER cmd/PowerShell syntax (run PowerShell as `powershell -c '…'`): `$TEMP` not `%TEMP%`, `&&`/`;` not `&` (it backgrounds), no `dir`/`copy`/`set X=`; paths `C:/x` or `/c/x`; `find`/`sort`/`timeout` are GNU.";
	const payload = mainPayload();
	const bash = payload.tools.find(tool => tool.name === "bash");
	bash.description = bash.description.replace("\n\n", "\n" + windows + "\n");
	expect(bash.description).toContain(windows);
	expect(checkReference(payload, reference.settings)).toBeUndefined();
	bash.description = bash.description.replace("Windows host", "Linux host");
	expect(checkReference(payload, reference.settings)).toBe("base-tools: native bash changed description");
});

test("our bash text keeps the native Windows line and is unchanged without it", () => {
	const windows = "Windows host, emulated bash environment: write bash, NEVER cmd/PowerShell syntax; paths `C:/x` or `/c/x`.";
	const shell = "Persistent shell: one fact command/pipeline; dependencies use `&&`.\n";
	for (const hasFiles of [true, false]) {
		const ours = hasFiles ? texts.bash.withFiles : texts.bash.withoutFiles;
		const mac = mainPayload();
		rewritePayload(mac, hasFiles);
		expect(mac.tools.find(tool => tool.name === "bash").description).toBe(ours);
		const win = mainPayload();
		const bash = win.tools.find(tool => tool.name === "bash");
		bash.description = bash.description.replace("\n\n", "\n" + windows + "\n");
		rewritePayload(win, hasFiles);
		expect(bash.description).toBe(ours.replace(shell, shell + windows + "\n"));
		expect(bash.description).toContain(shell + windows + "\nScripts/heredocs");
		// A second pass over the same payload does not add the line twice.
		rewritePayload(win, hasFiles);
		expect(bash.description.split(windows).length).toBe(2);
	}
});
