// grep wrapper: Cursor's ripgrep arguments over omp's native search engine.
// Plain paths go to the engine; archive members, line selectors, path lists and
// internal URLs go to the native tool unchanged.

import { contentEntries, contentLines, paginate } from "./render.js";

export const MODES = ["content", "files_with_matches", "count"];
const FILE_PAGE = 20;
const COLLECTED = 100000;
const TIMEOUT_MS = 20000;

const ARCHIVE = /\.(?:zip|tar|tgz|gz|jar|war|ear|apk|asar|7z|rar|iso|cab|deb|rpm|lzh|arj):/i;
const SELECTOR = /:(?:\d+(?:-\d+)?(?:,\d+(?:-\d+)?)*|raw|conflicts|img)$|:\d+\+\d+$/;

/** Anything the native tool does better than we can is handed back to it. */
export function routeFor(path) {
	if (typeof path !== "string" || path === "") return "engine";
	if (path.includes("://") || path.includes(";")) return "native";
	if (ARCHIVE.test(path) || SELECTOR.test(path)) return "native";
	return "engine";
}

function whole(name, value) {
	if (value === undefined || value === null) return undefined;
	if (!Number.isFinite(value) || value < 0) return { error: `${name} must be a non-negative number` };
	return Math.floor(value);
}

/** Validates the Cursor arguments once, so both branches read the same request. */
export function parseGrep(params) {
	const input = params ?? {};
	if (typeof input.pattern !== "string" || input.pattern.trim() === "") return { error: "pattern must not be empty" };
	const mode = input.output_mode ?? "content";
	if (!MODES.includes(mode)) return { error: `output_mode must be one of ${MODES.join(", ")}` };
	const numbers = {};
	for (const [name, field] of [["-A", input["-A"]], ["-B", input["-B"]], ["-C", input["-C"]], ["head_limit", input.head_limit], ["offset", input.offset], ["skip", input.skip]]) {
		const value = whole(name, field);
		if (value !== undefined && typeof value === "object") return value;
		numbers[name] = value;
	}
	const insensitive = input["-i"] === true;
	return {
		request: {
			pattern: input.pattern,
			path: typeof input.path === "string" && input.path !== "" ? input.path : undefined,
			glob: input.glob,
			type: input.type,
			mode,
			caseSensitive: insensitive ? false : input.case !== false,
			gitignore: input.gitignore !== false,
			multiline: input.multiline === true,
			contextBefore: numbers["-B"] ?? numbers["-C"],
			contextAfter: numbers["-A"] ?? numbers["-C"],
			headLimit: numbers.head_limit,
			offset: numbers.offset,
			skip: numbers.skip,
		},
	};
}

const NATIVE_REFUSED = [
	["output_mode", request => request.mode !== "content"],
	["-A/-B/-C", request => request.contextBefore !== undefined || request.contextAfter !== undefined],
	["type", request => request.type !== undefined],
	["multiline", request => request.multiline],
	["glob", request => request.glob !== undefined],
	["head_limit", request => request.headLimit !== undefined],
	["offset", request => request.offset !== undefined],
];

export function plainMessage(request) {
	const names = NATIVE_REFUSED.filter(([, refused]) => refused(request)).map(([name]) => name);
	if (names.length === 0) return undefined;
	return `${names.join(", ")} not supported for archive, selector, path-list or URL searches`;
}

async function defaultEngine() {
	const natives = await import("@oh-my-pi/pi-natives");
	return natives;
}

const ENGINE_MODES = { content: "content", count: "count", files_with_matches: "filesWithMatches" };

function engineRequest(request) {
	const mode = ENGINE_MODES[request.mode];
	return {
		pattern: request.pattern,
		path: request.path ?? ".",
		glob: request.glob,
		type: request.type,
		ignoreCase: !request.caseSensitive,
		multiline: request.multiline,
		hidden: true,
		gitignore: request.gitignore,
		mode,
		maxCount: COLLECTED,
		timeoutMs: TIMEOUT_MS,
		contextBefore: request.contextBefore,
		contextAfter: request.contextAfter,
	};
}

function text(value, isError = false) {
	return { content: [{ type: "text", text: value }], details: undefined, ...(isError ? { isError: true } : {}) };
}

/** Runs one search and renders it. `engine` is injected so tests never touch the real native module. */
export async function searchGrep(request, ctx, options = {}) {
	const engine = options.engine ?? (await defaultEngine());
	const natives = await engine;
	const result = await natives.grep(engineRequest(request));
	const outcome = result ?? {};
	if (request.mode === "content") {
		const entries = contentEntries(outcome.matches ?? []);
		const page = paginate(entries, contentLines, { offset: request.offset ?? request.skip ?? 0, limit: request.headLimit });
		const total = entries.length;
		const shown = page.next === undefined ? total : `${Math.min(page.next, total)}+`;
		const footer = page.next === undefined ? "" : `\n[${shown} of ${total} matches shown. Use offset=${page.next} for the next page.]`;
		return text(`${page.text || "No matches found"}${footer}`);
	}
	const files = [...new Set((outcome.matches ?? []).map(match => match.path))];
	const counts = new Map();
	for (const match of outcome.matches ?? []) counts.set(match.path, (counts.get(match.path) ?? 0) + (match.matchCount ?? 1));
	const entries = request.mode === "count" ? [...counts].map(([path, count]) => ({ path, count })) : files.map(path => ({ path }));
	const render = request.mode === "count" ? entry => [`${entry.path}:${entry.count}`] : entry => [entry.path];
	const page = paginate(entries, render, { offset: request.skip ?? 0, limit: request.headLimit ?? FILE_PAGE });
	const footer = page.next === undefined ? "" : `\n[Use skip=${page.next} for the next page.]`;
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
		return await searchGrep(request, ctx, options);
	} catch (error) {
		return text(error instanceof Error ? error.message : String(error), true);
	}
}
