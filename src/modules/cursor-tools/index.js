// Cursor-style arguments over omp's own tools, under omp's own names.
// `grep` runs on the native search engine for plain paths and delegates to the
// native tool for archives, selectors, masks, path lists and URLs; `bash` adds
// Cursor's block_until_ms: 0. The edit tool is switched to the apply-patch
// contract, which is what Cursor speaks.

import { isAbsolute, join, relative, resolve } from "node:path";
import texts from "./descriptions.json";

// ---------------------------------------------------------------- rendering

export const PAGE_BUDGET = 15000;
const TAIL = 400;

/** An oversized entry keeps its head and its tail, because the match may sit anywhere. */
export function cut(text) {
	if (text.length <= PAGE_BUDGET) return text;
	return `${text.slice(0, PAGE_BUDGET - TAIL - 1)}…${text.slice(-TAIL)}`;
}

/**
 * One entry per match line. A context line belongs to the next match in the file,
 * or to the last one after it, so a page never carries another match's context.
 */
export function contentEntries(matches, display = path => path) {
	const byFile = new Map();
	for (const match of matches) {
		const file = display(match.path);
		let list = byFile.get(file);
		if (list === undefined) byFile.set(file, (list = []));
		list.push(match);
	}
	const entries = [];
	for (const [file, list] of byFile) {
		list.sort((a, b) => a.lineNumber - b.lineNumber);
		const owned = new Map(list.map(match => [match.lineNumber, []]));
		const context = new Map();
		for (const match of list) {
			for (const side of [match.contextBefore ?? [], match.contextAfter ?? []]) {
				for (const line of side) {
					if (!context.has(line.lineNumber) && !owned.has(line.lineNumber)) {
						context.set(line.lineNumber, { lineNumber: line.lineNumber, line: line.line, isContext: true });
					}
				}
			}
		}
		let cursor = 0;
		for (const number of [...context.keys()].sort((a, b) => a - b)) {
			while (cursor < list.length && list[cursor].lineNumber < number) cursor++;
			const owner = cursor === list.length ? list.length - 1 : cursor;
			owned.get(list[owner].lineNumber).push(context.get(number));
		}
		for (const match of list) {
			const lines = [...owned.get(match.lineNumber), { lineNumber: match.lineNumber, line: match.line, isContext: false }];
			entries.push({ file, lines: lines.sort((a, b) => a.lineNumber - b.lineNumber) });
		}
	}
	return entries;
}

/** Match lines read `file:12:text`, context lines `file:12-text`, as ripgrep prints them. */
export function contentLines(entry) {
	return entry.lines.map(line => `${entry.file}:${line.lineNumber}${line.isContext ? "-" : ":"}${line.line}`);
}

/** Takes whole entries until the page budget, then names the next index. */
export function paginate(entries, render, options = {}) {
	const offset = options.offset ?? 0;
	const limit = options.limit;
	const budget = options.budget ?? PAGE_BUDGET;
	const lines = [];
	let used = 0;
	let taken = 0;
	let index = offset;
	for (; index < entries.length; index++) {
		if (limit !== undefined && taken >= limit) break;
		const chunk = render(entries[index]);
		const size = chunk.reduce((sum, line) => sum + line.length + 1, 0);
		if (taken > 0 && used + size > budget) break;
		if (taken === 0 && size > budget) {
			lines.push(cut(chunk.join("\n")));
			taken++;
			index++;
			break;
		}
		lines.push(...chunk);
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

const ARCHIVE = /\.(?:zip|tar|tgz|tbz2|txz|gz|jar|war|ear|apk|whl|asar|7z|rar|iso|cab|deb|rpm|cpio|ar|lzh|arj):/i;
const SELECTOR = /:(?:\d+\.\.\d*|\d+-\d*|-\d+|\d+\+\d+|raw|conflicts|img|\d+(?:-\d+)?)(?:,-?\d+(?:(?:-|\.\.)\d*)?)*$/;
const GLOB = /[*?[\]{}]/;

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
function engineRequest(request, base, signal) {
	const options = {
		pattern: request.pattern,
		path: base,
		glob: request.glob,
		type: request.type,
		ignoreCase: !request.caseSensitive,
		multiline: request.multiline,
		hidden: true,
		gitignore: request.gitignore,
		mode: ENGINE_MODES[request.mode],
		maxCount: COLLECTED,
		timeoutMs: TIMEOUT_MS,
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
	return parts.length === 0 ? "" : `\n[${parts.join("; ")}]`;
}

/** Runs one search and renders it. `engine` is injected so tests never touch the real native module. */
export async function searchGrep(request, ctx, options = {}) {
	const natives = await (options.engine ?? defaultEngine());
	const cwd = ctx?.cwd ?? process.cwd();
	const base = request.path === undefined ? cwd : isAbsolute(request.path) ? request.path : resolve(cwd, request.path);
	const display = path => {
		const absolute = isAbsolute(path) ? path : join(base, path);
		const shown = relative(cwd, absolute);
		return shown.startsWith("..") ? absolute : shown;
	};
	const outcome = (await natives.grep(engineRequest(request, base, options.signal))) ?? {};
	const tail = notes(outcome);
	const fileContinuation = next => `Use offset=${next} for the next page.`;
	if (request.mode === "content") {
		const entries = contentEntries(outcome.matches ?? [], display);
		const page = paginate(entries, contentLines, { offset: request.offset ?? 0, limit: request.headLimit });
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

/** Full tool body: route, then either delegate or search. */
export async function executeGrep(toolCallId, params, signal, onUpdate, ctx, options = {}) {
	const parsed = parseGrep(params);
	if (parsed.error !== undefined) return text(parsed.error, true);
	const request = parsed.request;
	if (routeFor(request.path) === "native") {
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
export function globRequest(params) {
	const input = params ?? {};
	const pattern = input.glob_pattern;
	if (typeof pattern !== "string" || pattern === "") return { error: "glob_pattern must not be empty" };
	const directory = input.target_directory;
	if (typeof directory !== "string" || directory === "") return { params: { path: pattern, hidden: input.hidden, gitignore: input.gitignore, limit: input.limit } };
	const recursive = pattern.startsWith("**/") ? pattern : `**/${pattern}`;
	return { params: { path: `${directory.replace(/\/+$/, "")}/${recursive}`, hidden: input.hidden, gitignore: input.gitignore, limit: input.limit } };
}

export async function executeGlob(toolCallId, params, signal, onUpdate, ctx) {
	const mapped = globRequest(params);
	if (mapped.error) return text(mapped.error, true);
	if (typeof ctx?.invokeTool !== "function") return text("native glob is unavailable in this runtime", true);
	const native = mapped.params;
	for (const key of Object.keys(native)) if (native[key] === undefined) delete native[key];
	return ctx.invokeTool(native, { signal, onUpdate });
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
export function readRequest(params) {
	const input = params ?? {};
	const path = input.path;
	if (typeof path !== "string" || path === "") return { error: "path must not be empty" };
	const offset = input.offset;
	const limit = input.limit;
	if (offset === undefined && limit === undefined) return { params: { path } };
	if (hasSelector(path)) return { error: "path already carries a selector; drop offset and limit" };
	if (offset !== undefined && (!Number.isInteger(offset) || offset === 0)) return { error: "offset must be a non-zero integer" };
	if (limit !== undefined && (!Number.isInteger(limit) || limit < 1)) return { error: "limit must be a positive integer" };
	const start = offset ?? 1;
	if (start < 0) {
		if (limit === undefined) return { params: { path: `${path}:-${Math.abs(start)}:raw` } };
		return { params: { path: `${path}:1-1:raw` }, tail: { path, offset, limit } };
	}
	if (limit !== undefined) return { params: { path: `${path}:${start}-${start + limit - 1}:raw` } };
	return { params: { path: `${path}:${start}-:raw` } };
}

export async function executeRead(toolCallId, params, signal, onUpdate, ctx) {
	const mapped = readRequest(params);
	if (mapped.error) return text(mapped.error, true);
	if (typeof ctx?.invokeTool !== "function") return text("native read is unavailable in this runtime", true);
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
	return z.object({
		command: z.string(),
		timeout: z.number().optional(),
		pty: z.boolean().optional(),
		name: z.string().optional(),
		ready: z
			.object({ log: z.string().optional(), port: z.number().optional(), host: z.string().optional(), timeout: z.number().optional() })
			.optional(),
		working_directory: z.string().optional(),
		block_until_ms: z.number().optional(),
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
		execute: (toolCallId, params, signal, onUpdate, ctx) => executeGrep(toolCallId, params, signal, onUpdate, ctx, options),
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

/** Runtime-only: the apply-patch contract without touching the saved settings. */
async function enableApplyPatch(pi) {
	try {
		const { lookup } = await import("@oh-my-pi/pi-coding-agent/config/registry");
		lookup("edit.mode")?.override(pi.pi.settings, "apply_patch");
	} catch {
		// Registry unavailable in this runtime: keep the configured edit mode.
	}
}
