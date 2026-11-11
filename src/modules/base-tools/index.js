// `files`: project file map and wide search on OMP's native engines.
// No 200-path cap and no git: the engine walks the directory itself.
// The engine import is a marked workaround: omp://extensions.md does not
// describe imports from an extension; a live probe confirms it works.

import { isAbsolute, relative, resolve } from "node:path";
import { constants } from "node:fs";
import { access, lstat, stat } from "node:fs/promises";
import descriptions from "./base-tools.descriptions.json";
import toolTexts from "./base-tools.texts.json";
import reference from "./base-tools.reference.json";

export const TIMEOUT_MS = 30000;
export const SPILL_RESERVE_KB = 5;
export const MAX_FILE_BYTES = 4 * 1024 * 1024;
export const MAX_MATCH_COLUMNS = 512;

export const FILES_DESCRIPTION = descriptions.files;

const bytes = line => Buffer.byteLength(`${line}\n`);
const byPath = (a, b) => a.localeCompare(b);
const inNodeModules = path => path.split("/").includes("node_modules");
const hidesNodeModules = (path, fileType, dirType) => {
	const parts = path.split("/");
	const at = parts.indexOf("node_modules");
	return at >= 0 && (at < parts.length - 1 || fileType === dirType);
};
const left = deadline => {
	const ms = deadline - Date.now();
	if (ms <= 0) throw new Error("timed out after 30s");
	return ms;
};

/** The answer budget: the spill threshold minus a small reserve for the last line. */
export function mapBudget(threshold) {
	const kb = Number.isFinite(threshold) ? threshold : 50;
	return Math.max(1, (kb - SPILL_RESERVE_KB) * 1024);
}

/** Engine paths are relative to the search root; keep one stable path spelling. */
export function normalizePath(file, root) {
	const path = isAbsolute(file) ? file : resolve(root, file);
	return relative(root, path).replace(/\\/g, "/");
}

export function normalizeFiles(files, root) {
	return [...new Set(files.map(file => normalizePath(file, root)))].sort(byPath);
}

/** One group per directory, root files in the empty group. */
export function groupByDirectory(files) {
	const groups = new Map();
	for (const file of files) {
		const at = file.lastIndexOf("/");
		const dir = at < 0 ? "" : file.slice(0, at);
		if (!groups.has(dir)) groups.set(dir, []);
		groups.get(dir).push(at < 0 ? file : file.slice(at + 1));
	}
	return [...groups]
		.map(([dir, names]) => ({ dir, names: names.sort(byPath), depth: dir === "" ? 0 : dir.split("/").length }))
		.sort((a, b) => a.dir.localeCompare(b.dir));
}

function linesOf(group) {
	if (group.dir === "") return group.names;
	return [`${group.dir}/`, ...group.names.map(name => `  ${name}`)];
}

/**
 * Renders the map under `budget` bytes. Deep directories are folded first.
 * Counts in the last line always add up to the total.
 */
export function renderMap(files, budget = Infinity) {
	const groups = groupByDirectory(files);
	const header = `total ${files.length} files`;
	const lines = new Map(groups.map(group => [group, linesOf(group)]));
	let size = bytes(header);
	for (const group of groups) for (const line of lines.get(group)) size += bytes(line);

	const folded = new Set();
	const footer = () => {
		if (folded.size === 0) return `[all ${files.length} files listed]`;
		const listed = groups.filter(group => !folded.has(group)).reduce((sum, group) => sum + group.names.length, 0);
		return `[${files.length} files: ${listed} listed, the rest folded into ${folded.size} directories]`;
	};
	const fold = group => {
		const label = `${group.dir}/ (${group.names.length} files)`;
		for (const line of lines.get(group)) size -= bytes(line);
		size += bytes(label);
		lines.set(group, [label]);
		folded.add(group);
	};
	const total = () => size + bytes(footer());

	// Deepest first, one pass: no repeated filtering on big directory sets.
	const order = groups.filter(group => group.dir !== "").sort((a, b) => b.depth - a.depth || b.dir.localeCompare(a.dir));
	for (const group of order) {
		if (total() <= budget) break;
		fold(group);
	}

	const body = groups.flatMap(group => lines.get(group));
	// A folded map still over budget goes out whole: OMP spills it to artifact://N.
	return [`${header}`, ...body, footer()].join("\n");
}

const matchesWord = count => `${count} ${count === 1 ? "match" : "matches"}`;

function clip(line, max = MAX_MATCH_COLUMNS) {
	const clean = String(line ?? "").replace(/\r?\n/g, "\\n").replace(/\r$/, "");
	if (Buffer.byteLength(clean) <= max) return clean;
	let out = clean.slice(0, max);
	while (out.length > 0 && Buffer.byteLength(`${out}...`) > max) out = out.slice(0, -1);
	return `${out}...`;
}

function searchLine(entry, firstLine) {
	return `${entry.path} (${matchesWord(entry.count)}): ${clip(firstLine.get(entry.path) ?? "")}`;
}

// Groups the tail by its directory, or by the top-level directory when even
// those lines are too many.
function foldTail(tail, firstLine, level) {
	const groups = new Map();
	const root = [];
	for (const entry of tail) {
		const at = entry.path.lastIndexOf("/");
		if (at < 0) {
			root.push(entry);
			continue;
		}
		const parent = entry.path.slice(0, at);
		const dir = level === 0 ? parent : parent.split("/")[0];
		const group = groups.get(dir) ?? { files: 0, matches: 0 };
		group.files++;
		group.matches += entry.count;
		groups.set(dir, group);
	}
	const dirLines = [...groups]
		.sort((a, b) => b[1].matches - a[1].matches || a[0].localeCompare(b[0]))
		.map(([dir, group]) => `${dir}/ (${group.files} files, ${group.matches} matches)`);
	return {
		dirLines,
		rootLines: root.map(entry => searchLine(entry, firstLine)),
		dirs: groups.size,
		listedRoot: root.length,
	};
}

/** Renders wide-search results. Files are listed by match count, the tail is folded. */
export function renderSearch(entries, firstLine, meta, budget = Infinity) {
	const sorted = [...entries].sort((a, b) => b.count - a.count || a.path.localeCompare(b.path));
	const header = `${sorted.length} files, ${meta.matches} matches, searched ${meta.searched} of ${meta.total} files`;
	const oversized = meta.oversized?.length ? [`searched in part (first 4 MiB): ${meta.oversized.join(", ")}`] : [];
	const base = [header, ...oversized];
	if (sorted.length === 0) return [...base, "No files matched.", "[all 0 files listed]"].join("\n");
	const footer = (listed, dirs) =>
		dirs === 0 ? `[all ${sorted.length} files listed]` : `[${sorted.length} files: ${listed} listed, the rest folded into ${dirs} directories]`;

	for (const level of [0, 1]) {
		for (let listed = sorted.length; listed >= 0; listed--) {
			const folded = foldTail(sorted.slice(listed), firstLine, level);
			const body = [
				...sorted.slice(0, listed).map(entry => searchLine(entry, firstLine)),
				...folded.rootLines,
				...folded.dirLines,
			];
			const text = [...base, ...body, footer(listed + folded.listedRoot, folded.dirs)].join("\n");
			if (Buffer.byteLength(text) <= budget) return text;
		}
	}
	const folded = foldTail(sorted, firstLine, 1);
	return [...base, ...folded.rootLines, ...folded.dirLines, footer(folded.listedRoot, folded.dirs)].join("\n");
}

async function defaultEngine() {
	return import("@oh-my-pi/pi-natives");
}

function text(value, isError = false) {
	return { content: [{ type: "text", text: value }], details: undefined, ...(isError ? { isError: true } : {}) };
}

async function spillThreshold(pi) {
	try {
		const { lookup } = await import("@oh-my-pi/pi-coding-agent/config/registry");
		return lookup("tools.artifactSpillThreshold")?.get(pi.pi.settings) ?? 50;
	} catch {
		return 50;
	}
}

async function scanFiles(natives, root, params, signal, timeoutMs = TIMEOUT_MS) {
	const result = await natives.glob({
		pattern: typeof params.glob === "string" && params.glob !== "" ? params.glob : "**/*",
		path: root,
		fileType: natives.FileType?.File ?? 1,
		hidden: params.hidden !== false,
		gitignore: params.gitignore !== false,
		includeNodeModules: false,
		timeoutMs,
		signal,
	});
	const dirType = natives.FileType?.Dir ?? 2;
	return (result?.matches ?? []).filter(match => !hidesNodeModules(match.path, match.fileType, dirType));
}

// Grep's glob selects every file under a matched directory. The glob engine
// returns the directory itself, so count its descendants too.
async function scopeFiles(natives, root, params, signal, deadline) {
	const glob = typeof params.glob === "string" && params.glob !== "" ? params.glob : "**/*";
	const base = {
		pattern: glob,
		path: root,
		hidden: params.hidden !== false,
		gitignore: params.gitignore !== false,
		includeNodeModules: false,
		timeoutMs: left(deadline),
		signal,
	};
	const all = (await natives.glob(base))?.matches ?? [];
	const dirType = natives.FileType?.Dir ?? 2;
	const files = all.filter(match => match.fileType !== dirType && !hidesNodeModules(match.path, match.fileType, dirType));
	// These masks already cover descendants; other masks may match a directory.
	const coversAll = glob === "**" || glob === "**/*" || glob.endsWith("/**") || glob.endsWith("/**/*");
	let hidden = 0;
	if (glob.includes("node_modules")) {
		const hiddenPaths = new Set();
		const extra = (await natives.glob({ ...base, includeNodeModules: true, timeoutMs: left(deadline) }))?.matches ?? [];
		for (const match of extra) {
			if (match.fileType !== dirType && hidesNodeModules(match.path, match.fileType, dirType)) hiddenPaths.add(normalizePath(match.path, root));
		}
		if (!coversAll) {
			for (const match of extra) {
				if (match.fileType !== dirType || !hidesNodeModules(match.path, match.fileType, dirType)) continue;
				const pattern = `${match.path.replace(/\/+$/, "")}/**`;
				const sub = (await natives.glob({ ...base, pattern, includeNodeModules: true, timeoutMs: left(deadline) }))?.matches ?? [];
				for (const child of sub) {
					if (child.fileType !== dirType && hidesNodeModules(child.path, child.fileType, dirType)) hiddenPaths.add(normalizePath(child.path, root));
				}
			}
		}
		for (const path of hiddenPaths) {
			try {
				const full = resolve(root, path);
				if (!(await lstat(full)).isFile()) continue;
				await access(full, constants.R_OK);
				hidden += 1;
			} catch {
				// The engine skipped this hidden entry; do not subtract it.
			}
		}
	}
	if (!coversAll) {
		for (const match of all) {
			if (match.fileType !== dirType) continue;
			const pattern = `${match.path.replace(/\/+$/, "")}/**`;
			if (hidesNodeModules(match.path, match.fileType, dirType)) continue;
			const sub = (await natives.glob({ ...base, pattern, timeoutMs: left(deadline) }))?.matches ?? [];
			for (const child of sub) {
				if (child.fileType !== dirType && !hidesNodeModules(child.path, child.fileType, dirType)) files.push(child);
			}
		}
	}
	const byPath = new Map();
	for (const match of files) byPath.set(normalizePath(match.path, root), match);
	return { files: [...byPath.values()], hidden };
}

async function withSizes(files, root) {
	const kept = [];
	for (let i = 0; i < files.length; i += 64) {
		await Promise.all(files.slice(i, i + 64).map(async file => {
			try {
				const full = isAbsolute(file.path) ? file.path : resolve(root, file.path);
				const info = await lstat(full);
				if (!info.isFile()) return;
				file.size = (await stat(full)).size;
				try {
					await access(full, constants.R_OK);
				} catch {
					file.readable = false;
				}
			} catch {
				// The engine may name a path that vanished; leave its size unknown.
			}
			kept.push(file);
		}));
	}
	return kept;
}

/** Runs one map call. `engine` and `threshold` are injected by tests. */
export async function runMap(params = {}, ctx = {}, options = {}) {
	const cwd = ctx.cwd ?? process.cwd();
	const root = params.path ? (isAbsolute(params.path) ? params.path : resolve(cwd, params.path)) : cwd;
	if (inNodeModules(root.replace(/\\/g, "/"))) return text("total 0 files\n[all 0 files listed]");
	let natives;
	try {
		natives = await (options.engine ?? defaultEngine)();
	} catch (error) {
		return text(`files: native engine unavailable (${error instanceof Error ? error.message : String(error)})`, true);
	}
	if (typeof natives?.glob !== "function") return text("files: native engine has no glob function", true);
	const deadline = Date.now() + TIMEOUT_MS;
	try {
		const matches = await scanFiles(natives, root, params, options.signal, left(deadline));
		const threshold = options.threshold ?? (await spillThreshold(options.pi));
		return text(renderMap(normalizeFiles(matches.map(match => match.path), root), mapBudget(threshold)));
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		return text(`files: ${message}. Narrow path and try again.`, true);
	}
}

/** Runs one wide-search call. `engine` and `threshold` are injected by tests. */
export async function runSearch(params = {}, ctx = {}, options = {}) {
	const pattern = typeof params.pattern === "string" ? params.pattern : "";
	if (pattern.trim() === "") return text("files: pattern must not be empty", true);
	const cwd = ctx.cwd ?? process.cwd();
	const root = params.path ? (isAbsolute(params.path) ? params.path : resolve(cwd, params.path)) : cwd;
	if (inNodeModules(root.replace(/\\/g, "/"))) {
		return text("0 files, 0 matches, searched 0 of 0 files\nNo files matched.\n[all 0 files listed]");
	}
	let natives;
	try {
		natives = await (options.engine ?? defaultEngine)();
	} catch (error) {
		return text(`files: native engine unavailable (${error instanceof Error ? error.message : String(error)})`, true);
	}
	if (typeof natives?.glob !== "function") return text("files: native engine has no glob function", true);
	if (typeof natives?.grep !== "function") return text("files: native engine has no grep function", true);
	const grepOptions = {
		pattern,
		path: root,
		ignoreCase: params.case === false,
		multiline: pattern.includes("\n") || pattern.includes("\\n"),
		hidden: params.hidden !== false,
		gitignore: params.gitignore !== false,
		signal: options.signal,
	};
	if (!grepOptions.multiline) delete grepOptions.multiline;
	if (typeof params.glob === "string" && params.glob !== "") grepOptions.glob = params.glob;
	const deadline = Date.now() + TIMEOUT_MS;
	try {
		const { files, hidden } = await scopeFiles(natives, root, params, options.signal, deadline);
		const scanned = await withSizes(files, root);
		const counts = await natives.grep({ ...grepOptions, mode: "count", timeoutMs: left(deadline) });
		const dirType = natives.FileType?.Dir ?? 2;
		const entries = (counts?.matches ?? [])
			.map(match => ({ path: normalizePath(match.path, root), count: Number(match.matchCount ?? 0) }))
			.filter(entry => entry.count > 0 && !hidesNodeModules(entry.path, natives.FileType?.File ?? 1, dirType))
			.sort((a, b) => b.count - a.count || a.path.localeCompare(b.path));
		const firstLine = new Map();
		if (entries.length > 0) {
			const first = await natives.grep({
				...grepOptions,
				mode: "content",
				timeoutMs: left(deadline),
				maxCountPerFile: 1,
				maxColumns: MAX_MATCH_COLUMNS,
			});
			for (const match of first?.matches ?? []) {
				const path = normalizePath(match.path, root);
				if (!firstLine.has(path)) firstLine.set(path, match.line ?? "");
			}
		}
		const total = Math.max(scanned.length, entries.length);
		const rawSearched = Number(counts?.filesSearched ?? total);
		const adjusted = typeof params.glob === "string" && params.glob.includes("node_modules")
			? Math.max(0, rawSearched - hidden)
			: rawSearched;
		const searched = Math.min(total, Math.max(adjusted, entries.length));
		const threshold = options.threshold ?? (await spillThreshold(options.pi));
		return text(renderSearch(entries, firstLine, {
			matches: entries.reduce((sum, entry) => sum + entry.count, 0),
			searched,
			total,
			oversized: scanned.filter(match => match.readable !== false && (match.size ?? 0) > MAX_FILE_BYTES).map(match => normalizePath(match.path, root)),
		}, mapBudget(threshold)));
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		return text(`files: ${message}. Narrow path and try again.`, true);
	}
}

export function install(pi, options = {}) {
	const z = pi.zod;
	pi.registerTool({
		name: "files",
		label: "files",
		loadMode: "essential",
		concurrency: "shared",
		approval: "read",
		strict: false,
		description: FILES_DESCRIPTION,
		parameters: z.object({
			path: z.string().optional(),
			glob: z.string().optional(),
			pattern: z.string().optional(),
			case: z.boolean().optional(),
			hidden: z.boolean().optional(),
			gitignore: z.boolean().optional(),
		}),
		execute: (toolCallId, params, signal, onUpdate, ctx) =>
			(params.pattern === undefined ? runMap : runSearch)(params, ctx, { signal, pi, ...options }),
	});
	const states = new Map();
	pi.on?.("before_provider_request", async (event, ctx) => {
		if (typeof event !== "object" || event === null || !("payload" in event)) return event;
		const key = ctx?.sessionManager?.getSessionId?.() ?? ctx?.sessionManager?.sessionId ?? "default";
		let state = states.get(key);
		if (!state) {
			state = { warned: false, checked: false };
			states.set(key, state);
		}
		if (!state.checked && toolLists(event.payload).flat().length > 0) {
			state.checked = true;
			const kind = ctx?.agent?.kind === "sub" ? "child" : "main";
			const mismatch =
				checkReference(event.payload, await settingsSnapshot(pi), kind) ?? (await checkEngine());
			warnOnce(mismatch, state, message => ctx?.ui?.notify?.(message, "warning"));
		}
		rewritePayload(event.payload);
		return event.payload;
	});
	pi.on?.("tool_result", event => {
		const content = wholeFileContent(event);
		if (content) return { content };
	});
}

const TEXT_NAMES = new Set(["grep", "glob", "read", "bash", "edit", "write"]);
const plainName = name => (typeof name === "string" ? name.replace(/^_/, "") : "");
const canonicalName = name => plainName(name) === "apply_patch" ? "edit" : plainName(name);

const toolLists = payload => [
	...(Array.isArray(payload) ? [payload] : []),
	...(Array.isArray(payload?.tools) ? [payload.tools] : []),
	...(Array.isArray(payload?.functions) ? [payload.functions] : []),
];

function detectFiles(payload) {
	return toolLists(payload).flat().some(tool => plainName(tool?.function?.name ?? tool?.name) === "files");
}

const fieldsOf = tool =>
	Object.keys(tool?.parameters?.properties ?? tool?.input_schema?.properties ?? tool?.inputSchema?.properties ?? tool?.format ?? {}).sort();
// On Windows OMP adds one line to bash (prompts/tools/bash.md, isWindows): not a change.
const nativeText = text =>
	text.replace(/^Windows host, emulated bash environment: .*$/m, "").replace(
		"Scripts/heredocs/`$(…)`/complex pipelines → `eval`.",
		"Scripts/heredocs/`$(…)`/complex flow → dedicated tool or checked-in script.",
	);

/** Returns the first native tool or setting that moved away from the reference. */
export function checkReference(payload, settings, kind = "main", expected = reference) {
	const tools = new Map(toolLists(payload).flat().map(tool => [canonicalName(tool?.function?.name ?? tool?.name), tool?.function ?? tool]));
	for (const [name, want] of Object.entries(expected[kind] ?? expected.main)) {
		const tool = tools.get(name);
		if (!tool) {
			if (kind === "child") continue;
			return `base-tools: native ${name} is missing`;
		}
		if (nativeText(tool.description) !== nativeText(want.description)) {
			return `base-tools: native ${name} changed description`;
		}
		const fields = fieldsOf(tool);
		const aliases = name === "edit" ? [want.fields, ["i", "input"]] : [want.fields];
		if (!aliases.some(alias => alias.join("\n") === fields.join("\n"))) return `base-tools: native ${name} changed fields`;
	}
	if (settings !== undefined) {
		for (const [key, want] of Object.entries(expected.settings)) {
			if (JSON.stringify(settings[key]) !== JSON.stringify(want)) return `base-tools: setting ${key} changed`;
		}
	}
	return undefined;
}

export function warnOnce(mismatch, state, notify) {
	if (!mismatch || state.warned) return false;
	state.warned = true;
	try {
		notify?.(mismatch);
	} catch {}
	return true;
}

/** Checks the engine functions `files` imports. */
export async function checkEngine(load = () => import("@oh-my-pi/pi-natives")) {
	try {
		const natives = await load();
		for (const [name, kind] of Object.entries(reference.engine)) {
			if (typeof natives[name] !== kind) return `base-tools: engine ${name} changed`;
		}
		return undefined;
	} catch {
		return "base-tools: engine import failed";
	}
}

async function settingsSnapshot(pi) {
	try {
		const { lookup } = await import("@oh-my-pi/pi-coding-agent/config/registry");
		return Object.fromEntries(Object.keys(reference.settings).map(key => [key, lookup(key)?.get(pi.pi.settings)]));
	} catch {
		return {};
	}
}

function rewriteRecord(record, hasFiles) {
	const name = canonicalName(record?.name);
	if (!TEXT_NAMES.has(name)) return;
	const text = toolTexts[name];
	record.description = typeof text === "string" ? text : hasFiles ? text.withFiles : text.withoutFiles;
}

/** Adds the whole-file marker only to a complete ordinary text read. */
const marked = new WeakSet();

export function wholeFileContent(event) {
	if (typeof event !== "object" || event === null || event.toolName !== "read" || event.isError === true) return;
	const details = event.details;
	if (typeof details !== "object" || details === null || details.isDirectory === true) return;
	if (!Number.isInteger(details.totalLines) || details.truncation?.truncated === true) return;
	if (details.summary !== undefined || details.meta?.source?.type === "url") return;
	if (!Array.isArray(event.content) || event.content.some(block => block?.type === "image")) return;
	if (marked.has(details)) return;
	const index = event.content.findLastIndex(block => block?.type === "text" && typeof block.text === "string");
	if (index < 0) return;
	const text = event.content[index].text;
	const shown = details.displayContent?.lineNumbers;
	if (!Array.isArray(shown)) return;
	if (shown.includes(null) || shown[0] !== 1 || shown.at(-1) < details.totalLines) return;
	const lines = details.fileSize === 0 ? 0 : details.totalLines;
	const marker = `[whole file: ${lines} lines]`;
	const content = [...event.content];
	const prefix = text === "" ? "" : text.endsWith("\n") ? text : `${text}\n`;
	content[index] = { ...content[index], text: `${prefix}${marker}` };
	marked.add(details);
	return content;
}

/** Rewrites the six native tool descriptions in one provider payload. */
export function rewritePayload(payload, hasFiles = detectFiles(payload)) {
	for (const list of toolLists(payload)) for (const node of list) {
		if (typeof node !== "object" || node === null) continue;
		const fn = node.function;
		if (typeof fn === "object" && fn !== null) rewriteRecord(fn, hasFiles);
		if (
			typeof node.name === "string" &&
			typeof node.description === "string" &&
			("parameters" in node ||
				"input_schema" in node ||
				"inputSchema" in node ||
				"strict" in node ||
				node.type === "function" ||
				node.type === "custom")
		) {
			rewriteRecord(node, hasFiles);
		}
	}
	return payload;
}

export default function baseTools(pi) {
	install(pi);
}
