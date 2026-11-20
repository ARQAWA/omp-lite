// RQW Base Tools: texts for the native OMP tools, a guard and per-file patches.
// Marked workaround: the OMP edit engine is imported from an extension.
// OMP has no standard way for it; the guard checks these exports.

import { existsSync, readFileSync, realpathSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import reference from "./rqw-base-tools.reference.json";
import texts from "./rqw-base-tools.texts.json";

const DRY_RUN_MS = 10000, MAX_FILE_BYTES = 4 * 1024 * 1024;
const NATIVES = "@oh-my-pi/pi-natives", REGISTRY = "@oh-my-pi/pi-coding-agent/config/registry";
// OMP resolves its own packages for an extension only when the specifier is written out.
const MODULES = {
	[NATIVES]: () => import("@oh-my-pi/pi-natives"),
	[REGISTRY]: () => import("@oh-my-pi/pi-coding-agent/config/registry"),
};
// The file the engine works on: links resolved as far as the path exists.
const real = path => {
	try { return realpathSync.native(path); } catch {}
	const up = dirname(path);
	return up === path ? path : join(real(up), basename(path));
};
const settings = async (pi, load, keys) => {
	try {
		const { lookup } = await load(REGISTRY);
		return Object.fromEntries(keys.map(key => [key, lookup(key)?.get(pi.pi.settings)]));
	} catch {}
};

// ---- texts and guard ----

const canon = name => name.replace(/^_/, "");
// Every wire form: flat, nested `function`, Google `functionDeclarations`, Bedrock `toolSpec`. With inline tool descriptors
// OMP sends no descriptions and keeps the native texts in the system prompt: nothing to check or replace.
const toolsOf = payload => [payload, payload?.tools, payload?.functions, payload?.config?.tools, payload?.request?.tools, payload?.toolConfig?.tools].filter(Array.isArray).flat()
	.flatMap(tool => tool?.functionDeclarations ?? [tool?.function ?? tool?.toolSpec ?? tool]).filter(tool => typeof tool?.name === "string" && tool.description);
// OMP lists its shell builtins in bash (prompts/tools/bash.md): the list follows the platform, not a change.
// In the hashline mode `read` gets one more line (prompts/tools/read.md, IS_HL_MODE).
const BUILTINS = /^In-process builtins, ahead of PATH: .*$|^- Selected file: .*\n/m;
const native = text => String(text).replace(BUILTINS, "").trim();

/** The first native tool or setting that moved away from the reference. */
function checkReference(tools, current, isChild) {
	const byName = new Map(tools.map(tool => [canon(tool.name), tool]));
	for (const [name, want] of Object.entries(reference.tools)) {
		const tool = byName.get(name);
		// A subagent may run without some tools.
		if (!tool && isChild) continue;
		if (!tool) return `rqw-base-tools: native ${name} is missing`;
		// `alt`: the other native forms, by edit mode and by model.
		const forms = [want, ...(want.alt ?? [])];
		if (!forms.some(form => form.description && native(tool.description) === native(form.description))) return `rqw-base-tools: native ${name} changed description`;
		// Apple and Devin send the schema as a JSON string.
		const schema = tool.parameters ?? tool.input_schema ?? tool.inputSchema?.json ?? tool.inputSchema ?? tool.parametersJsonSchema ?? tool.jsonSchemaString;
		const fields = Object.keys((typeof schema === "string" ? JSON.parse(schema) : schema)?.properties ?? tool.format ?? {}).sort().join();
		if (!forms.some(form => fields === form.fields?.join())) return `rqw-base-tools: native ${name} changed fields`;
	}
	for (const [key, want] of Object.entries(current ? reference.settings : {})) {
		if (current[key] !== want) return `rqw-base-tools: setting ${key} changed`;
	}
}

async function checkEngine(load) {
	try {
		const natives = await load(NATIVES);
		for (const [name, kind] of Object.entries(reference.engine)) {
			if (typeof name.split(".").reduce((value, member) => value?.[member], natives) !== kind) return `rqw-base-tools: engine ${name} changed`;
		}
	} catch {
		return "rqw-base-tools: engine import failed";
	}
}

function rewrite(tools) {
	// A last part `{ native: marker }` is the live native text from the marker on: OMP's own lines stay OMP's.
	for (const tool of tools) {
		// OMP gives some models `edit` in the replace mode: it has its own text.
		const text = tool.description, name = canon(tool.name) === "edit" && text.includes("old_string") ? "replace" : canon(tool.name);
		if (!Object.hasOwn(texts.native, name)) continue;
		const parts = [].concat(texts.native[name]), marker = parts.at(-1).native;
		const own = parts.filter(part => typeof part === "string").join("");
		// A description that already starts with our text is ours: a second pass changes nothing.
		if (!marker) tool.description = own;
		else if (!text.startsWith(own)) tool.description = own + text.slice(Math.max(text.indexOf(marker), 0));
	}
}

// ---- per-file patches ----

const SECTION = /^\s*\[([^\]\n#]+)(?:#[^\]\n]*)?\]\s*$/;
const wrap = sections => sections.flatMap(section => section.lines).join("\n");

/** File sections of a hashline patch, without the optional envelope; empty when the input is not plain sections. */
function splitPatch(input) {
	const sections = [];
	// Body rows keep their spaces: only the envelope rows go.
	for (const line of input.replace(/^\s*\*\*\* Begin Patch[ \t]*\n/, "").replace(/\n\*\*\* End Patch\s*$/, "").split("\n")) {
		const path = SECTION.exec(line)?.[1].trim();
		if (path !== undefined) sections.push({ path, lines: [] });
		// The native parser stops at a marker row inside the patch and reads other header forms: no split then.
		else if (/^\s*(?:\[|\*\*\*)/.test(line) || (!sections.length && line.trim())) return [];
		sections.at(-1)?.lines.push(line);
	}
	return sections;
}

/** Leaves out the files that fail a dry run. Undefined: the patch goes to the native edit as it is. */
async function partialPatch(input, cwd, dry) {
	// One file under two names, a link too, is one file.
	const sections = splitPatch(input).map(section => ({ ...section, full: real(resolve(cwd, section.path)) })), key = section => section.full;
	const paths = [...new Set(sections.map(key))];
	// Only the native edit resolves a URL target and finds a missing file elsewhere by its name.
	// A paste takes its text from a cut of the whole patch or of the session; a move writes one more file;
	// the dry run of a removal drops the snapshots of the file; a notebook is edited as cells, not as its file text:
	// such a patch is not split.
	if (paths.length < 2 || /^\s*(?:(?:MV|REM)\b|PUT\b.*[^:\s]\s*$)/m.test(input) || sections.some(section => section.full.endsWith(".ipynb") || !existsSync(section.full))) return;
	const whole = await dry(input);
	if (!whole.isError || whole.errorKind === "parse") return;
	const skipped = [];
	for (const full of paths) {
		const own = sections.filter(section => key(section) === full), patch = wrap(own), outcome = await dry(patch);
		// A section that changes nothing passes alone, but the native edit rejects the whole patch for it.
		if (outcome.isError || outcome.files?.some(file => !file.diff)) {
			const reason = outcome.errorKind === "unseen_lines" ? "The section anchors lines not shown in full. Re-read those lines before resending."
				: /^(?:stale|unknown|other_file|missing)_tag$/.test(outcome.errorKind ?? "") ? "The tag or anchor did not match. Re-read the file before resending."
				: !outcome.isError || outcome.errorKind === "no_change" ? "The section makes no changes." : outcome.text.replace(/\nNo files were modified[\s\S]*/, "");
			skipped.push({ path: own[0].path, full, reason, patch });
		}
	}
	if (!skipped.length || skipped.length === paths.length) return;
	return { input: wrap(sections.filter(section => !skipped.some(entry => entry.full === key(section)))), skipped };
}

// One staging pass of the native edit engine; the writer keeps the disk untouched. `store`: the snapshots of the
// files that a read or grep showed or an edit wrote; with them the engine accepts an older tag, as the session does.
async function dryRunner(pi, load, cwd, store) {
	const natives = await load(NATIVES), edit = await settings(pi, load, ["edit.fuzzyMatch", "edit.fuzzyThreshold", "edit.blockAutoGenerated", "edit.enforceSeenLines", "tools.outputMaxColumns"]);
	const policy = {
		cwd, mode: "hashline", allowFuzzy: edit["edit.fuzzyMatch"], fuzzyThreshold: edit["edit.fuzzyThreshold"],
		blockAutoGenerated: edit["edit.blockAutoGenerated"], enforceSeenLines: edit["edit.enforceSeenLines"] !== false,
		maxColumns: edit["tools.outputMaxColumns"] > 0 ? Math.min(512, edit["tools.outputMaxColumns"]) : 512, planActive: false,
		urlSchemes: [], urlAliasSchemes: [], planWritableRoots: [], homeDir: homedir(), rawInput: false,
	};
	return async input => {
		const trial = new natives.EditStore();
		for (const section of splitPatch(input)) {
			const tag = /#([0-9A-F]{4})\]$/i.exec(section.lines[0])?.[1], path = real(resolve(cwd, section.path));
			const text = tag && store?.byHashText(path, tag);
			if (text != null) trial.recordSnapshot(path, text, store.seenLines(path, tag));
		}
		const session = new natives.EditSession(trial, policy);
		try {
			session.setArgsJson(JSON.stringify({ input }));
			session.finish();
			return await session.apply({ lspFlush: false }, async (_error, request) => ({ written: request.content ?? "" }));
		} finally {
			session.close();
		}
	};
}

// The note goes first and the answer is an error. A native success gets one red
// card entry per skipped file; a native failure keeps its own details.
function skippedResult(event, skipped) {
	const { head, section, tail } = texts.skipped;
	const note = [head, ...skipped.flatMap(({ path, reason, patch }) => [`[${path}]: ${reason}`, section, patch]), tail].join("\n");
	const isText = block => block.type === "text", details = event.details;
	if (event.isError) return {
		content: [{ type: "text", text: [note, ...event.content.filter(isText).map(block => block.text)].join("\n") }, ...event.content.filter(block => !isText(block))],
		isError: true,
		details,
	};
	const failed = skipped.map(({ full, reason }) => ({ path: full, diff: "", isError: true, errorText: reason }));
	return {
		content: [{ type: "text", text: note }, ...event.content],
		isError: true,
		details: { diff: details?.diff ?? "", firstChangedLine: details?.firstChangedLine, perFileResults: [...(details?.perFileResults ?? (details ? [details] : [])), ...failed] },
	};
}

// The rows a native read or grep showed, or an edit answered with, go to the store of the dry run.
// Headers: `[path#TAG]` of read and edit, the `# dir/` … `### file#TAG` tree of grep.
function recordShown(store, natives, cwd, content) {
	if (!store || !natives) return;
	const dirs = [];
	let file;
	const open = (path, tag) => {
		const full = real(resolve(cwd, path)), info = statSync(full, { throwIfNoEntry: false });
		if (!info?.isFile() || info.size > MAX_FILE_BYTES) return;
		const source = readFileSync(full, "utf8");
		if (natives.hashlineFileHash(source) === tag) return { full, source, rows: source.replace(/^\uFEFF/, "").replace(/\r\n/g, "\n").split("\n"), seen: [0] };
	};
	const close = () => file && store.recordSnapshot(file.full, file.source, file.seen);
	for (const line of content.filter(block => block.type === "text").map(block => block.text).join("\n").split("\n")) {
		const flat = /^\[([^\]#]+)#([0-9A-F]{4})\]$/.exec(line), tree = !flat && /^(#+) (.*?)(?:#([0-9A-F]{4}))?$/.exec(line);
		if (flat || tree?.[3]) {
			close();
			file = flat ? open(flat[1], flat[2]) : open(join(...dirs.slice(0, tree[1].length - 1), tree[2]), tree[3]);
		} else if (tree) {
			dirs.length = tree[1].length - 1;
			dirs.push(tree[2]);
		} else {
			const row = file && /^\s*\*?(\d+):(.*)$/.exec(line), number = Number(row?.[1]);
			if (row && file.rows[number - 1] === row[2]) file.seen.push(number);
		}
	}
	close();
}

/** `load` imports an OMP module; tests replace it. */
export default function rqwBaseTools(pi, load = name => MODULES[name]()) {
	let session, store, natives;
	pi.on("session_start", async (_event, ctx) => {
		session = ctx.sessionManager;
		natives = await load(NATIVES).catch(() => undefined);
		store = natives && new natives.EditStore();
	});

	// Only tool definitions change: messages stay as they are.
	const checked = new Set();
	pi.on("before_provider_request", async (event, ctx) => {
		const tools = toolsOf(event.payload), id = ctx.sessionManager?.getSessionId();
		if (tools.length && !checked.has(id)) {
			checked.add(id);
			const moved = checkReference(tools, await settings(pi, load, Object.keys(reference.settings)), ctx.agent?.kind === "sub") ?? await checkEngine(load);
			if (moved) ctx.ui?.notify?.(moved, "warning");
		}
		rewrite(tools);
		return event.payload;
	});

	const skips = new Map();
	// A call that was denied or cancelled gets no result: its entry goes when the call ends.
	pi.on("tool_execution_end", event => skips.delete(event.toolCallId));
	pi.on("tool_call", async (event, ctx) => {
		const input = event.input?.input;
		skips.delete(event.toolCallId);
		if (canon(event.toolName) !== "edit" || typeof input !== "string") return;
		// Fail open: an error or a slow dry run leaves the patch to the native edit.
		const partial = await Promise.race([
			dryRunner(pi, load, ctx.cwd, store).then(dry => partialPatch(input, ctx.cwd, dry)).catch(() => {}),
			new Promise(done => setTimeout(done, DRY_RUN_MS).unref()),
		]);
		if (!partial) return;
		skips.set(event.toolCallId, partial.skipped);
		return { input: { input: partial.input } };
	});
	pi.on("tool_result", (event, ctx) => {
		const skipped = skips.get(event.toolCallId), details = event.details, name = canon(event.toolName);
		if (!event.isError && ["read", "grep", "edit"].includes(name)) try {
			for (const entry of name === "edit" ? details?.perFileResults ?? [details] : []) {
				entry?.sourcePath && store?.relocate(entry.sourcePath, entry.path);
				if (entry?.path) store?.recordSnapshotFile(entry.path, [0]);
			}
			recordShown(store, natives, ctx?.cwd ?? session?.getCwd(), event.content);
		} catch {}
		if (skips.delete(event.toolCallId)) return skippedResult(event, skipped);
	});
}
