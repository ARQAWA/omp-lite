// Cursor-style arguments over omp's own tools, under omp's own names.
// `grep` runs on the native search engine for plain paths and delegates to the
// native tool for archives, selectors, masks, path lists and URLs; `bash` adds
// Cursor's block_until_ms: 0. The edit tool is switched to the apply-patch
// contract, which is what Cursor speaks.

import { statSync } from "node:fs";
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

const ARCHIVE = /\.(?:zip|tar|tgz|gz|jar|war|ear|apk|asar|7z|rar|iso|cab|deb|rpm|lzh|arj):/i;
const SELECTOR = /:(?:\d+-\d*|-\d+|\d+\+\d+|raw|conflicts|img|\d+(?:-\d+)?)(?:,-?\d+(?:-\d+)?)*$/;
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
		["skip", input.skip, 0],
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
			caseSensitive: input["-i"] === true ? false : input.case !== false,
			gitignore: input.gitignore !== false,
			multiline: input.multiline === true || automatic,
			explicitMultiline: input.multiline === true,
			contextBefore: mode === "content" ? (numbers["-B"] ?? numbers["-C"]) : undefined,
			contextAfter: mode === "content" ? (numbers["-A"] ?? numbers["-C"]) : undefined,
			headLimit: numbers.head_limit,
			offset: numbers.offset,
			skip: numbers.skip,
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
	["offset", request => request.offset !== undefined],
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

function isFile(path) {
	try {
		return statSync(path).isFile();
	} catch {
		return false;
	}
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
	const singleFile = isFile(base);
	const outcome = (await natives.grep(engineRequest(request, base, options.signal))) ?? {};
	const tail = notes(outcome);
	const fileContinuation = next =>
		request.offset !== undefined ? `Use offset=${next} for the next page.` : `Use skip=${next} for the next page.`;
	if (request.mode === "content") {
		const all = contentEntries(outcome.matches ?? [], display);
		const skipFiles = singleFile ? 0 : (request.skip ?? 0);
		const dropped = new Set([...new Set(all.map(entry => entry.file))].slice(0, skipFiles));
		const entries = dropped.size === 0 ? all : all.filter(entry => !dropped.has(entry.file));
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
	const start = request.offset ?? (singleFile ? 0 : (request.skip ?? 0));
	const page = paginate(entries, render, { offset: start, limit: request.headLimit ?? FILE_PAGE });
	const footer = page.next === undefined ? tail : `\n[${fileContinuation(page.next)}]${tail}`;
	return text(`${page.text || "No matches found"}${footer}`);
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
		return ctx.invokeTool(
			{ pattern: request.pattern, path: request.path, case: request.caseSensitive, gitignore: request.gitignore, skip: request.skip },
			{ signal, onUpdate },
		);
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

// ------------------------------------------------------------- registration

export const GREP_DESCRIPTION = texts.grep;

export const BASH_DESCRIPTION = texts.bash;

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
		case: z.boolean().optional(),
		gitignore: z.boolean().optional(),
		multiline: z.boolean().optional().describe(d.multiline),
		head_limit: z.number().optional().describe(d.head_limit),
		offset: z.number().optional().describe(d.offset),
		skip: z.number().optional(),
	});
}

function bashSchema(z) {
	return z.object({
		command: z.string(),
		timeout: z.number().optional(),
		cwd: z.string().optional(),
		pty: z.boolean().optional(),
		async: z.boolean().optional(),
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
		strict: false,
		description: GREP_DESCRIPTION,
		parameters: grepSchema(z),
		execute: (toolCallId, params, signal, onUpdate, ctx) => executeGrep(toolCallId, params, signal, onUpdate, ctx, options),
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
