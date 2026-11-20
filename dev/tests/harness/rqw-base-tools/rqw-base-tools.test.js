import { expect, test } from "bun:test";
import { realpathSync } from "node:fs";
import { mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import plugin from "../../../../src/modules/rqw-base-tools/index.js";
import reference from "../../../../src/modules/rqw-base-tools/rqw-base-tools.reference.json";
import texts from "../../../../src/modules/rqw-base-tools/rqw-base-tools.texts.json";

const yml = Bun.YAML.parse(await Bun.file(new URL("../../../../src/modules/rqw-base-tools/rqw-base-tools.yml", import.meta.url)).text());

// The dry run of the fake engine fails on every file with `bad` in its path. A `+same` body changes nothing:
// alone it passes without a diff, with another file it fails.
class EditSession {
	static stores = [];
	constructor(store) { EditSession.stores.push(store); }
	setArgsJson(json) { this.input = JSON.parse(json).input; }
	finish() {}
	close() {}
	async apply() {
		const bad = /\[(\S*bad[^#\]]*)/.exec(this.input);
		if (bad) return { isError: true, text: `no match in ${bad[1]}` };
		if (!this.input.includes("+same")) return { isError: false, text: "ok" };
		return this.input.match(/^\[/gm).length > 1 ? { isError: true, text: "no change" } : { isError: false, text: "no change", files: [{ diff: "" }] };
	}
}
const engine = () => ({});
// One fake of OMP: the engine and the settings registry.
function setup(natives = engine(), current = reference.settings, cwd = "/repo") {
	const handlers = {}, seen = [];
	plugin(
		{ pi: { settings: current }, on: (name, fn) => (handlers[name] = fn) },
		async name => name.endsWith("pi-natives") ? { EditSession, EditStore: class {
			seen = []; snapshots = new Map(); lines = new Map();
			recordSnapshot(path, text, lines) { this.snapshots.set(path, text); this.lines.set(path, lines); return "ABCD"; }
			recordSnapshotFile(path) { this.seen.push(path); return "ABCD"; }
			byHashText(path) { return this.snapshots.get(path); }
			seenLines(path) { return this.lines.get(path) ?? null; }
			relocate(from, to) { this.seen.push(`${from}>${to}`); }
		}, hashlineFileHash: () => "ABCD", ...natives } : { lookup: key => ({ get: all => all[key] }) },
	);
	const ctx = { cwd, agent: { kind: "main" }, ui: { notify: message => seen.push(message) }, sessionManager: { getSessionId: () => "one", getCwd: () => cwd } };
	return { handlers, seen, ctx };
}
const tmp = async run => {
	const dir = realpathSync(await mkdtemp(join(tmpdir(), "rqw-base-tools-")));
	try { await run(dir); } finally { await rm(dir, { recursive: true }); }
};

// ---- texts and guard ----

// A request with the native tools of the reference, in the flat (Claude) form.
const payload = () => ({
	messages: [{ role: "assistant", content: [{ type: "tool_use", name: "read", input: { path: "." } }] }],
	tools: Object.entries(reference.tools).map(([name, { description, fields }]) => ({ name, description, input_schema: { properties: Object.fromEntries(fields.map(field => [field, {}])) } })),
});
const tool = (body, name) => body.tools.find(entry => entry.name === name);
// Our text goes first; the native text stays from its marker on.
const ours = Object.entries(reference.tools).map(([name, { description }]) => texts.native[name] === undefined ? description : [].concat(texts.native[name])
	.map(part => typeof part === "string" ? part : description.slice(description.indexOf(part.native))).join(""));

test("the other native descriptions become ours; schemas and messages stay", async () => {
	const { handlers, ctx, seen } = setup(), body = payload(), before = JSON.stringify([body.messages, body.tools.map(entry => entry.input_schema)]);
	for (const entry of body.tools) entry.name = `_${entry.name}`;
	expect(await handlers.before_provider_request({ payload: body }, ctx)).toBe(body);
	expect(body.tools.map(entry => entry.description)).toEqual(ours);
	expect(JSON.stringify([body.messages, body.tools.map(entry => entry.input_schema)])).toBe(before);
	expect(tool(body, "_bash").input_schema.properties.notify).toEqual({});
	expect(tool(body, "_bash").description).toContain("Read local://0.log for full output");
	expect(seen).toEqual([]);
	expect(tool(body, "_edit").description).toContain("The result names skipped files and their reasons");
	expect(tool(body, "_edit").description).not.toMatch(/dry run|native edit|staging/i);
});

test("with another builtins list: the nested form is rewritten once", async () => {
	const { handlers, ctx, seen } = setup(), flat = payload();
	tool(flat, "bash").description = tool(flat, "bash").description.replace(/(ahead of PATH: ).*/, "$1awk");
	const body = { tools: flat.tools.map(entry => ({ type: "function", function: entry })) };
	await handlers.before_provider_request({ payload: body }, ctx);
	const once = JSON.stringify(body);
	expect(flat.tools.map(entry => entry.description)).toEqual(ours.map(text => text.replace(/(ahead of PATH: ).*/, "$1awk")));
	await handlers.before_provider_request({ payload: body }, ctx);
	expect(JSON.stringify(body)).toBe(once);
	expect(seen).toEqual([]);
});

test("a native text without its marker is kept whole, and a second pass adds nothing", async () => {
	const { handlers, ctx } = setup(), body = payload();
	tool(body, "bash").description = "new native text";
	await handlers.before_provider_request({ payload: body }, ctx);
	await handlers.before_provider_request({ payload: body }, ctx);
	expect(tool(body, "bash").description).toBe(ours[Object.keys(reference.tools).indexOf("bash")].split("Persistent bash")[0] + "new native text");
});

test("the Google, Bedrock and string-schema forms are rewritten; empty descriptions of the inline catalog are left alone", async () => {
	const { handlers, ctx, seen } = setup(), inline = payload();
	const send = (body, id) => handlers.before_provider_request({ payload: body }, { ...ctx, sessionManager: { getSessionId: () => id } });
	const forms = [
		[schema => ({ parametersJsonSchema: schema }), list => ({ request: { tools: [{ functionDeclarations: list }] } })],
		[schema => ({ inputSchema: { json: schema } }), list => ({ toolConfig: { tools: list.map(toolSpec => ({ toolSpec })) } })],
		[schema => ({ jsonSchemaString: JSON.stringify(schema) }), tools => ({ tools })],
	];
	for (const [shape, wrap] of forms) {
		const list = payload().tools.map(({ input_schema, ...entry }) => ({ ...entry, ...shape(input_schema) }));
		await send(wrap(list), wrap);
		expect(list.map(entry => entry.description)).toEqual(ours);
	}
	// Bedrock drops the empty description.
	inline.tools.forEach((entry, at) => at ? (entry.description = "") : delete entry.description);
	await send(inline, "inline");
	expect([inline.tools.map(entry => entry.description), seen]).toEqual([[undefined, ...Array(3).fill("")], []]);
});

test("no text names subagents", () => {
	expect(JSON.stringify(texts)).not.toMatch(/scout|subagent|Task \+/i);
});

test("the guard names the first change, once per session, and our text is applied anyway", async () => {
	const prefix = "rqw-base-tools: ";
	const cases = [
		[body => (tool(body, "write").description += " new"), "native write changed description"],
		[body => (tool(body, "bash").input_schema.properties.extra = {}), "native bash changed fields"],
		[body => delete tool(body, "bash").input_schema.properties.notify, "native bash changed fields"],
		[body => body.tools.splice(body.tools.indexOf(tool(body, "write")), 1), "native write is missing"],
		[() => {}, "setting edit.mode changed", undefined, { ...reference.settings, "edit.mode": "apply_patch" }],
		[() => {}, "engine hashlineFileHash changed", { hashlineFileHash: undefined }],
		[body => (tool(body, "edit").input_schema.properties = { definition: {}, syntax: {}, type: {} })],
		[body => (tool(body, "edit").description = reference.tools.edit.alt[2].description)],
	];
	for (const [change, want, natives, current] of cases) {
		const { handlers, ctx, seen } = setup(natives, current), send = async session => {
			const body = payload();
			change(body);
			await handlers.before_provider_request({ payload: body }, { ...ctx, sessionManager: { getSessionId: () => session } });
			return body;
		};
		const body = await send("one");
		await send("one");
		expect(seen).toEqual(want ? [prefix + want] : []);
		expect(tool(body, "bash").description.startsWith(ours[Object.keys(reference.tools).indexOf("bash")].split("Persistent bash")[0])).toBe(true);
		await send("two");
		expect(seen).toHaveLength(want ? 2 : 0);
	}
});

test("edit in the replace mode is native and gets its own text", async () => {
	const { handlers, ctx, seen } = setup(), body = payload(), { description, fields } = reference.tools.edit.alt[1];
	Object.assign(tool(body, "edit"), { description, input_schema: { properties: Object.fromEntries(fields.map(field => [field, {}])) } });
	await handlers.before_provider_request({ payload: body }, ctx);
	expect([tool(body, "edit").description, seen]).toEqual([texts.native.replace, []]);
});

test("a subagent without a tool is not a change", async () => {
	const { handlers, ctx, seen } = setup(), body = payload();
	body.tools.splice(body.tools.indexOf(tool(body, "edit")), 1);
	await handlers.before_provider_request({ payload: body }, { ...ctx, agent: { kind: "sub" } });
	expect(seen).toEqual([]);
});

test("the settings file sets every guarded setting", () => {
	const flat = (node, prefix = "") => Object.entries(node).flatMap(([key, value]) => typeof value === "object" ? flat(value, `${prefix}${key}.`) : [[prefix + key, value]]);
	expect(Object.fromEntries(flat(yml))).toMatchObject(reference.settings);
	expect(yml.tools.intentTracing).toBe(true);
});

// ---- per-file patches ----

const patch = (...sections) => sections.join("\n");
const a = "[a.txt#AAAA]\nPUT 1.=1:\n+new", bad = "[bad.txt#BBBB]\nPUT 9.=9:\n+new", alias = "[./bad.txt#BBBB]\nPUT 1.=1:\n+x", c = "[m.txt]\nPUT 1.=1:\n+x", bad2 = "[bad2.txt#DDDD]\nPUT 1.=1:\n+x";
const call = (input, toolName = "edit") => ({ toolName, toolCallId: "one", input: { input } });
const result = more => ({ toolName: "edit", toolCallId: "one", isError: false, content: [{ type: "text", text: "Success." }], ...more });
const note = [texts.skipped.head, "[bad.txt]: no match in bad.txt", texts.skipped.section, `${bad}\n${alias}`, texts.skipped.tail].join("\n");
// A folder with the files the patches change.
const repo = (run, natives) => tmp(async dir => {
	for (const name of ["a.txt", "bad.txt", "bad2.txt", "m.txt", "n.ipynb"]) await writeFile(join(dir, name), "old");
	await run(setup(natives, undefined, dir), dir);
});

test("a file that does not match is left out whole; the answer is an error with a note and a red entry", () => repo(async ({ handlers, ctx }, dir) => {
	const done = { path: "/repo/a.txt", diff: "+new" }, failed = { path: join(dir, "bad.txt"), diff: "", isError: true, errorText: "no match in bad.txt" };
	for (const [name, details, written] of [["edit", { diff: "d", firstChangedLine: 3, perFileResults: [done] }, done], ["_edit", undefined]]) {
		expect(await handlers.tool_call(call(`*** Begin Patch\n${patch(a, bad, c, alias)}\n*** End Patch\n`, name), ctx)).toEqual({ input: { input: patch(a, c) } });
		const native = result({ details });
		expect(handlers.tool_result(native)).toEqual({
			isError: true,
			content: [{ type: "text", text: note }, ...native.content],
			details: { diff: details?.diff ?? "", firstChangedLine: details?.firstChangedLine, perFileResults: written ? [written, failed] : [failed] },
		});
		expect(handlers.tool_result(native)).toBeUndefined();
	}
	await handlers.tool_call(call(patch(a, bad)), ctx);
	const one = { diff: "d", path: "/repo/a.txt" };
	expect(handlers.tool_result(result({ details: one })).details.perFileResults[0]).toBe(one);
	// A cut without a paste is an ordinary section.
	expect(await handlers.tool_call(call(patch("[a.txt#AAAA]\nCUT 1.=1", bad)), ctx)).toEqual({ input: { input: "[a.txt#AAAA]\nCUT 1.=1" } });
	// A section that changes nothing is left out too. The spaces at the end of a body row stay.
	expect(await handlers.tool_call(call(patch("[m.txt]\nPUT 1.=1:\n+same", `${a}  \n`)), ctx)).toEqual({ input: { input: `${a}  \n` } });
	const noChange = handlers.tool_result(result()).content[0].text;
	expect(noChange).toContain("the files below were skipped");
	expect(noChange).toContain("[m.txt]: The section makes no changes.");
}));

test("a native failure after the cut keeps its error and details behind the note", () => repo(async ({ handlers, ctx }) => {
	const details = { diff: "", errorKind: "parse" };
	await handlers.tool_call(call(patch(a, bad, alias)), ctx);
	expect(handlers.tool_result(result({ isError: true, content: [{ type: "text", text: "boom" }], details }))).toEqual({ isError: true, content: [{ type: "text", text: `${note}\nboom` }], details });
}));

test("the native edit gets the patch as it is in every other case", async () => {
	const broken = { ...engine(), EditSession: class { constructor() { throw new Error("engine changed"); } } };
	const same = [
		[patch(a, c)], [patch(bad, alias)], [patch(bad, bad2)], [`x\n${patch(a, bad)}`], [undefined], [patch(a, bad), "write"], [patch(a, bad), "edit", broken],
		// The engine may find a missing file elsewhere by its name.
		[patch(a, bad, "[gone.txt#EEEE]\nPUT 1.=1:\n+x")],
		// A move between files: the source must not be cut without the paste. A renamed file may land on a skipped one. A removal drops snapshots. A notebook is cells.
		[patch("[a.txt#AAAA]\nCUT 1.=1", "[m.txt]\nPUT <1", bad)], [patch(a, bad, "[m.txt]\nPUT <1 @name")], [patch("[a.txt#AAAA]\nMV bad.txt", bad)], [patch(a, bad, "[m.txt]\nREM")], [patch(a, bad, "[n.ipynb]\nPUT 1.=1:\n+x")],
		// The native edit ignores the rows after the end of a patch.
		[`${patch(bad)}\n*** End Patch\n${c}`],
	];
	for (const [input, name, natives] of same) await repo(async ({ handlers, ctx }) => {
		expect(await handlers.tool_call(call(input, name), ctx)).toBeUndefined();
		expect(handlers.tool_result(result())).toBeUndefined();
	}, natives);
});

test("a link to a file is that file; a denied call leaves nothing behind", () => tmp(async dir => {
	await writeFile(join(dir, "a.txt"), "old");
	await symlink(join(dir, "a.txt"), join(dir, "bad.txt"));
	await writeFile(join(dir, "bad2.txt"), "old");
	const { handlers, ctx } = setup(undefined, undefined, dir);
	expect(await handlers.tool_call(call(patch(a, bad)), ctx)).toBeUndefined();
	await handlers.tool_call(call(patch(a, bad2)), ctx);
	handlers.tool_execution_end({ toolCallId: "one" });
	expect(handlers.tool_result(result())).toBeUndefined();
	// The next call with the same id starts clean too.
	await handlers.tool_call(call(patch(a, bad2)), ctx);
	await handlers.tool_call(call("x"), ctx);
	expect(handlers.tool_result(result())).toBeUndefined();
}));

const shown = (toolName, text) => ({ toolName, toolCallId: "r", isError: false, content: [{ type: "text", text }] });

test("the dry run copies a shown tagged read into its independent store", () => repo(async ({ handlers, ctx }, dir) => {
	await handlers.session_start({}, ctx);
	handlers.tool_result(shown("read", "[a.txt#ABCD]\n1:old"), ctx);
	await handlers.tool_call(call(patch("[a.txt#ABCD]\nPUT 1.=1:\n+new", bad)), ctx);
	const recorded = EditSession.stores.findLast(store => store.snapshots.get(join(dir, "a.txt")) === "old");
	expect(recorded.seenLines(join(dir, "a.txt"))).toEqual([0, 1]);
}));

test("a section tagged by a native grep survives an independent unseen anchor, which remains unseen", () => repo(async ({ handlers, ctx }, dir) => {
	await writeFile(join(dir, "m.txt"), "old\nhidden\n");
	await handlers.session_start({}, ctx);
	handlers.tool_result(shown("grep", "# ./\n### a.txt#ABCD\n*1:old\n 2:absent"), ctx);
	handlers.tool_result(shown("read", "[m.txt#ABCD]\n1:old"), ctx);
	const good = "[a.txt#ABCD]\nPUT 1.=1:\n+new", unseen = "[m.txt#ABCD]\nPUT 2.=2:\n+new";
	for (let attempt = 0; attempt < 2; attempt++) {
		expect(await handlers.tool_call(call(patch(good, unseen)), ctx)).toEqual({ input: { input: good } });
		const text = handlers.tool_result(result()).content[0].text;
		expect(text).toContain("[m.txt]: The section anchors lines not shown in full.");
		expect(text).not.toContain("straight retry");
	}
}, { EditSession: class extends EditSession {
	constructor(store, policy) { super(store); this.store = store; this.policy = policy; }
	async apply() {
		for (const [, name, line] of this.input.matchAll(/\[([^#]+)#ABCD\]\nPUT (\d+)\.=/g)) {
			const path = join(this.policy.cwd, name), shown = this.store.seenLines(path);
			if (this.policy.enforceSeenLines && shown && !shown.includes(+line)) {
				this.store.recordSnapshot(path, this.store.snapshots.get(path), [...shown, +line]);
				return { isError: true, errorKind: "unseen_lines", text: "straight retry" };
			}
		}
		return { isError: false, text: "ok" };
	}
} }));

test("the grep tree names files below its folders; a snapshot outlives a later change of the file", () => tmp(async dir => {
	const full = join(dir, "src/deep/stale.txt");
	await Bun.write(full, "hit\r\nold\r\n"); await writeFile(join(dir, "bad.txt"), "old\n"); await writeFile(join(dir, "a.txt"), "old\n");
	const { handlers, ctx } = setup({ EditSession: class extends EditSession {
		constructor(store) { super(store); this.store = store; }
		async apply() {
			if (this.input.includes("[bad.txt")) return { isError: true, text: "no match" };
			if (this.input.includes("stale.txt") && this.store.snapshots.get(full) !== "hit\r\nold\r\n") return { isError: true, text: "missing snapshot" };
			return { isError: false, text: "ok" };
		}
	} }, undefined, dir);
	await handlers.session_start({}, ctx);
	handlers.tool_result(shown("grep", "# src/\n\n## deep/\n### stale.txt#ABCD\n*1:hit"), ctx);
	await writeFile(full, "hit\r\nchanged\r\n");
	const stale = "[src/deep/stale.txt#ABCD]\nPUT 1.=1:\n+new";
	expect(await handlers.tool_call(call(patch(stale, a, bad)), ctx)).toEqual({ input: { input: patch(stale, a) } });
}));
