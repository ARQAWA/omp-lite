// Cursor-style arguments over omp's own tools, under omp's own names.
// `grep` runs on the native search engine for plain paths and delegates to the
// native tool for archives, selectors, masks, path lists and URLs; `bash` adds
// Cursor's block_until_ms: 0. The edit tool is switched to the apply-patch
// contract, which is what Cursor speaks.

import { existsSync, statSync } from "node:fs";
import { isAbsolute, join, relative, resolve } from "node:path";
import texts from "./descriptions.json";

// ---------------------------------------------------------------- rendering

export const PAGE_BUDGET = 15000;

/** An oversized entry keeps its match line and the nearest context lines that fit; `…` marks dropped lines. */
export function shrink(lines, at, budget = PAGE_BUDGET) {
	let from = at;
	let to = at + 1;
	let used = lines[at].length + 5; // the line break and both markers
	for (let grew = true; grew; ) {
		grew = false;
		for (const next of [from - 1, to]) {
			if (next < 0 || next >= lines.length || used + lines[next].length + 1 > budget) continue;
			used += lines[next].length + 1;
			if (next < from) from--;
			else to++;
			grew = true;
		}
	}
	return [...(from > 0 ? ["…"] : []), ...lines.slice(from, to), ...(to < lines.length ? ["…"] : [])];
}

/**
 * One entry per match line, with every known line of its window: `before` lines above, `after` below.
 * The engine hands a context line to one match only, so a window also takes its neighbours' lines.
 * Another match inside the window is context here: it is an entry of its own, maybe on another page.
 */
export function contentEntries(matches, display = path => path, before = 0, after = 0) {
	const byFile = new Map();
	for (const match of matches) {
		const file = display(match.path);
		let lines = byFile.get(file);
		if (lines === undefined) byFile.set(file, (lines = new Map()));
		// The engine cuts an over-long match line around its match and reports the column, as the native tool prints it.
		const line = match.truncated === true ? `${match.line} [col ${match.column}]` : match.line;
		lines.set(match.lineNumber, { lineNumber: match.lineNumber, line, isContext: false });
		for (const context of [...(match.contextBefore ?? []), ...(match.contextAfter ?? [])]) {
			if (!lines.has(context.lineNumber)) lines.set(context.lineNumber, { lineNumber: context.lineNumber, line: context.line, isContext: true });
		}
	}
	const entries = [];
	for (const [file, lines] of byFile) {
		const sorted = [...lines.values()].sort((a, b) => a.lineNumber - b.lineNumber);
		let low = 0;
		sorted.forEach((own, at) => {
			if (own.isContext) return;
			while (sorted[low].lineNumber < own.lineNumber - before) low++;
			let high = at;
			while (high + 1 < sorted.length && sorted[high + 1].lineNumber <= own.lineNumber + after) high++;
			const window = sorted.slice(low, high + 1).map(line => (line === own || line.isContext ? line : { ...line, isContext: true }));
			entries.push({ file, lines: window, at: at - low });
		});
	}
	return entries;
}

/** Match lines read `file:12:text`, context lines `file:12-text`, as ripgrep prints them. */
export function contentLines(entry) {
	return entry.lines.map(line => `${entry.file}:${line.lineNumber}${line.isContext ? "-" : ":"}${line.line}`);
}

/** One key per line of an entry, the same for a match line and for its copy inside another window. */
export const contentKeys = entry => entry.lines.map(line => `${entry.file}\u0000${line.lineNumber}`);

/** Takes whole entries until the page budget, then names the next index. A page prints a line once. */
export function paginate(entries, render, options = {}) {
	const offset = options.offset ?? 0;
	const limit = options.limit;
	const budget = options.budget ?? PAGE_BUDGET;
	const lines = [];
	const printed = new Map();
	let used = 0;
	let taken = 0;
	let index = offset;
	for (; index < entries.length; index++) {
		if (limit !== undefined && taken >= limit) break;
		const chunk = render(entries[index]);
		const keys = options.keys?.(entries[index]) ?? chunk;
		const own = options.anchor?.(entries[index]) ?? 0;
		// Windows of neighbouring matches overlap: a line the page already holds is not printed again.
		const fresh = chunk.flatMap((line, at) => (printed.has(keys[at]) ? [] : [at]));
		const size = fresh.reduce((sum, at) => sum + chunk[at].length + 1, 0);
		if (taken > 0 && used + size > budget) break;
		if (taken === 0 && size > budget) {
			// The match line is never cut here: a huge answer spills by the output settings of OMP.
			lines.push(...shrink(chunk, own, budget));
			taken++;
			index++;
			break;
		}
		// The match line of this entry replaces the copy that an earlier window printed as context.
		if (printed.has(keys[own])) lines[printed.get(keys[own])] = chunk[own];
		for (const at of fresh) {
			printed.set(keys[at], lines.length);
			lines.push(chunk[at]);
		}
		used += size;
		taken++;
	}
	return { text: lines.join("\n"), next: index < entries.length ? index : undefined };
}

// --------------------------------------------------------------------- grep

export const MODES = ["content", "files_with_matches", "count"];
const FILE_PAGE = 20;
const COLLECTED = 100000;
const TIMEOUT_MS = 20000;
const WINDOW = 4 * 1024 * 1024; // bytes of a file the engine reads in a directory walk (omp://tools/grep.md, Limits & Caps)

const ARCHIVE = /\.(?:tar\.(?:gz|bz2|xz|zst|z)|tar|tbz2|tbz|tgz|txz|tzst|zip|jar|war|ear|apk|whl|ipa|xpi|vsix|nupkg|cbz|rar|cbr|7z|iso|cab|cpio|rpm|deb|ar|a|lib|lzh|lha|arj|asar|gz|bz2|xz|zst|z|lzma):/i;
const SELECTOR = /:(?:L?\d+\.\.L?\d*|L?\d+-L?\d*|-L?\d+|L?\d+\+L?\d+|raw|conflicts|img|L?\d+(?:-L?\d+)?)(?:,-?L?\d+(?:(?:-|\.\.)L?\d*)?)*$/;
const GLOB = /[*?[\]{}]/;
const SEPARATOR = /[,\s]+(?![^{]*\})/; // a comma or a space outside braces splits a path list

/** Anything the native tool does better than we can is handed back to it. */
export function routeFor(path) {
	if (typeof path !== "string" || path === "") return "engine";
	if (path.includes("://") || path.includes(";")) return "native";
	if (ARCHIVE.test(path) || SELECTOR.test(path) || GLOB.test(path)) return "native";
	return "engine";
}

function whole(name, value, minimum = 0) {
	if (value === undefined || value === null) return undefined;
	if (!Number.isFinite(value) || value < minimum) return { error: `${name} must be a number of at least ${minimum}` };
	return Math.floor(value);
}

/** Validates the Cursor arguments once, so both branches read the same request. */
export function parseGrep(params) {
	const input = params ?? {};
	if (typeof input.pattern !== "string" || input.pattern.trim() === "") return { error: "pattern must not be empty" };
	const mode = input.output_mode ?? "content";
	if (!MODES.includes(mode)) return { error: `output_mode must be one of ${MODES.join(", ")}` };
	const numbers = {};
	for (const [name, field, minimum] of [
		["-A", input["-A"], 0],
		["-B", input["-B"], 0],
		["-C", input["-C"], 0],
		["head_limit", input.head_limit, 1],
		["offset", input.offset, 0],
	]) {
		if (mode !== "content" && (name === "-A" || name === "-B" || name === "-C")) {
			numbers[name] = undefined;
			continue;
		}
		const value = whole(name, field, minimum);
		if (value !== undefined && typeof value === "object") return value;
		numbers[name] = value;
	}
	const automatic = input.pattern.includes("\n") || input.pattern.includes("\\n");
	return {
		request: {
			pattern: input.pattern,
			path: typeof input.path === "string" && input.path !== "" ? input.path : undefined,
			glob: input.glob,
			type: input.type,
			mode,
			caseSensitive: input["-i"] !== true,
			gitignore: input.gitignore !== false,
			multiline: input.multiline === true || automatic,
			explicitMultiline: input.multiline === true,
			contextBefore: mode === "content" ? (numbers["-B"] ?? numbers["-C"]) : undefined,
			contextAfter: mode === "content" ? (numbers["-A"] ?? numbers["-C"]) : undefined,
			headLimit: numbers.head_limit,
			offset: numbers.offset,
		},
	};
}

const NATIVE_LIMITS = [
	["output_mode", request => request.mode !== "content"],
	["-A/-B/-C", request => request.contextBefore !== undefined || request.contextAfter !== undefined],
	["type", request => request.type !== undefined],
	["multiline", request => request.explicitMultiline],
	["glob", request => request.glob !== undefined],
	["head_limit", request => request.headLimit !== undefined],
];

export function plainMessage(request) {
	const names = NATIVE_LIMITS.filter(([, refused]) => refused(request)).map(([name]) => name);
	if (names.length === 0) return undefined;
	return `${names.join(", ")} not supported for archive, selector, path-list or URL searches`;
}

async function defaultEngine() {
	const natives = await import("@oh-my-pi/pi-natives");
	return natives;
}

const ENGINE_MODES = { content: "content", count: "count", files_with_matches: "filesWithMatches" };

/** The native binding takes exactly one options object; a second argument is its onMatch callback. */
function engineRequest(request, base, signal, maxColumns) {
	const options = {
		pattern: request.pattern,
		path: base,
		glob: request.glob,
		type: request.type,
		ignoreCase: !request.caseSensitive,
		multiline: request.multiline,
		hidden: true,
		gitignore: request.gitignore,
		mode: request.ranges !== undefined ? ENGINE_MODES.content : ENGINE_MODES[request.mode],
		// A line selector filters after the search, so its one file is collected whole.
		maxCount: request.ranges !== undefined ? undefined : COLLECTED,
		timeoutMs: TIMEOUT_MS,
		// The line cap is the `tools.outputMaxColumns` setting; 0 means no cap.
		maxColumns: maxColumns > 0 ? maxColumns : undefined,
		contextBefore: request.contextBefore,
		contextAfter: request.contextAfter,
		signal,
	};
	for (const key of Object.keys(options)) if (options[key] === undefined) delete options[key];
	return options;
}

function text(value, isError = false) {
	return { content: [{ type: "text", text: value }], details: undefined, ...(isError ? { isError: true } : {}) };
}

/** Notes what the engine could not cover, so a short answer never looks complete. */
function notes(outcome) {
	const parts = [];
	if (outcome.limitReached) parts.push(`collection stopped at ${COLLECTED} matches`);
	if (outcome.skippedOversized > 0) parts.push(`${outcome.skippedOversized} files skipped as too large`);
	if (outcome.partial.length > 0) parts.push(`only the first 4 MiB searched in ${outcome.partial.slice(0, 5).join(", ")}${outcome.partial.length > 5 ? " and others" : ""}; search such a file by its own path`);
	return parts.length === 0 ? "" : `\n[${parts.join("; ")}]`;
}

function oversized(path) {
	try {
		return statSync(path).size > WINDOW;
	} catch {
		return false;
	}
}

/** Runs one search and renders it. `engine` is injected so tests never touch the real native module. */
export async function searchGrep(request, ctx, options = {}) {
	const natives = await (options.engine ?? defaultEngine());
	const cwd = ctx?.cwd ?? process.cwd();
	const base = request.path === undefined ? cwd : isAbsolute(request.path) ? request.path : resolve(cwd, request.path);
	const displayBase = request.paths === undefined ? base : cwd;
	const display = path => {
		const absolute = isAbsolute(path) ? path : join(displayBase, path);
		const shown = relative(cwd, absolute);
		if (request.paths !== undefined) return shown;
		return shown.startsWith("..") ? absolute : shown;
	};
	const parts = [];
	const walked = new Set();
	let limitReached = false;
	let skippedOversized = 0;
	for (const entry of request.paths ?? [request.path]) {
		const { path: target, mask } = typeof entry === "object" ? entry : { path: entry };
		const entryBase = target === undefined ? cwd : isAbsolute(target) ? target : resolve(cwd, target);
		const fits = mask === undefined ? undefined : new Bun.Glob(mask);
		const part = (await natives.grep(engineRequest(request, entryBase, options.signal, options.maxColumns))) ?? {};
		for (const match of part.matches ?? []) {
			// A mask names files from its directory, the way the engine names them in a walk.
			if (fits !== undefined && !fits.match(match.path)) continue;
			// The engine names a file of a directory walk by a relative path; it reads such a file only up to its window.
			if (!isAbsolute(match.path)) walked.add(join(entryBase, match.path));
			parts.push({ ...match, path: isAbsolute(match.path) ? match.path : join(entryBase, match.path) });
		}
		limitReached = limitReached || part.limitReached === true;
		skippedOversized += part.skippedOversized ?? 0;
	}
	const seen = new Set();
	let outcome = {
		matches: parts.filter(match => {
			const key = `${match.path}\u0000${match.lineNumber}`;
			if (seen.has(key)) return false;
			seen.add(key);
			return true;
		}),
		limitReached,
		skippedOversized,
		partial: [...walked].filter(oversized).map(display),
	};
	if (request.ranges !== undefined) {
		const inside = number => request.ranges.some(([start, end]) => number >= start && number <= end);
		outcome = {
			...outcome,
			matches: (outcome.matches ?? [])
				.filter(match => inside(match.lineNumber))
				.map(match => ({
					...match,
					contextBefore: (match.contextBefore ?? []).filter(line => inside(line.lineNumber)),
					contextAfter: (match.contextAfter ?? []).filter(line => inside(line.lineNumber)),
				})),
		};
	}
	const tail = notes(outcome);
	const fileContinuation = next => `Use offset=${next} for the next page.`;
	if (request.mode === "content") {
		const entries = contentEntries(outcome.matches ?? [], display, request.contextBefore ?? 0, request.contextAfter ?? 0);
		const page = paginate(entries, contentLines, { offset: request.offset ?? 0, limit: request.headLimit, anchor: entry => entry.at, keys: contentKeys });
		const shown = page.next === undefined ? entries.length : `${Math.min(page.next, entries.length)}+`;
		const footer = page.next === undefined ? tail : `\n[${shown} of ${entries.length} matches shown. Use offset=${page.next} for the next page.]${tail}`;
		return text(`${page.text || "No matches found"}${footer}`);
	}
	const files = [...new Set((outcome.matches ?? []).map(match => display(match.path)))];
	const counts = new Map();
	for (const match of outcome.matches ?? []) counts.set(display(match.path), (counts.get(display(match.path)) ?? 0) + (match.matchCount ?? 1));
	const entries = request.mode === "count" ? [...counts].map(([path, count]) => ({ path, count })) : files.map(path => ({ path }));
	const render = request.mode === "count" ? entry => [`${entry.path}:${entry.count}`] : entry => [entry.path];
	const start = request.offset ?? 0;
	const page = paginate(entries, render, { offset: start, limit: request.headLimit ?? FILE_PAGE });
	const footer = page.next === undefined ? tail : `\n[${fileContinuation(page.next)}]${tail}`;
	return text(`${page.text || "No matches found"}${footer}`);
}

/** Drops the leading matched lines, so a single-file native search honours the match offset. */
export function skipMatches(text, count) {
	let remaining = count;
	const kept = [];
	for (const line of text.split("\n")) {
		if (remaining > 0 && line.startsWith("*")) {
			remaining--;
			continue;
		}
		kept.push(line);
	}
	return remaining > 0 ? "No matches found" : kept.join("\n");
}

/** A host file with a line-range selector is searched by the engine, not the capped native tool. */
export function parseHostSelector(path, cwd = process.cwd()) {
	if (typeof path !== "string" || path.includes("://") || path.includes(";") || ARCHIVE.test(path)) return undefined;
	const literal = resolve(cwd, path);
	if (existsSync(literal) && statSync(literal).isFile()) return undefined;
	const match = /^(.*?):((?:L?-?\d+(?:(?:-|\.\.)L?\d*)?(?:\+L?\d*)?(?:,(?:L?-?\d+)(?:(?:-|\.\.)L?\d*)?(?:\+L?\d*)?)*))$/.exec(path);
	if (!match) return undefined;
	const base = resolve(cwd, match[1]);
	if (match[1] === "" || !existsSync(base) || !statSync(base).isFile()) return undefined;
	const ranges = [];
	const parts = match[2].split(",");
	const standalone = parts.length === 1;
	for (const part of parts) {
		const value = part.replace(/^L/, "");
		let range;
		if (/^-\d+$/.test(value)) return undefined;
		if (value.includes("+")) {
			const [start, count] = value.split("+").map(part => Number(part.replace(/^L/, "")));
			range = [start, start + count - 1];
		} else if (/(?:\.\.|-)/.test(value)) {
			const [start, end] = value.split(/\.\.|-/);
			range = [Number(start.replace(/^L/, "")), end === "" || end === undefined ? Infinity : Number(end.replace(/^L/, ""))];
		} else {
			const line = Number(value);
			range = standalone ? [line, Infinity] : [line, line];
		}
		if (!Number.isInteger(range[0]) || range[0] < 1 || (range[1] !== Infinity && (!Number.isInteger(range[1]) || range[1] < range[0]))) return undefined;
		ranges.push(range);
	}
	return { base, ranges };
}

/** One entry of a host search: an existing path, or a mask under an existing directory. */
function hostEntry(entry, cwd) {
	if (entry === "" || entry.includes("://") || ARCHIVE.test(entry) || SELECTOR.test(entry)) return undefined;
	if (existsSync(resolve(cwd, entry))) return entry;
	const segments = entry.split("/");
	const at = segments.findIndex(segment => GLOB.test(segment));
	if (at < 0) return undefined;
	const base = resolve(cwd, segments.slice(0, at).join("/") || (entry.startsWith("/") ? "/" : "."));
	const mask = segments.slice(at).join("/");
	return !SEPARATOR.test(mask) && statSync(base, { throwIfNoEntry: false })?.isDirectory() ? { path: base, mask } : undefined;
}

/** Host paths and masks go through the engine, one entry at a time. */
export function hostList(path, cwd) {
	if (typeof path !== "string") return undefined;
	// `;` always splits; a comma or a space splits only when the whole text is not one entry.
	const parts = path.includes(";") ? path.split(";") : hostEntry(path, cwd) !== undefined ? [path] : path.split(SEPARATOR);
	const entries = parts.map(part => hostEntry(part.trim(), cwd));
	// One plain existing path is not a list: it is searched as it is.
	if (entries.includes(undefined) || (entries.length === 1 && typeof entries[0] === "string")) return undefined;
	return [...new Map(entries.map(entry => [JSON.stringify(entry), entry])).values()];
}

/** Full tool body: route, then either delegate or search. */
export async function executeGrep(toolCallId, params, signal, onUpdate, ctx, options = {}) {
	const parsed = parseGrep(params);
	if (parsed.error !== undefined) return text(parsed.error, true);
	const request = parsed.request;
	const cwd = ctx?.cwd ?? process.cwd();
	// An existing path wins over selector, mask and archive syntax, as in the native tool.
	const literal = typeof request.path === "string" && !/;|:\/\//.test(request.path) && routeFor(request.path) === "native" ? resolve(cwd, request.path) : undefined;
	if (literal !== undefined && existsSync(literal)) {
		request.path = literal;
		request.literal = true;
	}
	const host = request.literal === true ? undefined : parseHostSelector(request.path, cwd);
	if (host !== undefined) {
		request.path = host.base;
		request.ranges = host.ranges;
	}
	const list = request.literal === true ? undefined : hostList(request.path, cwd);
	if (list !== undefined) {
		request.paths = list;
		request.path = undefined;
	}
	// A comma or space joined list with a missing part is the native tool's to expand.
	const joined = typeof request.path === "string" && /[,\s]/.test(request.path) && !existsSync(resolve(cwd, request.path));
	if (request.literal !== true && (joined || routeFor(request.path) === "native")) {
		const refused = plainMessage(request);
		if (refused !== undefined) return text(refused, true);
		if (typeof ctx?.invokeTool !== "function") return text("native grep is unavailable in this runtime", true);
		const result = await ctx.invokeTool(
			{
				pattern: request.pattern,
				path: request.path,
				case: request.caseSensitive,
				gitignore: request.gitignore,
				skip: request.offset,
			},
			{ signal, onUpdate },
		);
		const textBlock = result?.content?.[0];
		if (textBlock?.type === "text" && result?.isError !== true) {
			const path = String(request.path ?? "");
			const singleFile = !path.includes(";") && (hasSelector(path) || ARCHIVE.test(path));
			if (singleFile && request.offset > 0) textBlock.text = skipMatches(textBlock.text, request.offset);
			textBlock.text = textBlock.text.replace(/^\[?Use skip=(\d+) for the next page\.?\]?$/gm, match => match.replace("skip=", "offset="));
		}
		return result;
	}
	try {
		return await searchGrep(request, ctx, { ...options, signal });
	} catch (error) {
		return text(error instanceof Error ? error.message : String(error), true);
	}
}

// --------------------------------------------------------------------- bash

/** Drops the Cursor field and, for zero, asks the native tool to start in the background. */
export function mapBashParams(params) {
	const { block_until_ms: blockUntilMs, working_directory: workingDirectory, ...rest } = params ?? {};
	if (workingDirectory !== undefined && rest.cwd === undefined) rest.cwd = workingDirectory;
	if (blockUntilMs !== 0) return rest;
	if (rest.pty === true || rest.name !== undefined) return rest;
	return { ...rest, async: true };
}

export async function executeBash(toolCallId, params, signal, onUpdate, ctx) {
	const blockUntilMs = params?.block_until_ms;
	if (blockUntilMs !== undefined && blockUntilMs !== 0) {
		return text("block_until_ms only accepts 0; other values would race the shared auto-background threshold", true);
	}
	if (blockUntilMs === 0 && (params.pty === true || params.name !== undefined)) {
		return text("block_until_ms: 0 cannot be combined with pty or a named service", true);
	}
	if (typeof ctx?.invokeTool !== "function") return text("native bash is unavailable in this runtime", true);
	return ctx.invokeTool(mapBashParams(params), { signal, onUpdate });
}

// -------------------------------------------------------------------- glob

/** Cursor sends a pattern plus an optional directory; the rest of the arguments are native. */
export function globRequest(params, cwd = process.cwd()) {
	const input = params ?? {};
	if (typeof input.glob_pattern !== "string" || input.glob_pattern === "") return { error: "glob_pattern must not be empty" };
	const pattern = input.glob_pattern.replace(/^(?:\.\/)+(?=.)/, "");
	const directory = input.target_directory;
	const targeted = typeof directory === "string" && directory !== "";
	const base = targeted ? directory.replace(/\/+$/, "") : "";
	// Cursor's rule: a pattern without a leading "**/" gets it. A rooted pattern, a URL and a list cannot take it.
	const rooted = !targeted && /^(?:\.{0,2}\/|~|[A-Za-z]:)|:\/\/|;/.test(pattern);
	// An existing directory, or an existing name with mask characters, is a path and stays as written, as in the native tool.
	const path = resolve(cwd, base, pattern);
	const literal = existsSync(path) && (GLOB.test(pattern) || statSync(path).isDirectory());
	const recursive = pattern.startsWith("**/") || rooted || literal ? pattern : `**/${pattern}`;
	return { params: { path: targeted ? `${base}/${recursive}` : recursive, hidden: input.hidden, gitignore: input.gitignore, limit: input.limit } };
}

/** Newest first, as Cursor promises; only host paths can be ordered this way. */
export function sortByMtime(files, cwd = process.cwd()) {
	return files
		.map(file => {
			try {
				return [file, statSync(resolve(cwd, file.replace(/\/+$/, ""))).mtimeMs];
			} catch {
				return [file, -Infinity];
			}
		})
		.sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
		.map(([file]) => file);
}

export async function executeGlob(toolCallId, params, signal, onUpdate, ctx) {
	const mapped = globRequest(params, ctx?.cwd);
	if (mapped.error) return text(mapped.error, true);
	if (typeof ctx?.invokeTool !== "function") return text("native glob is unavailable in this runtime", true);
	const native = mapped.params;
	for (const key of Object.keys(native)) if (native[key] === undefined) delete native[key];
	const result = await ctx.invokeTool(native, { signal, onUpdate });
	const files = result?.details?.files;
	const textBlock = result?.content?.[0];
	const hostOnly = Array.isArray(files) && files.length > 1 && files.every(file => !file.includes("://"));
	if (result?.isError !== true && textBlock?.type === "text" && hostOnly && !ARCHIVE.test(native.path)) {
		const remaining = new Map();
		for (const file of files) {
			for (const name of new Set([file, file.split("/").pop()])) remaining.set(name, (remaining.get(name) ?? 0) + 1);
		}
		const notes = [];
		for (const line of textBlock.text.split("\n")) {
			if (line === "" || line.startsWith("#") || line.startsWith("*")) continue;
			const left = remaining.get(line) ?? 0;
			if (left > 0) remaining.set(line, left - 1);
			else notes.push(line);
		}
		const body = [...sortByMtime(files, ctx?.cwd ?? process.cwd()), ...notes].join("\n");
		if (Buffer.byteLength(body) <= 50 * 1024) textBlock.text = body;
	}
	return result;
}

// -------------------------------------------------------------------- read

/** Rejects a path that already carries a selector; the native tool wants one form only. */
function hasSelector(path) {
	if (/:(?:raw|img|conflicts)(?::|$)/.test(path)) return true;
	const match = /:(L?-?\d+(?:(?:-|\.\.)L?\d*)?(?:[+,]\d*)*(?:,(?:L?-?\d+)(?:(?:-|\.\.)L?\d*)?(?:[+,]\d*)*)*(?::raw)?)$/.exec(path);
	if (!match) return false;
	const before = path.slice(0, match.index);
	if (before.endsWith("//")) return false;
	return !/^[a-z][a-z0-9+.-]*:\/\/[^/]*$/i.test(before);
}

/** Cursor sends a 1-indexed offset and a line count; the native tool takes a path selector. */
export function readRequest(params, cwd = process.cwd()) {
	const input = params ?? {};
	const path = input.path;
	if (typeof path !== "string" || path === "") return { error: "path must not be empty" };
	const offset = input.offset;
	const limit = input.limit;
	if (offset === undefined && limit === undefined) return { params: { path } };
	// An existing file named like a selector is read literally, as the native tool does.
	if (hasSelector(path) && !existsSync(resolve(cwd, path))) return { error: "path already carries a selector; drop offset and limit" };
	if (offset !== undefined && (!Number.isInteger(offset) || offset === 0)) return { error: "offset must be a non-zero integer" };
	if (limit !== undefined && (!Number.isInteger(limit) || limit < 1)) return { error: "limit must be a positive integer" };
	const start = offset ?? 1;
	// xd topics do not parse path selectors; slice their returned document instead.
	if (path.startsWith("xd://")) return { params: { path }, document: { offset: start, limit } };
	if (start < 0) {
		if (limit === undefined) return { params: { path: `${path}:-${Math.abs(start)}:raw` } };
		return { params: { path: `${path}:1-1:raw` }, tail: { path, offset, limit } };
	}
	if (limit !== undefined) return { params: { path: `${path}:${start}-${start + limit - 1}:raw` } };
	return { params: { path: `${path}:${start}-:raw` } };
}

export async function executeRead(toolCallId, params, signal, onUpdate, ctx) {
	const mapped = readRequest(params, ctx?.cwd);
	if (mapped.error) return text(mapped.error, true);
	if (typeof ctx?.invokeTool !== "function") return text("native read is unavailable in this runtime", true);
	if (mapped.document) {
		const result = await ctx.invokeTool(mapped.params, { signal, onUpdate });
		if (result.isError) return result;
		const content = result.content ?? [];
		const lines = content.filter(part => part.type === "text").map(part => part.text).join("\n").split("\n");
		// A final line break ends the last line; it does not start one more.
		if (lines.length > 1 && lines.at(-1) === "") lines.pop();
		const { offset, limit } = mapped.document;
		const start = offset < 0 ? lines.length + offset : offset - 1;
		if (start < 0) return text("offset is past the start of the file", true);
		return {
			...result,
			content: [
				{ type: "text", text: lines.slice(start, limit === undefined ? undefined : start + limit).join("\n") },
				...content.filter(part => part.type !== "text"),
			],
		};
	}
	if (mapped.tail === undefined) return ctx.invokeTool(mapped.params, { signal, onUpdate });
	const head = await ctx.invokeTool(mapped.params, { signal, onUpdate });
	if (head?.isError) return head;
	const total = head?.details?.totalLines;
	if (!Number.isInteger(total)) return text("cannot count lines for a negative offset", true);
	const { path, offset, limit } = mapped.tail;
	const start = total + offset + 1;
	if (start < 1) return text("offset is past the start of the file", true);
	const end = Math.min(total, start + limit - 1);
	return ctx.invokeTool({ path: `${path}:${start}-${end}:raw` }, { signal, onUpdate });
}

// ------------------------------------------------------------- registration

export const GREP_DESCRIPTION = texts.grep;

export const BASH_DESCRIPTION = texts.bash;
export const GLOB_DESCRIPTION = texts.glob;
export const READ_DESCRIPTION = texts.read;

function grepSchema(z) {
	const d = texts.grepParameters;
	return z.object({
		pattern: z.string().describe(d.pattern),
		path: z.string().optional().describe(d.path),
		glob: z.string().optional().describe(d.glob),
		type: z.string().optional().describe(d.type),
		output_mode: z.string().optional().describe(d.output_mode),
		"-A": z.number().optional().describe(d["-A"]),
		"-B": z.number().optional().describe(d["-B"]),
		"-C": z.number().optional().describe(d["-C"]),
		"-i": z.boolean().optional().describe(d["-i"]),
		gitignore: z.boolean().optional(),
		multiline: z.boolean().optional().describe(d.multiline),
		head_limit: z.number().optional().describe(d.head_limit),
		offset: z.number().optional().describe(d.offset),
	});
}

function globSchema(z) {
	const d = texts.globParameters;
	return z.object({
		glob_pattern: z.string().describe(d.glob_pattern),
		target_directory: z.string().optional().describe(d.target_directory),
		hidden: z.boolean().optional(),
		gitignore: z.boolean().optional(),
		limit: z.number().optional(),
	});
}

function readSchema(z) {
	const d = texts.readParameters;
	return z.object({
		path: z.string().describe(d.path),
		offset: z.number().optional().describe(d.offset),
		limit: z.number().optional().describe(d.limit),
	});
}

function bashSchema(z) {
	const d = texts.bashParameters;
	return z.object({
		command: z.string().describe(d.command),
		timeout: z.number().optional(),
		pty: z.boolean().optional(),
		name: z.string().optional(),
		ready: z
			.object({ log: z.string().optional(), port: z.number().optional(), host: z.string().optional(), timeout: z.number().optional() })
			.optional(),
		working_directory: z.string().optional().describe(d.working_directory),
		block_until_ms: z.number().optional().describe(d.block_until_ms),
	});
}

export default function cursorTools(pi) {
	install(pi);
}

export function install(pi, options = {}) {
	const z = pi.zod;
	pi.registerTool({
		name: "grep",
		label: "grep",
		loadMode: "essential",
		concurrency: "shared",
		approval: args => (String(args?.path ?? "").includes("ssh://") ? "exec" : "read"),
		strict: false,
		description: GREP_DESCRIPTION,
		parameters: grepSchema(z),
		execute: async (toolCallId, params, signal, onUpdate, ctx) => executeGrep(toolCallId, params, signal, onUpdate, ctx, { maxColumns: await lineCap(pi), ...options }),
	});
	pi.registerTool({
		name: "glob",
		label: "glob",
		loadMode: "essential",
		concurrency: "shared",
		approval: args => (`${args?.glob_pattern ?? ""} ${args?.target_directory ?? ""}`.includes("ssh://") ? "exec" : "read"),
		strict: false,
		description: GLOB_DESCRIPTION,
		parameters: globSchema(z),
		execute: executeGlob,
	});
	pi.registerTool({
		name: "read",
		label: "read",
		loadMode: "essential",
		concurrency: "shared",
		approval: args => (String(args?.path ?? "").includes("ssh://") ? "exec" : "read"),
		strict: false,
		description: READ_DESCRIPTION,
		parameters: readSchema(z),
		execute: executeRead,
	});
	pi.registerTool({
		name: "bash",
		label: "bash",
		loadMode: "essential",
		concurrency: args => (args?.pty === true ? "exclusive" : "shared"),
		approval: "exec",
		strict: false,
		description: BASH_DESCRIPTION,
		parameters: bashSchema(z),
		execute: executeBash,
	});
	const enable = () => enableApplyPatch(pi);
	pi.on?.("session_start", enable);
	enable();
}

/** The per-line byte cap of tool output from the settings (omp://settings.md); 0 means no cap. */
async function lineCap(pi) {
	try {
		const { lookup } = await import("@oh-my-pi/pi-coding-agent/config/registry");
		return lookup("tools.outputMaxColumns")?.get(pi.pi.settings) ?? 0;
	} catch {
		return 0;
	}
}

/** Runtime-only: the apply-patch contract without touching the saved settings. */
async function enableApplyPatch(pi) {
	try {
		const { lookup } = await import("@oh-my-pi/pi-coding-agent/config/registry");
		lookup("edit.mode")?.override(pi.pi.settings, "apply_patch");
	} catch {
		// Registry unavailable in this runtime: keep the configured edit mode.
	}
}
