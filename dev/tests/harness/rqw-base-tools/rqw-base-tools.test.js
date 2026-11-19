import { expect, test } from "bun:test";
import { realpathSync } from "node:fs";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
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
const engine = (paths = [], calls = []) => ({
	calls,
	glob: async options => (calls.push(options), { matches: paths.map(path => ({ path })) }),
	grep: async () => ({ matches: [] }),
});
// One fake of OMP: the engine, the settings registry, the approval keys.
function setup(natives = engine(), current = reference.settings, cwd = "/repo") {
	const handlers = {}, tools = [], seen = [], active = ["read", "grep", "glob", "edit"];
	const field = (doc = {}) => ({
		doc, optional: () => field(doc), nullable: () => field(doc), int: () => field({ ...doc, type: "integer" }),
		min: n => field({ ...doc, minimum: n }), max: n => field({ ...doc, maximum: n }), positive: () => field({ ...doc, exclusiveMinimum: 0 }),
	});
	const Base = name => class {
		description = natives.descriptions?.[name] ?? reference.tools[name].description;
		parameters = { toJsonSchema: () => natives.schemas?.[name] ?? (natives.fields?.[name] ? { properties: Object.fromEntries(natives.fields[name].filter(key => key !== "i").map(key => [key, {}])) } : reference.tools[name].schema) };
		approval = args => String(args?.path).includes("ssh://") ? "exec" : "read";
		approvalCacheTargets = args => [`${name} ${args?.path ?? "."}`];
	};
	plugin(
		{ zod: { string: () => field({ type: "string" }), boolean: () => field({ type: "boolean" }), number: () => field({ type: "number" }), enum: field, union: items => field({ anyOf: items.map(item => item.doc) }), object: shape => ({ ...shape, toJsonSchema: () => ({ properties: Object.fromEntries(Object.entries(shape).map(([key, value]) => [key, value.doc])) }) }) }, pi: { settings: current }, getActiveTools: () => active, on: (name, fn) => (handlers[name] = fn), registerTool: tool => tools.push(tool) },
		async name => name.endsWith("pi-natives") ? { FileType: { File: 1 }, EditSession, EditStore: class {
			seen = []; snapshots = new Map(); lines = new Map();
			recordSnapshot(path, text, lines) { this.snapshots.set(path, text); this.lines.set(path, lines); return "ABCD"; }
			recordSnapshotFile(path) { this.seen.push(path); return "ABCD"; }
			byHashText(path) { return this.snapshots.get(path); }
			seenLines(path) { return this.lines.get(path) ?? null; }
			relocate(from, to) { this.seen.push(`${from}>${to}`); }
		}, hashlineFileHash: () => "ABCD", ...natives }
			: name.endsWith("registry") ? { lookup: key => ({ get: all => all[key] }) }
			: name.endsWith("model-resolver") ? { formatModelStringWithRouting: model => `${model.provider}/${model.id}` }
			: name.endsWith("file-display-mode") ? { resolveFileDisplayMode: session => ({ hashLines: session.hasEditTool && session.settings["edit.mode"] === "hashline" && !session.getActiveModelString()?.includes("deepseek") }) }
			: name.endsWith("tools/output-meta") ? { stripOutputNotice: (text, meta) => meta.notice && text.endsWith(meta.notice) ? text.slice(0, -meta.notice.length) : text }
			: name.endsWith("tools/read") ? { ReadTool: Base("read") } : name.endsWith("tools/grep") ? { GrepTool: Base("grep") } : name.endsWith("tools/glob") ? { GlobTool: Base("glob") }
			: { approvalDirectoryKey: dir => `${dir}/`, approvalTreeSearchKey: key => `tree ${key}`, approvalCacheKeyForPath: path => path },
	);
	const ctx = { cwd, model: { provider: "anthropic", id: "sonnet" }, agent: { kind: "main" }, ui: { notify: message => seen.push(message) }, sessionManager: { getSessionId: () => "one", getCwd: () => cwd } };
	return { handlers, tools, seen, ctx, active };
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
// The remaining native texts. The three wrapped tools keep their own descriptions.
const ours = Object.entries(reference.tools).map(([name, { description }]) => texts.native[name] === undefined ? description : [].concat(texts.native[name])
	.map(part => typeof part === "string" ? part : description.slice(description.indexOf(part.native))).join(""));

test("the other native descriptions become ours; schemas and messages stay", async () => {
	const { handlers, ctx, seen } = setup(), body = payload(), before = JSON.stringify([body.messages, body.tools.map(entry => entry.input_schema)]);
	for (const entry of body.tools) entry.name = `_${entry.name}`;
	expect(await handlers.before_provider_request({ payload: body }, ctx)).toBe(body);
	expect(body.tools.map(entry => entry.description)).toEqual(ours);
	expect(JSON.stringify([body.messages, body.tools.map(entry => entry.input_schema)])).toBe(before);
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
	expect([inline.tools.map(entry => entry.description), seen]).toEqual([[undefined, ...Array(5).fill("")], []]);
});

test("no text names subagents", () => {
	expect(JSON.stringify(texts)).not.toMatch(/scout|subagent|Task \+/i);
});

test("the guard names the first change, once per session, and our text is applied anyway", async () => {
	const prefix = "rqw-base-tools: ";
	const cases = [
		[body => (tool(body, "grep").description += " new"), "native grep changed description"],
		[body => (tool(body, "bash").input_schema.properties.extra = {}), "native bash changed fields"],
		[body => body.tools.splice(body.tools.indexOf(tool(body, "read")), 1), "native read is missing"],
		[() => {}, "setting edit.mode changed", undefined, { ...reference.settings, "edit.mode": "apply_patch" }],
		[() => {}, "engine grep changed", { ...engine(), grep: undefined }],
		[body => (tool(body, "edit").input_schema.properties = { definition: {}, syntax: {}, type: {} })],
		[body => (tool(body, "edit").description = reference.tools.edit.alt[2].description)],
		[body => (tool(body, "read").description = tool(body, "read").description.replace("- Directory", "- Selected file: `[a#1A2B]`\n- Directory"))],
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
		expect(tool(body, "grep")?.description.startsWith(ours[Object.keys(reference.tools).indexOf("grep")])).toBe(true);
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

test("the dry run copies a shown tagged read into its independent store", () => repo(async ({ handlers, ctx }, dir) => {
	await handlers.session_start({}, ctx);
	handlers.tool_result(read({ meta: { source: { type: "path", value: join(dir, "a.txt") } } }, { content: [{ type: "text", text: "[a.txt#ABCD]\n1:old" }] }), ctx);
	await handlers.tool_call(call(patch("[a.txt#ABCD]\nPUT 1.=1:\n+new", bad)), ctx);
	const recorded = EditSession.stores.findLast(store => store.snapshots.get(join(dir, "a.txt")) === "old");
	expect(recorded.seenLines(join(dir, "a.txt"))).toEqual([0, 1]);
}));

test("a grep-tagged section survives an independent unseen anchor, which remains unseen", () => repo(async ({ handlers, ctx, tools }, dir) => {
	await writeFile(join(dir, "m.txt"), "old\nhidden\n");
	await handlers.session_start({}, ctx);
	ctx.invokeTool = async () => ({ content: [{ type: "text", text: `[${join(dir, "a.txt")}#ABCD]` }] });
	const search = await tools.find(tool => tool.name === "grep").execute("g", { path: "a.txt", pattern: "old" }, undefined, undefined, ctx);
	expect(search.content[0].text).toContain("[a.txt#ABCD]");
	handlers.tool_result(read({ meta: { source: { type: "path", value: join(dir, "m.txt") } } }, { content: [{ type: "text", text: "[m.txt#ABCD]\n1:old" }] }), ctx);
	const good = "[a.txt#ABCD]\nPUT 1.=1:\n+new", unseen = "[m.txt#ABCD]\nPUT 2.=2:\n+new";
	for (let attempt = 0; attempt < 2; attempt++) {
		expect(await handlers.tool_call(call(patch(good, unseen)), ctx)).toEqual({ input: { input: good } });
		const text = handlers.tool_result(result()).content[0].text;
		expect(text).toContain("[m.txt]: The section anchors lines not shown in full.");
		expect(text).not.toContain("straight retry");
	}
}, { ...engine(), grep: async options => ({ matches: [{ path: options.path, lineNumber: 1, line: "old" }] }), EditSession: class extends EditSession {
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

// ---- whole-file mark ----

const whole = more => ({ totalLines: 2, fileSize: 8, displayContent: { lineNumbers: [1, 2] }, meta: { source: { type: "path" } }, ...more });
const read = (details, more) => ({ toolName: "read", toolCallId: "r", isError: false, content: [{ type: "text", text: "one\ntwo" }], details, ...more });

test("a read that shows every line ends with the whole-file mark, once", () => {
	const { handlers } = setup(), event = read(whole());
	expect(handlers.tool_result(event)).toEqual({ content: [{ type: "text", text: "one\ntwo\n[whole file: 2 lines]" }] });
	expect(handlers.tool_result(event)).toBeUndefined();
	const empty = read(whole({ totalLines: 1, fileSize: 0, displayContent: { lineNumbers: [1] } }), { content: [{ type: "text", text: "" }] });
	expect(handlers.tool_result(empty).content[0].text).toBe("[whole file: 0 lines]");
});

test("several ranges that cover the file get the mark: the lines are counted in the file", () => tmp(async dir => {
	await writeFile(join(dir, "a.txt"), "one\rtwo\r\n");
	const ranges = (lineNumbers, path = "a.txt:1,2") => read({ displayContent: { lineNumbers }, meta: { source: { type: "path", value: join(dir, "a.txt") } } }, { input: { path } });
	expect(setup().handlers.tool_result(ranges([1, 2])).content[0].text).toEndWith("[whole file: 2 lines]");
	// A part, and one range that did not reach the end of the file.
	for (const event of [ranges([1]), ranges([1, 2], "a.txt:1-2")]) expect(setup().handlers.tool_result(event)).toBeUndefined();
}));

test("a part, a summary and a non-file get no mark", () => {
	const { handlers } = setup();
	const events = [
		read(whole({ displayContent: { lineNumbers: [2] } })), read(whole({ displayContent: { lineNumbers: [1] } })), read(whole({ displayContent: { lineNumbers: [1, null] } })),
		read(whole({ truncation: { truncated: true } })), read(whole({ meta: { limits: { columnTruncated: {} } } })), read(whole({ summary: {} })), read(whole({ spotlight: {} })),
		read(whole({ meta: { truncation: {} } })), read(whole({ meta: { source: { type: "url" } } })), read(whole({ meta: { source: { type: "internal" } } })), read(whole(), { input: { path: "a.json?q=.a:raw" } }), read(whole({ isDirectory: true })), read(whole({ totalLines: undefined })), read(undefined),
		read(whole(), { isError: true }), read(whole(), { content: [{ type: "image" }, { type: "text", text: "x" }] }), read(whole(), { toolName: "grep" }),
	];
	for (const event of events) expect(handlers.tool_result(event)).toBeUndefined();
});

// ---- Cursor-style wrappers ----

test("grep pages without a per-file cap, records shown tags, and supports modes and context", () => tmp(async dir => {
	const full = join(dir, "hot.txt"), calls = [], rows = Array.from({ length: 80 }, (_, i) => `hit ${i + 1}`);
	await writeFile(full, rows.join("\n") + "\n");
	const natives = { ...engine(), grep: async opts => {
		calls.push(opts);
		if (opts.mode === "count") return { matches: [{ path: full, matchCount: 80 }] };
		if (opts.mode === "filesWithMatches") return { matches: [{ path: full }] };
		return { matches: rows.map((line, i) => ({ path: full, lineNumber: i + 1, line })) };
	} };
	const { tools, ctx } = setup(natives, undefined, dir), grep = tools.find(t => t.name === "grep"), native = [];
	ctx.invokeTool = async args => (native.push(args), { content: [{ type: "text", text: /:\d+-\d+(?:,\d+-\d+)*$/.test(args.path) ? `[${full}#ABCD]` : "" }] });
	const run = async args => (await grep.execute("x", args, undefined, undefined, ctx)).content[0].text;
	const first = await run({ path: "hot.txt", pattern: "hit", head_limit: 60, "-C": 1, "-i": true, type: "txt", glob: "*.txt", multiline: true });
	expect(first).toContain("[hot.txt#ABCD]\n  1:hit 1");
	expect(first).toContain("  60:hit 60");
	expect(first).toContain("Use offset=60");
	expect(native).toHaveLength(3);
	expect(calls[0]).toMatchObject({ pattern: "(?s)hit", contextBefore: 1, contextAfter: 1, ignoreCase: true, type: "txt", glob: "*.txt", multiline: true });
	expect(await run({ path: "hot.txt", pattern: "hit", offset: 60, head_limit: 10 })).toContain("[hot.txt#ABCD]\n  61:hit 61");
	expect(await run({ path: "hot.txt", pattern: "hit", output_mode: "count" })).toContain("hot.txt:80");
	expect(await run({ path: "hot.txt", pattern: "hit", output_mode: "files_with_matches" })).toContain("\nhot.txt\n");
	ctx.invokeTool = async () => (await writeFile(full, "changed during registration\n"), { content: [{ type: "text", text: `[${full}#ABCD]` }] });
	expect(await run({ path: "hot.txt", pattern: "hit", head_limit: 1 })).toContain("[hot.txt]\n  1:hit 1");
	ctx.invokeTool = async args => ({ content: [{ type: "text", text: JSON.stringify(args) }] });
	expect(await run({ path: "skill://test:1-2", pattern: "x", case: false })).toBe('{"path":"skill://test:1-2","pattern":"x","case":false}');
	expect(await run({ path: "hot.txt;".repeat(32) + "hot.txt", pattern: "x" })).toBe(JSON.stringify({ path: "hot.txt;".repeat(32) + "hot.txt", pattern: "x" }));
	expect(await run({ path: "skill://test", pattern: "x", head_limit: 2 })).toContain("does not support head_limit");
}));

test("multiline grep discloses its window in all modes for files and directories", () => tmp(async dir => {
	const full = join(dir, "large.txt"); await writeFile(full, `hit\n${"x".repeat(4 * 1024 * 1024)}`);
	let found = false, calls = 0;
	const natives = { ...engine(), grep: async () => (calls++, { matches: found ? [{ path: full, lineNumber: 1, line: "hit", matchCount: 1 }] : [], filesSearched: 1 }) };
	const { tools, ctx } = setup(natives, undefined, dir), grep = tools.find(t => t.name === "grep");
	const run = async args => (await grep.execute("x", args, undefined, undefined, ctx)).content[0].text;
	for (const path of ["large.txt", "."]) for (const output_mode of ["content", "count", "files_with_matches"]) for (found of [false, true]) {
		const text = await run({ path, pattern: "hit", multiline: true, output_mode });
		expect(text).toContain("at most the first 4 MiB of each file");
		if (!found) {
			expect(text).toContain("No matches in searched content");
			expect(text).not.toContain("No matches found");
		}
	}
	expect(calls).toBe(12);
	expect(await run({ path: "large.txt", pattern: "hit", multiline: true, offset: 1 })).toContain("No more results in searched content");
	expect(await run({ path: "large.txt", pattern: "hit" })).not.toContain("first 4 MiB");
}));

test("read and grep expose CRLF tags only for an available hashline edit", () => tmp(async dir => {
	const full = join(dir, "crlf.txt"), source = "one\r\ntwo\r\n";
	await writeFile(full, source);
	const natives = { ...engine(), grep: async () => ({ matches: [{ path: full, lineNumber: 2, line: "two" }] }) };
	const { tools, ctx, active } = setup(natives, undefined, dir);
	ctx.invokeTool = async args => args.pattern ? { content: [{ type: "text", text: `[${full}#ABCD]` }] } : {
		content: [{ type: "text", text: "two" }],
		details: { raw: true, fileSize: Buffer.byteLength(source), totalLines: 2, displayContent: { text: "two", lineNumbers: [2] }, meta: { source: { type: "path", value: full } } },
	};
	const run = async name => (await tools.find(tool => tool.name === name).execute("x", name === "read" ? { path: "crlf.txt", offset: 2, limit: 1 } : { path: "crlf.txt", pattern: "two" }, undefined, undefined, ctx)).content[0].text;
	for (const name of ["read", "grep"]) expect(await run(name)).toContain("[crlf.txt#ABCD]");
	ctx.model = { provider: "openrouter", id: "deepseek" };
	for (const name of ["read", "grep"]) expect(await run(name)).not.toContain("#ABCD]");
	ctx.model = { provider: "anthropic", id: "sonnet" };
	active.splice(active.indexOf("edit"), 1);
	for (const name of ["read", "grep"]) expect(await run(name)).not.toContain("#ABCD]");
}));

test("the local range and glob schemas exclude zero without excluding negative offsets", () => {
	const { tools } = setup(), read = tools.find(tool => tool.name === "read").parameters.toJsonSchema().properties;
	const glob = tools.find(tool => tool.name === "glob").parameters.toJsonSchema().properties;
	expect(read.offset.anyOf).toEqual([{ type: "integer", minimum: -Number.MAX_SAFE_INTEGER, maximum: -1 }, { type: "integer", minimum: 1, maximum: Number.MAX_SAFE_INTEGER }]);
	expect(glob.limit).toEqual({ type: "number", exclusiveMinimum: 0 });
});

test("a tagged grep snapshot lets a later stale-tag section survive a partial patch", () => tmp(async dir => {
	const full = join(dir, "stale.txt"), badFile = join(dir, "bad.txt");
	await writeFile(full, "hit\r\nold\r\n"); await writeFile(badFile, "old\n"); await writeFile(join(dir, "a.txt"), "old\n");
	const natives = { ...engine(), grep: async () => ({ matches: [{ path: full, lineNumber: 1, line: "hit" }] }), EditSession: class extends EditSession {
		constructor(store) { super(store); this.store = store; }
		async apply() {
			if (this.input.includes("[bad.txt")) return { isError: true, text: "no match" };
			if (this.input.includes("[stale.txt") && this.store.snapshots.get(full) !== "hit\r\nold\r\n") return { isError: true, text: "missing snapshot" };
			return { isError: false, text: "ok" };
		}
	} };
	const { tools, ctx, handlers } = setup(natives, undefined, dir); await handlers.session_start({}, ctx);
	ctx.invokeTool = async () => ({ content: [{ type: "text", text: `[${full}#ABCD]` }] });
	const grep = tools.find(t => t.name === "grep");
	expect((await grep.execute("x", { path: "stale.txt", pattern: "hit" }, undefined, undefined, ctx)).content[0].text).toContain("[stale.txt#ABCD]");
	await writeFile(full, "hit\r\nchanged\r\n");
	const stale = "[stale.txt#ABCD]\nPUT 1.=1:\n+new";
	expect(await handlers.tool_call(call(patch(stale, a, bad)), ctx)).toEqual({ input: { input: patch(stale, a) } });
}));

test("multiline grep on CRLF renders editable numbered rows without carriage returns", () => tmp(async dir => {
	const full = join(dir, "crlf.txt"); await writeFile(full, "one\r\ntwo\r\n");
	const natives = { ...engine(), grep: async () => ({ matches: [{ path: full, lineNumber: 1, line: "one\r\ntwo" }] }) };
	const { tools, ctx } = setup(natives, undefined, dir);
	ctx.invokeTool = async () => ({ content: [{ type: "text", text: `[${full}#ABCD]` }] });
	const text = (await tools.find(t => t.name === "grep").execute("x", { path: "crlf.txt", pattern: "one\\ntwo" }, undefined, undefined, ctx)).content[0].text;
	expect(text).toContain("[crlf.txt#ABCD]\n  1:one\n  2:two");
	expect(text).not.toContain("\r");
}));

test("glob returns a full count above 200 and delegates the native shape", () => tmp(async dir => {
	const files = Array.from({ length: 250 }, (_, i) => `d/f${250 - i}.txt`), natives = engine(files);
	const { tools, ctx, handlers } = setup(natives, undefined, dir), glob = tools.find(t => t.name === "glob"), target_directory = "src[1]";
	await mkdir(join(dir, target_directory));
	await handlers.session_start({}, ctx);
	const run = async args => (await glob.execute("x", args, undefined, undefined, ctx)).content[0].text;
	const result = await run({ glob_pattern: "./*.txt", target_directory, hidden: false, gitignore: false });
	expect(result).toStartWith("Result of search in 'src[1]' (total 250 files):\n- d/f250.txt");
	expect(glob.approvalCacheTargets({ glob_pattern: "README.md", target_directory })).toEqual([`tree ${join(dir, target_directory)}/`]);
	expect(result).toContain("150 more files");
	expect(natives.calls[0]).toMatchObject({ path: join(dir, target_directory), pattern: "**/*.txt", sortByMtime: true, hidden: false, gitignore: false });
	ctx.invokeTool = async args => ({ content: [{ type: "text", text: JSON.stringify(args) }] });
	expect(await run({ glob_pattern: "./*.txt", target_directory, limit: 2 })).toBe("Result of search in 'src[1]' (total 250 files):\n- d/f250.txt\n- d/f249.txt\n... 248 more files ... (Do a more specific search if needed)");
	expect(await run({ glob_pattern: "./*.txt", target_directory: "tree", limit: 2 })).toBe('{"path":"tree/**/*.txt","limit":2}');
	expect(await run({ path: "skill://*.md", limit: 10 })).toBe('{"path":"skill://*.md","limit":10}');
	expect(await run({ path: "skill://*.md", target_directory: "", limit: 10 })).toBe('{"path":"skill://*.md","limit":10}');
	const zero = await glob.execute("x", { glob_pattern: "*.txt", target_directory, limit: 0 }, undefined, undefined, ctx);
	expect(zero.isError).toBe(true);
	const root = await glob.execute("x", { glob_pattern: "*.txt", target_directory: "/" }, undefined, undefined, ctx);
	expect(root.isError).toBe(true);
	expect(root.content[0].text).toBe("Searching from root directory '/' is not allowed");
	expect(natives.calls).toHaveLength(2);
}));

test("read honors positive and negative offsets and delegates native targets", () => tmp(async dir => {
	const path = "a:b.txt", full = join(dir, path), notice = "[Showing line 8 (partial, 1 KB of 10 KB); file not scanned to EOF]", content = `one\ntwo\n\n${notice}\nfive\n`;
	await writeFile(full, content);
	const { tools, ctx, handlers } = setup(undefined, undefined, dir), reader = tools.find(t => t.name === "read");
	let partial = false;
	ctx.invokeTool = async args => {
		const range = /:raw:(\d+)-(\d*)$/.exec(args.path);
		if (!range) return { content: [{ type: "text", text: JSON.stringify(args) }] };
		const start = +range[1], end = range[2] ? +range[2] : 6, numbers = Array.from({ length: end - start + 1 }, (_, i) => i + start);
		const body = content.split("\n").slice(start - 1, end).join("\n");
		return { content: [{ type: "text", text: body }], details: { truncation: partial ? { firstLineExceedsLimit: true } : undefined, raw: true, fileSize: content.length, totalLines: 5, displayContent: { text: body, lineNumbers: numbers }, meta: { source: { type: "path", value: full } } } };
	};
	const run = async args => (await reader.execute("x", args, undefined, undefined, ctx)).content[0].text;
	expect((await reader.execute("x", { path, offset: 0 }, undefined, undefined, ctx)).isError).toBe(true);
	expect(await run({ path, offset: 2, limit: 3 })).toStartWith(`[a:b.txt#ABCD]\n2:two\n3:\n4:${notice}`);
	expect(await run({ path, offset: -2 })).toBe(`[a:b.txt#ABCD]\n4:${notice}\n5:five`);
	partial = true;
	expect(await run({ path, offset: 2, limit: 1 })).toBe("two");
	expect(await run({ path: "skill://test" })).toBe('{"path":"skill://test"}');
	expect(await run({ path: "a.txt:1-2" })).toBe('{"path":"a.txt:1-2"}');
	await handlers.session_start({}, ctx);
	expect(reader.readsSkillUris).toBe(true);
	expect(reader.approval({ path: "ssh://host/file" })).toBe("exec");
	expect(reader.approvalCacheTargets({ path: "a.txt" })).toEqual(["read a.txt"]);
}));

test("ranged read waits for earlier same-message bash before examining any file", () => tmp(async dir => {
	for (const before of [undefined, "", "\0binary", "old\noutdated\n"]) for (const offset of [2, -1]) {
		const path = `file-${offset}.txt`, full = join(dir, path);
		await rm(full, { force: true });
		if (before !== undefined) await writeFile(full, before);
		const { tools, ctx, handlers } = setup(undefined, undefined, dir), calls = [];
		ctx.invokeTool = async args => {
			calls.push(args.path);
			const range = /:raw:(\d+)-(\d*)$/.exec(args.path);
			const text = await Bun.file(full).text(), start = +range[1], end = +(range[2] || 2), body = text.split("\n").slice(start - 1, end).join("\n");
			return { content: [{ type: "text", text: body }], details: { raw: true, fileSize: text.length, totalLines: 2, displayContent: { text: body, lineNumbers: [start] }, meta: { source: { type: "path", value: full } } } };
		};
		await handlers.tool_call({ toolName: "bash", toolCallId: "b", input: {} }, ctx);
		await handlers.tool_call({ toolName: "read", toolCallId: "x", input: { path, offset, limit: 1 } }, ctx);
		const pending = tools.find(t => t.name === "read").execute("x", { path, offset, limit: 1 }, undefined, undefined, ctx);
		await writeFile(full, "new\nfresh\n");
		handlers.tool_execution_end({ toolCallId: "b" });
		const result = await pending;
		expect(result.isError).toBeUndefined();
		expect(result.content[0].text).toBe(`[${path}#ABCD]\n2:fresh`);
		expect(calls).toEqual([`${full}:raw:2-2`]);
	}
	const cancelled = setup(undefined, undefined, dir), abort = new AbortController();
	await cancelled.handlers.tool_call({ toolName: "bash", toolCallId: "b", input: {} }, cancelled.ctx);
	await cancelled.handlers.tool_call({ toolName: "read", toolCallId: "r", input: { path: "created.txt", offset: 1 } }, cancelled.ctx);
	const waiting = cancelled.tools.find(tool => tool.name === "read").execute("r", { path: "created.txt", offset: 1 }, abort.signal, undefined, cancelled.ctx);
	abort.abort();
	await expect(waiting).rejects.toBe(abort.signal.reason);
	cancelled.handlers.tool_execution_end({ toolCallId: "b" });
	await writeFile(join(dir, "created.txt"), "new\nfresh\n");
	const { tools, ctx } = setup(undefined, undefined, dir), reader = tools.find(t => t.name === "read"), controller = new AbortController();
	const reason = new DOMException("cancelled", "AbortError");
	ctx.invokeTool = async () => { controller.abort(reason); throw new Error("cancelled"); };
	await expect(reader.execute("x", { path: "created.txt", offset: 1 }, controller.signal, undefined, ctx)).rejects.toBe(reason);
	ctx.invokeTool = async () => { throw new DOMException("cancelled", "AbortError"); };
	await expect(reader.execute("x", { path: "created.txt", offset: 1 }, undefined, undefined, ctx)).rejects.toThrow("cancelled");
	const late = new AbortController(), lateReason = new DOMException("late", "AbortError");
	ctx.invokeTool = async () => { late.abort(lateReason); return { content: [] }; };
	await expect(reader.execute("x", { path: "created.txt", offset: 1 }, late.signal, undefined, ctx)).rejects.toBe(lateReason);
	ctx.invokeTool = async () => { throw new Error('invokeTool: no native built-in named "read" to delegate to'); };
	await expect(reader.execute("x", { path: "created.txt", offset: 1 }, undefined, undefined, ctx)).rejects.toThrow("invokeTool: no native");
	ctx.invokeTool = undefined;
	await expect(reader.execute("x", { path: "created.txt", offset: 1 }, undefined, undefined, ctx)).rejects.toThrow("Native read is unavailable");
}));

test("the guard compares the native implementations, not the replacement descriptions", async () => {
	for (const [natives, warning] of [
		[engine(), undefined],
		[{ ...engine(), FileType: {} }, "rqw-base-tools: engine FileType.File changed"],
		[{ ...engine(), descriptions: { grep: "changed" } }, "rqw-base-tools: native grep changed description"],
		[{ ...engine(), fields: { read: ["i", "path", "new"] } }, "rqw-base-tools: native read changed fields"],
		[{ ...engine(), schemas: { grep: { ...reference.tools.grep.schema, required: [] } } }, "rqw-base-tools: native grep changed schema"],
	]) {
		const { handlers, ctx, seen } = setup(natives), body = payload();
		await handlers.session_start({}, ctx);
		for (const name of ["grep", "glob", "read"]) Object.assign(tool(body, name), { description: texts[name], input_schema: { properties: {} } });
		await handlers.before_provider_request({ payload: body }, ctx);
		expect(seen).toEqual(warning ? [warning] : []);
	}
});

test("truncated stale context gets no edit tag, even with a complete matching row", () => tmp(async dir => {
	const full = join(dir, "huge.txt"), line = "x".repeat(20000);
	await writeFile(full, `new ${line}\nhit\n`);
	const natives = { ...engine(), grep: async () => ({ matches: [{ path: full, lineNumber: 2, line: "hit", contextBefore: [{ lineNumber: 1, line }] }] }) };
	const { tools, ctx } = setup(natives, undefined, dir), grep = tools.find(t => t.name === "grep");
	ctx.invokeTool = async () => ({ content: [{ type: "text", text: `[${full}#ABCD]` }] });
	const result = (await grep.execute("x", { path: "huge.txt", pattern: "hit", "-B": 1 }, undefined, undefined, ctx)).content[0].text;
	expect(result.length).toBeLessThan(15000);
	expect(result).toContain("[line truncated; use read]");
	expect(result).toContain("[huge.txt]\n  1-");
}));

test("a native notice is handed back once with metadata intact", async () => {
	const { tools, ctx } = setup(), reader = tools.find(t => t.name === "read"), meta = { notice: "\n\n[native notice]" };
	ctx.invokeTool = async () => ({ content: [{ type: "text", text: `native body${meta.notice}` }], details: { meta } });
	const result = await reader.execute("x", { path: "skill://test" }, undefined, undefined, ctx);
	expect(result.content[0].text).toBe("native body");
	expect(result.details.meta).toBe(meta);
});
