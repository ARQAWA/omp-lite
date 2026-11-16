// RQW Base Tools: the `files` tool, our texts for six native tools, a guard,
// per-file patches and the whole-file mark.
// Marked workaround: the OMP engine (`@oh-my-pi/pi-natives`) is imported from an
// extension. OMP has no standard way for it; the guard checks these exports.

import { constants, existsSync, readFileSync, realpathSync, statSync } from "node:fs";
import { access, lstat } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, join, relative, resolve } from "node:path";
import reference from "./rqw-base-tools.reference.json";
import texts from "./rqw-base-tools.texts.json";

const TIMEOUT_MS = 30000, DRY_RUN_MS = 10000, MAX_FILE_BYTES = 4 * 1024 * 1024, RESERVE_KB = 5;
const NATIVES = "@oh-my-pi/pi-natives", OMP = "@oh-my-pi/pi-coding-agent/", SPILL = "tools.artifactSpillThreshold";
// OMP resolves its own packages for an extension only when the specifier is written out.
const MODULES = {
	[NATIVES]: () => import("@oh-my-pi/pi-natives"),
	[`${OMP}config/registry`]: () => import("@oh-my-pi/pi-coding-agent/config/registry"),
	[`${OMP}tools/approval-cache`]: () => import("@oh-my-pi/pi-coding-agent/tools/approval-cache"),
	[`${OMP}tools/approval-targets`]: () => import("@oh-my-pi/pi-coding-agent/tools/approval-targets"),
};
const size = text => Buffer.byteLength(text);
const slashes = path => path.replace(/\\/g, "/");
const rel = (root, path) => slashes(relative(root, resolve(root, path)));
// A file is hidden when one of its directories is `node_modules` or `.git`.
const hidden = (path, isDir) => path.split("/").slice(0, isDir ? undefined : -1).some(part => part === "node_modules" || part === ".git");
// The file the engine works on: links resolved as far as the path exists.
const real = path => {
	try { return realpathSync.native(path); } catch {}
	const up = dirname(path);
	return up === path ? path : join(real(up), basename(path));
};
const answer = (text, isError) => ({ content: [{ type: "text", text }], details: undefined, ...(isError && { isError }) });
const settings = async (pi, load, keys) => {
	try {
		const { lookup } = await load(`${OMP}config/registry`);
		return Object.fromEntries(keys.map(key => [key, lookup(key)?.get(pi.pi.settings)]));
	} catch {}
};

// ---- files ----

/**
 * Every file under `root` that the mask selects. A matched directory gives all its files, as in grep.
 * `skipped`: hidden files the engine may still search when the mask names node_modules.
 */
async function scan(natives, root, params, signal, left) {
	const dirType = natives.FileType?.Dir ?? 2, files = new Set(), skipped = new Set(), mask = params.glob || "**/*";
	const take = async (pattern, base, deep) => {
		const result = await natives.glob({
			pattern, path: base, hidden: params.hidden !== false, gitignore: params.gitignore !== false,
			includeNodeModules: mask.includes("node_modules"), timeoutMs: left(), signal,
		});
		for (const match of result?.matches ?? []) {
			const full = resolve(base, match.path), path = rel(root, full);
			// A matched directory is walked by its path: its name is not a mask.
			if (match.fileType === dirType) deep && await take("**/*", full, false);
			else (hidden(path) ? skipped : files).add(path);
		}
	};
	// Masks ending in `**` already cover every descendant.
	await take(mask, root, !/(^|\/)\*\*(\/\*)?$/.test(mask));
	return { files: [...files].sort((a, b) => a.localeCompare(b)), skipped: [...skipped] };
}

/** The map under `budget` bytes: deep directories fold first. A folded map still over budget goes out whole. */
function renderMap(files, budget) {
	const groups = new Map();
	for (const file of files) {
		const at = file.lastIndexOf("/"), dir = file.slice(0, Math.max(at, 0));
		if (!groups.has(dir)) groups.set(dir, { dir, names: [] });
		groups.get(dir).names.push(file.slice(at + 1));
	}
	const blocks = [...groups.values()].sort((a, b) => a.dir.localeCompare(b.dir));
	for (const block of blocks) block.lines = block.dir ? [`${block.dir}/`, ...block.names.map(name => `  ${name}`)] : block.names;
	const header = `total ${files.length} files`, depth = block => block.dir.split("/").length;
	let folded = 0, listed = files.length, bytes = size(header) + 1 + blocks.reduce((sum, block) => sum + size(block.lines.join("\n")) + 1, 0);
	const footer = () => folded ? `[${files.length} files: ${listed} listed, the rest folded into ${folded} directories]` : `[all ${files.length} files listed]`;
	for (const block of blocks.filter(block => block.dir).sort((a, b) => depth(b) - depth(a) || b.dir.localeCompare(a.dir))) {
		if (bytes + size(footer()) <= budget) break;
		const label = `${block.dir}/ (${block.names.length} files)`;
		bytes += size(label) - size(block.lines.join("\n"));
		block.lines = [label];
		folded++;
		listed -= block.names.length;
	}
	return [header, ...blocks.flatMap(block => block.lines), footer()].join("\n");
}

/** Search results by match count. The tail folds by directory, then by top-level directory. */
function renderSearch(entries, head, budget) {
	const sorted = [...entries].sort((a, b) => b.count - a.count || a.path.localeCompare(b.path)), total = sorted.length;
	if (!total) return [...head, "No files matched.", "[all 0 files listed]"].join("\n");
	const lines = sorted.map(entry => `${entry.path} (${entry.count} ${entry.count === 1 ? "match" : "matches"})`);
	const dirOf = (path, top) => top ? path.split("/")[0] : path.slice(0, path.lastIndexOf("/"));
	const label = (dir, [files, matches]) => `${dir}/ (${files} files, ${matches} matches)`;
	const footer = (listed, dirs) => dirs ? `[${total} files: ${listed} listed, the rest folded into ${dirs} directories]` : `[all ${total} files listed]`;
	for (const top of [false, true]) {
		// Files leave the list one by one, from the end. Root files stay listed. The size is a running sum.
		const groups = new Map(), root = [];
		let bytes = [...head, ...lines].reduce((sum, line) => sum + size(line) + 1, 0);
		for (let listed = total; ; listed--) {
			if (bytes + size(footer(listed + root.length, groups.size)) <= budget || (top && !listed)) {
				const dirs = [...groups].sort((a, b) => b[1][1] - a[1][1] || a[0].localeCompare(b[0])).map(group => label(...group));
				return [...head, ...lines.slice(0, listed), ...root, ...dirs, footer(listed + root.length, groups.size)].join("\n");
			}
			if (!listed) break;
			const { path, count } = sorted[listed - 1], line = lines[listed - 1];
			if (!path.includes("/")) {
				root.unshift(line);
				continue;
			}
			const dir = dirOf(path, top), group = groups.get(dir) ?? [0, 0], next = [group[0] + 1, group[1] + count];
			bytes += size(label(dir, next)) - size(line) - (group[0] && size(label(dir, group)) + 1);
			groups.set(dir, next);
		}
	}
}

async function runFiles(params, cwd, load, pi, signal) {
	const { pattern } = params;
	// A mask that ends with a separator is a directory with all inside it, for the map and for the search.
	params = { ...params, glob: params.glob?.replace(/[\\/]+$/, "/**") };
	if (pattern !== undefined && !pattern.trim()) return answer("files: pattern must not be empty", true);
	// The real root: a link into `.git` or `node_modules` is hidden too.
	const root = real(resolve(cwd, params.path ?? "")), deadline = Date.now() + TIMEOUT_MS;
	const left = () => {
		const ms = deadline - Date.now();
		if (ms <= 0) throw new Error("timed out after 30s");
		return ms;
	};
	try {
		// A root inside node_modules stays hidden: an empty answer, no engine.
		const natives = hidden(slashes(root), true) ? undefined : await load(NATIVES);
		const { files, skipped } = natives ? await scan(natives, root, params, signal, left) : { files: [], skipped: [] };
		const budget = (((await settings(pi, load, [SPILL]))?.[SPILL] ?? 50) - RESERVE_KB) * 1024;
		// The deadline covers the whole call: a late answer is an error too.
		const done = text => (left(), answer(text));
		if (pattern === undefined) return done(renderMap(files, budget));
		let scope = 0, lost = 0;
		const big = [], stat = async path => {
			const full = resolve(root, path), info = await lstat(full).catch(() => undefined);
			return { info, readable: () => access(full, constants.R_OK).then(() => true, () => false) };
		};
		for (let i = 0; i < files.length; i += 64, left()) await Promise.all(files.slice(i, i + 64).map(async path => {
			const { info, readable } = await stat(path);
			// Symbolic links are not searched.
			if (info && !info.isFile()) return;
			scope++;
			if (info?.size > MAX_FILE_BYTES && await readable()) big.push(path);
		}));
		// The engine counts the hidden files it read: only those leave `K`.
		for (const path of skipped) {
			const { info, readable } = await stat(path);
			if (info?.isFile() && await readable()) lost++;
		}
		const grep = {
			pattern, path: root, ignoreCase: params.case === false, hidden: params.hidden !== false, gitignore: params.gitignore !== false, signal,
			...(params.glob && { glob: params.glob }), ...(/\n|\\n/.test(pattern) && { multiline: true }),
		};
		const counts = natives && await natives.grep({ ...grep, mode: "count", timeoutMs: left() });
		const entries = (counts?.matches ?? [])
			.map(match => ({ path: rel(root, match.path), count: Number(match.matchCount ?? 0) }))
			.filter(entry => entry.count > 0 && !hidden(entry.path));
		const total = Math.max(scope, entries.length), searched = Math.min(total, Math.max(Number(counts?.filesSearched ?? total) - lost, entries.length));
		const head = [`${entries.length} files, ${entries.reduce((sum, entry) => sum + entry.count, 0)} matches, searched ${searched} of ${total} files`];
		if (big.length) head.push(`searched in part (first 4 MiB): ${big.sort().join(", ")}`);
		return done(renderSearch(entries, head, budget));
	} catch (error) {
		return answer(`files: ${error instanceof Error ? error.message : error}. Narrow path and try again.`, true);
	}
}

// ---- texts and guard ----

const canon = name => name.replace(/^_/, "");
// Every wire form: flat, nested `function`, Google `functionDeclarations`, Bedrock `toolSpec`. With inline tool descriptors
// OMP sends no descriptions and keeps the native texts in the system prompt: nothing to check or replace.
const toolsOf = payload => [payload, payload?.tools, payload?.functions, payload?.config?.tools, payload?.request?.tools, payload?.toolConfig?.tools].filter(Array.isArray).flat()
	.flatMap(tool => tool?.functionDeclarations ?? [tool?.function ?? tool?.toolSpec ?? tool]).filter(tool => typeof tool?.name === "string" && tool.description);
// OMP lists its shell builtins in bash (prompts/tools/bash.md): the list follows the platform, not a change.
const BUILTINS = /^In-process builtins, ahead of PATH: .*$/m;
const native = text => String(text).replace(BUILTINS, "");

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
			if (typeof natives[name] !== kind) return `rqw-base-tools: engine ${name} changed`;
		}
	} catch {
		return "rqw-base-tools: engine import failed";
	}
}

function rewrite(tools) {
	// A text is a string or a list of parts. A pair is [with `files`, without it].
	// A last part `{ native: marker }` is the live native text from the marker on: OMP's own lines stay OMP's.
	const pick = tools.some(tool => canon(tool.name) === "files") ? 0 : 1;
	for (const tool of tools) {
		// OMP gives some models `edit` in the replace mode: it has its own text.
		const text = tool.description, name = canon(tool.name) === "edit" && text.includes("old_string") ? "replace" : canon(tool.name);
		if (!Object.hasOwn(texts.native, name)) continue;
		const parts = [].concat(texts.native[name]), marker = parts.at(-1).native;
		const own = parts.filter(part => !part.native).map(part => typeof part === "string" ? part : part[pick]).join("");
		// A description that already starts with our text is ours: a second pass changes nothing.
		if (!marker) tool.description = own;
		else if (!text.startsWith(own)) tool.description = own + text.slice(Math.max(text.indexOf(marker), 0));
	}
}

// ---- per-file patches ----

const SECTION = /^\s*\[([^\]\n#]+)(?:#[^\]\n]*)?\]\s*$/, ENVELOPE = /^\*\*\* (?:Begin|End) Patch\s*$/;
const wrap = sections => `${sections.flatMap(section => section.lines).join("\n")}\n`;

/** File sections of a hashline patch, without the optional envelope; empty when the input starts with something else. */
function splitPatch(input) {
	const sections = [];
	for (const line of input.trim().split("\n").filter(line => !ENVELOPE.test(line))) {
		const path = SECTION.exec(line)?.[1].trim();
		if (path !== undefined) sections.push({ path, lines: [] });
		else if (!sections.length && line.trim()) return [];
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
	// A cut or a paste uses the clipboard of the whole patch and of the session: such a patch is not split.
	if (paths.length < 2 || /^\s*(?:CUT\b|PUT\b.*[^:\s]\s*$)/m.test(input) || sections.some(section => !existsSync(section.full))) return;
	if (!(await dry(input)).isError) return;
	const skipped = [];
	for (const full of paths) {
		const own = sections.filter(section => key(section) === full), outcome = await dry(wrap(own));
		if (outcome.isError) skipped.push({ path: own[0].path, full, reason: outcome.text, patch: own.flatMap(section => section.lines).join("\n") });
	}
	if (!skipped.length || skipped.length === paths.length) return;
	return { input: wrap(sections.filter(section => !skipped.some(entry => entry.full === key(section)))), skipped };
}

// One staging pass of the native edit engine; the writer keeps the disk untouched. `store`: the snapshots of the
// files that a read showed or an edit wrote; with them the engine accepts an older tag, as the session does.
async function dryRunner(pi, load, cwd, store) {
	const natives = await load(NATIVES), edit = await settings(pi, load, ["edit.fuzzyMatch", "edit.fuzzyThreshold", "edit.blockAutoGenerated"]);
	const policy = {
		cwd, mode: "hashline", allowFuzzy: edit["edit.fuzzyMatch"], fuzzyThreshold: edit["edit.fuzzyThreshold"],
		blockAutoGenerated: edit["edit.blockAutoGenerated"], enforceSeenLines: false, maxColumns: 0, planActive: false,
		urlSchemes: [], urlAliasSchemes: [], planWritableRoots: [], homeDir: homedir(), rawInput: false,
	};
	return async input => {
		const session = new natives.EditSession(store ?? new natives.EditStore(), policy);
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

// ---- whole-file mark ----

const marked = new WeakSet();

/** The content with `[whole file: N lines]`, only when the shown lines cover an ordinary text file. */
function wholeFile(event) {
	const details = event.details, shown = details?.displayContent?.lineNumbers;
	if (canon(event.toolName) !== "read" || event.isError || !Array.isArray(shown)) return;
	const meta = details.meta ?? {};
	// A read of several ranges (`a.ts:1-2,5-9`) carries no line count: it is counted in the file, by the rule of OMP.
	// Other reads without a count did not reach the end. A large file is not read for this.
	let total = details.totalLines;
	try {
		const file = meta.source?.type === "path" && /:[^:/\\]*,/.test(event.input?.path) && meta.source.value;
		if (total === undefined && file && statSync(file).size <= MAX_FILE_BYTES) total = readFileSync(file, "utf8").replace(/\r\n?/g, "\n").replace(/\n$/, "").split("\n").length;
	} catch {}
	if (!Number.isInteger(total)) return;
	if (details.isDirectory || details.truncation?.truncated || meta.truncation || meta.limits?.columnTruncated || details.summary !== undefined || details.spotlight) return;
	// Web pages, internal addresses (`skill://`) and query answers (`a.json?q=`) are not ordinary files.
	if (/url|internal/.test(meta.source?.type) || event.input?.path?.includes("?") || shown.includes(null) || shown[0] !== 1 || shown.at(-1) < total || marked.has(details)) return;
	const at = event.content.findLastIndex(block => block.type === "text");
	if (at < 0 || event.content.some(block => block.type === "image")) return;
	marked.add(details);
	const text = event.content[at].text, content = [...event.content];
	content[at] = { ...content[at], text: `${text && !text.endsWith("\n") ? `${text}\n` : text}[whole file: ${details.fileSize === 0 ? 0 : total} lines]` };
	return content;
}

/** `load` imports an OMP module; tests replace it. */
export default function rqwBaseTools(pi, load = name => MODULES[name]()) {
	const z = pi.zod, text = z.string().optional(), flag = z.boolean().optional();
	let session, keys, store;
	pi.on("session_start", async (_event, ctx) => {
		session = ctx.sessionManager;
		keys = { ...(await load(`${OMP}tools/approval-cache`)), ...(await load(`${OMP}tools/approval-targets`)) };
		store = await load(NATIVES).then(natives => new natives.EditStore(), () => {});
	});
	pi.registerTool({
		name: "files",
		label: "files",
		loadMode: "essential",
		approval: "read",
		// OMP checks the search root as a recursive tree, like the native grep and glob.
		// Before the session start has finished there is no target: OMP then remembers nothing.
		approvalCacheTargets: args => keys && [keys.approvalTreeSearchKey(keys.approvalDirectoryKey(real(resolve(session.getCwd(), args?.path ?? ""))))],
		strict: false,
		description: texts.files,
		parameters: z.object({ path: text, glob: text, pattern: text, case: flag, hidden: flag, gitignore: flag }),
		execute: (_id, params, signal, _onUpdate, ctx) => runFiles(params, ctx.cwd, load, pi, signal),
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
	pi.on("tool_execution_end", event => void skips.delete(event.toolCallId));
	pi.on("tool_call", async (event, ctx) => {
		const input = event.input?.input;
		// A call that was blocked got no result: its old entry must not reach a new call.
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
	pi.on("tool_result", event => {
		const content = wholeFile(event), skipped = skips.get(event.toolCallId), details = event.details, name = canon(event.toolName);
		const seen = name === "read" ? [details?.meta?.source] : name === "edit" ? details?.perFileResults ?? [details] : [];
		try { for (const entry of seen) (entry?.path ?? entry?.value) && store?.recordSnapshotFile(entry.path ?? entry.value); } catch {}
		if (content) return { content };
		if (skips.delete(event.toolCallId)) return skippedResult(event, skipped);
	});
}
