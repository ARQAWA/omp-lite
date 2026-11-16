import { expect, test } from "bun:test";
import { realpathSync } from "node:fs";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import plugin from "../../../../src/modules/rqw-base-tools/index.js";
import reference from "../../../../src/modules/rqw-base-tools/rqw-base-tools.reference.json";
import texts from "../../../../src/modules/rqw-base-tools/rqw-base-tools.texts.json";

const yml = Bun.YAML.parse(await Bun.file(new URL("../../../../src/modules/rqw-base-tools/rqw-base-tools.yml", import.meta.url)).text());

// The dry run of the fake engine fails on every file with `bad` in its path.
class EditSession {
	constructor(store) { EditSession.store = store; }
	setArgsJson(json) { this.input = JSON.parse(json).input; }
	finish() {}
	close() {}
	async apply() {
		const bad = /\[(\S*bad[^#\]]*)/.exec(this.input);
		return bad ? { isError: true, text: `no match in ${bad[1]}` } : { isError: false, text: "ok" };
	}
}
// counts: path -> match count
const engine = (paths, counts = {}, searched = paths.length, calls = []) => ({
	calls,
	glob: async options => (calls.push(options), { matches: paths.map(path => ({ path, fileType: 1 })) }),
	grep: async options => (calls.push(options), { filesSearched: searched, matches: Object.entries(counts).map(([path, matchCount]) => ({ path, matchCount })) }),
});
// One fake of OMP: the engine, the settings registry, the approval keys.
function setup(natives = engine([]), current = reference.settings, cwd = "/repo") {
	const handlers = {}, tools = [], seen = [], field = () => ({ optional: field });
	plugin(
		{ zod: { string: field, boolean: field, object: shape => shape }, pi: { settings: current }, on: (name, fn) => (handlers[name] = fn), registerTool: tool => tools.push(tool) },
		async name => name.endsWith("pi-natives") ? { FileType: { File: 1, Dir: 2 }, EditSession, EditStore: class { seen = []; recordSnapshotFile(path) { this.seen.push(path); } }, ...natives }
			: name.endsWith("registry") ? { lookup: key => ({ get: all => all[key] }) }
			: { approvalDirectoryKey: dir => `${dir}/`, approvalTreeSearchKey: key => `tree ${key}` },
	);
	const ctx = { cwd, agent: { kind: "main" }, ui: { notify: message => seen.push(message) }, sessionManager: { getSessionId: () => "one", getCwd: () => cwd } };
	const files = async params => (await tools[0].execute("id", params, undefined, undefined, ctx)).content[0].text;
	return { handlers, tool: tools[0], files, seen, ctx };
}
const small = { ...reference.settings, "tools.artifactSpillThreshold": 6 }; // a 1 KB answer budget
const tmp = async run => {
	const dir = realpathSync(await mkdtemp(join(tmpdir(), "rqw-base-tools-")));
	try { await run(dir); } finally { await rm(dir, { recursive: true }); }
};

// ---- files ----

test("the tool is always visible, read-only, with six optional fields", () => {
	const { tool } = setup();
	expect(tool).toMatchObject({ name: "files", loadMode: "essential", approval: "read", description: texts.files });
	expect(Object.keys(tool.parameters).sort()).toEqual(["case", "gitignore", "glob", "hidden", "path", "pattern"]);
});

test("the map names every file by directory and hides node_modules", async () => {
	const natives = engine(["top.txt", "src/b.ts", "/repo/src/a.ts", "src/deep/c.ts", "node_modules/x.js", "node_modules_backup/y.js"]);
	const { files } = setup(natives);
	expect(await files({})).toBe("total 5 files\ntop.txt\nnode_modules_backup/\n  y.js\nsrc/\n  a.ts\n  b.ts\nsrc/deep/\n  c.ts\n[all 5 files listed]");
	expect(natives.calls[0]).toMatchObject({ pattern: "**/*", path: "/repo", hidden: true, gitignore: true, includeNodeModules: false });
	await files({ path: "src", glob: "*.ts", hidden: false, gitignore: false });
	expect(natives.calls[1]).toMatchObject({ pattern: "*.ts", path: "/repo/src", hidden: false, gitignore: false });
});

test("a map over the budget folds deep directories; one that cannot fit goes out whole", async () => {
	const deep = Array.from({ length: 150 }, (_, i) => `src/d${i % 30}/f${i}.ts`), flat = Array.from({ length: 300 }, (_, i) => `file${i}.ts`);
	const text = await setup(engine(deep), small).files({});
	const [, listed, folded] = /^\[150 files: (\d+) listed, the rest folded into (\d+) directories\]$/.exec(text.split("\n").at(-1));
	expect(Buffer.byteLength(text)).toBeLessThanOrEqual(1024);
	expect(+listed + 5 * folded).toBe(150);
	expect(text).toContain("src/d29/ (5 files)");
	const whole = await setup(engine(flat), small).files({});
	expect(Buffer.byteLength(whole)).toBeGreaterThan(1024);
	expect(whole.split("\n").at(-1)).toBe("[all 300 files listed]");
});

test("a search lists files by match count", async () => {
	const natives = engine(["a.ts", "src/b.ts", "src/c.bin", "node_modules/n.js"], { "a.ts": 1, "src/b.ts": 3, "node_modules/n.js": 9 }, 2);
	const lines = (await setup(natives).files({ pattern: "one\\ntwo|x", case: false, glob: "**/*" })).split("\n");
	expect(lines[0]).toBe("2 files, 4 matches, searched 2 of 3 files");
	expect(lines.slice(1)).toEqual(["src/b.ts (3 matches)", "a.ts (1 match)", "[all 2 files listed]"]);
	expect(natives.calls[1]).toMatchObject({ mode: "count", pattern: "one\\ntwo|x", ignoreCase: true, multiline: true, glob: "**/*" });
	expect(natives.calls).toHaveLength(2);
	expect(await setup(engine(["a.ts"])).files({ pattern: "zzz" })).toBe("0 files, 0 matches, searched 1 of 1 files\nNo files matched.\n[all 0 files listed]");
});

test("a long search tail folds by directory and the counts add up", async () => {
	const counts = Object.fromEntries(Array.from({ length: 100 }, (_, i) => [`src/d${i % 10}/f${i}.ts`, 1]));
	const text = await setup(engine(Object.keys(counts), counts), small).files({ pattern: "x" });
	const [, listed] = /^\[100 files: (\d+) listed, the rest folded into \d+ directories\]$/.exec(text.split("\n").at(-1));
	const folded = [...text.matchAll(/^src\/d\d\/ \((\d+) files, \d+ matches\)$/gm)].reduce((sum, hit) => sum + +hit[1], 0);
	expect(Buffer.byteLength(text)).toBeLessThanOrEqual(1024);
	expect(+listed + folded).toBe(100);
});

test("a list that fits whole is not folded", async () => {
	const full = "1 files, 1 matches, searched 1 of 1 files\nd/a (1 match)\n[all 1 files listed]";
	const exact = { ...reference.settings, "tools.artifactSpillThreshold": 5 + full.length / 1024 };
	expect(await setup(engine(["d/a"], { "d/a": 1 }), exact).files({ pattern: "x" })).toBe(full);
});

test("a mask that matches a directory takes all its files", async () => {
	// The directory name has mask characters: it is walked by path.
	const natives = {
		...engine([], { "src[1]/a.ts": 1 }, 1),
		glob: async ({ pattern, path }) => ({ matches: path === "/repo" && pattern === "src*" ? [{ path: "src[1]", fileType: 2 }] : /^(\*\*\/\*|src\/\*\*)$/.test(pattern) && path === "/repo/src[1]" ? [{ path: "a.ts", fileType: 1 }] : [] }),
	};
	// A mask that ends with a separator is the directory with all inside it.
	for (const [glob, path] of [["src*"], ["src/", "src[1]"], ["src\\", "src[1]"]]) expect((await setup(natives).files({ pattern: "x", glob, path })).split("\n")[0]).toBe("1 files, 1 matches, searched 1 of 1 files");
	expect(natives.calls.at(-1).glob).toBe("src/**");
});

test("a real file over 4 MiB is named; links and hidden files the engine read are not counted", () => tmp(async dir => {
	await mkdir(join(dir, "node_modules"));
	await writeFile(join(dir, "big.ts"), Buffer.alloc(5 * 1024 * 1024, "a"));
	for (const name of ["small.ts", "node_modules/n.js"]) await writeFile(join(dir, name), "a");
	for (const name of ["link.ts", "node_modules/link.js"]) await symlink(join(dir, "small.ts"), join(dir, name));
	// The engine read three files: big.ts, small.ts and the hidden n.js.
	const natives = engine(["big.ts", "small.ts", "link.ts", "node_modules/n.js", "node_modules/link.js"], { "big.ts": 1 }, 3);
	const text = await setup(natives, undefined, dir).files({ pattern: "a" });
	expect(text.split("\n").slice(0, 2)).toEqual(["1 files, 1 matches, searched 2 of 2 files", "searched in part (first 4 MiB): big.ts"]);
}));

test("errors: a blank pattern, an engine failure, the 30-second deadline; a node_modules or .git root is empty", async () => {
	const failing = { glob: async () => { throw new Error("boom"); } }, now = Date.now;
	expect(await setup().files({ pattern: "  " })).toBe("files: pattern must not be empty");
	expect(await setup(failing).files({})).toBe("files: boom. Narrow path and try again.");
	for (const path of ["node_modules", ".git/hooks"]) expect(await setup(failing).files({ path })).toBe("total 0 files\n[all 0 files listed]");
	expect(await setup(failing).files({ path: "node_modules", pattern: "x" })).toBe("0 files, 0 matches, searched 0 of 0 files\nNo files matched.\n[all 0 files listed]");
	try {
		const slow = { ...engine(["a.ts"]), glob: async () => (Date.now = () => now() + 31000, { matches: [] }) };
		for (const pattern of ["x", undefined]) {
			Date.now = now;
			expect(await setup(slow).files({ pattern })).toBe("files: timed out after 30s. Narrow path and try again.");
		}
	} finally {
		Date.now = now;
	}
});

test("the approval target is the real search root as a tree; a link into .git is hidden", () => tmp(async dir => {
	for (const [name, link] of [["src", "link"], [".git", "gitlink"]]) {
		await mkdir(join(dir, name));
		await symlink(join(dir, name), join(dir, link));
	}
	expect(await setup(engine(["x"]), undefined, dir).files({ path: "gitlink" })).toStartWith("total 0 files");
	const { handlers, tool, ctx } = setup(undefined, undefined, dir);
	expect(tool.approvalCacheTargets({})).toBeUndefined();
	await handlers.session_start({}, ctx);
	expect([{}, { path: "link" }, { path: "missing" }].map(tool.approvalCacheTargets)).toEqual([[`tree ${dir}/`], [`tree ${dir}/src/`], [`tree ${dir}/missing/`]]);
}));

// ---- texts and guard ----

// A request with the native tools of the reference, in the flat (Claude) form.
const payload = () => ({
	messages: [{ role: "assistant", content: [{ type: "tool_use", name: "files", input: {} }] }],
	tools: Object.entries(reference.tools).map(([name, { description, fields }]) => ({ name, description, input_schema: { properties: Object.fromEntries(fields.map(field => [field, {}])) } })),
});
const tool = (body, name) => body.tools.find(entry => entry.name === name);
// Our six texts. pick: 0 with `files`, 1 without it. A native part comes from the native description.
const ours = pick => Object.entries(reference.tools).map(([name, { description }]) => [].concat(texts.native[name])
	.map(part => typeof part === "string" ? part : part.native ? description.slice(description.indexOf(part.native)) : part[pick]).join(""));

test("six native descriptions become ours; schemas and messages stay", async () => {
	const { handlers, ctx, seen } = setup(), body = payload(), before = JSON.stringify([body.messages, body.tools.map(entry => entry.input_schema)]);
	for (const entry of body.tools) entry.name = `_${entry.name}`;
	expect(await handlers.before_provider_request({ payload: body }, ctx)).toBe(body);
	expect(body.tools.map(entry => entry.description)).toEqual(ours(1));
	expect(JSON.stringify([body.messages, body.tools.map(entry => entry.input_schema)])).toBe(before);
	expect(JSON.stringify(body.tools)).not.toContain("`files`");
	expect(seen).toEqual([]);
});

test("with files and another builtins list: the nested form is rewritten once", async () => {
	const { handlers, ctx, seen } = setup(), flat = payload();
	tool(flat, "bash").description = tool(flat, "bash").description.replace(/(ahead of PATH: ).*/, "$1awk");
	const body = { tools: [...flat.tools, { name: "files", description: texts.files }].map(entry => ({ type: "function", function: entry })) };
	await handlers.before_provider_request({ payload: body }, ctx);
	const once = JSON.stringify(body);
	expect(flat.tools.map(entry => entry.description)).toEqual(ours(0).map(text => text.replace(/(ahead of PATH: ).*/, "$1awk")));
	await handlers.before_provider_request({ payload: body }, ctx);
	expect(JSON.stringify(body)).toBe(once);
	expect(seen).toEqual([]);
});

test("a native text without its marker is kept whole, and a second pass adds nothing", async () => {
	const { handlers, ctx } = setup(), body = payload();
	tool(body, "bash").description = "new native text";
	await handlers.before_provider_request({ payload: body }, ctx);
	await handlers.before_provider_request({ payload: body }, ctx);
	expect(tool(body, "bash").description).toBe(ours(1)[Object.keys(reference.tools).indexOf("bash")].split("Persistent bash")[0] + "new native text");
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
		expect(list.map(entry => entry.description)).toEqual(ours(1));
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
		[() => {}, "engine grep changed", { ...engine([]), grep: undefined }],
		[body => (tool(body, "edit").input_schema.properties = { definition: {}, syntax: {}, type: {} })],
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
		expect(tool(body, "grep").description).toBe(ours(1)[Object.keys(reference.tools).indexOf("grep")]);
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

const patch = (...sections) => `${sections.join("\n")}\n`;
const a = "[a.txt#AAAA]\nPUT 1.=1:\n+new", bad = "[bad.txt#BBBB]\nPUT 9.=9:\n+new", alias = "[./bad.txt#BBBB]\nREM", c = "[m.txt]\nREM", bad2 = "[bad2.txt#DDDD]\nREM";
const call = (input, toolName = "edit") => ({ toolName, toolCallId: "one", input: { input } });
const result = more => ({ toolName: "edit", toolCallId: "one", isError: false, content: [{ type: "text", text: "Success." }], ...more });
const note = [texts.skipped.head, "[bad.txt]: no match in bad.txt", texts.skipped.section, `${bad}\n${alias}`, texts.skipped.tail].join("\n");
// A folder with the files the patches change.
const repo = (run, natives) => tmp(async dir => {
	for (const name of ["a.txt", "bad.txt", "bad2.txt", "m.txt"]) await writeFile(join(dir, name), "old");
	await run(setup(natives, undefined, dir), dir);
});

test("a file that does not match is left out whole; the answer is an error with a note and a red entry", () => repo(async ({ handlers, ctx }, dir) => {
	const done = { path: "/repo/a.txt", diff: "+new" }, failed = { path: join(dir, "bad.txt"), diff: "", isError: true, errorText: "no match in bad.txt" };
	for (const [name, details, written] of [["edit", { diff: "d", firstChangedLine: 3, perFileResults: [done] }, done], ["_edit", undefined]]) {
		expect(await handlers.tool_call(call(`*** Begin Patch\n${patch(a, bad, c, alias)}*** End Patch`, name), ctx)).toEqual({ input: { input: patch(a, c) } });
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
}));

test("a native failure after the cut keeps its error and details behind the note", () => repo(async ({ handlers, ctx }) => {
	const details = { diff: "", errorKind: "parse" };
	await handlers.tool_call(call(patch(a, bad, alias)), ctx);
	expect(handlers.tool_result(result({ isError: true, content: [{ type: "text", text: "boom" }], details }))).toEqual({ isError: true, content: [{ type: "text", text: `${note}\nboom` }], details });
}));

test("the native edit gets the patch as it is in every other case", async () => {
	const broken = { ...engine([]), EditSession: class { constructor() { throw new Error("engine changed"); } } };
	const same = [
		[patch(a, c)], [patch(bad, alias)], [patch(bad, bad2)], [`x\n${patch(a, bad)}`], [undefined], [patch(a, bad), "write"], [patch(a, bad), "edit", broken],
		// The engine may find a missing file elsewhere by its name.
		[patch(a, bad, "[gone.txt#EEEE]\nREM")],
		// A move between files: the source must not be cut without the paste. A renamed file may land on a skipped one.
		[patch("[a.txt#AAAA]\nCUT 1.=1", "[m.txt]\nPUT <1", bad)], [patch(a, bad, "[m.txt]\nPUT <1 @name")], [patch("[a.txt#AAAA]\nMV bad.txt", bad)],
		// The native edit ignores the rows after the end of a patch.
		[`${patch(bad)}*** End Patch\n${c}`],
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

test("the dry run gets the files that a read showed or an edit wrote", () => repo(async ({ handlers, ctx }) => {
	await handlers.session_start({}, ctx);
	handlers.tool_result(read({ meta: { source: { type: "path", value: "/r.txt" } } }));
	handlers.tool_result(result({ details: { path: "/e.txt" } }));
	await handlers.tool_call(call(patch(a, bad)), ctx);
	expect(EditSession.store.seen).toEqual(["/r.txt", "/e.txt"]);
}));

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
