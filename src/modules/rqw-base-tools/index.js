// RQW Base Tools: Cursor-style file tools over OMP, texts and guards.
// Marked workaround: the OMP engine and native tool classes are imported from an
// extension. OMP has no standard way for it; the guard checks these exports.

import { isUtf8 } from "node:buffer";
import { createReadStream, existsSync, readFileSync, realpathSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join, relative, resolve } from "node:path";
import reference from "./rqw-base-tools.reference.json";
import texts from "./rqw-base-tools.texts.json";

const TIMEOUT_MS = 30000, DRY_RUN_MS = 10000, MAX_FILE_BYTES = 4 * 1024 * 1024;
const NATIVES = "@oh-my-pi/pi-natives", OMP = "@oh-my-pi/pi-coding-agent/", TUI = "@oh-my-pi/pi-tui/tools/output-meta";
// OMP resolves its own packages for an extension only when the specifier is written out.
const MODULES = {
	[NATIVES]: () => import("@oh-my-pi/pi-natives"),
	[TUI]: () => import("@oh-my-pi/pi-tui/tools/output-meta"),
	[`${OMP}config/registry`]: () => import("@oh-my-pi/pi-coding-agent/config/registry"),
	[`${OMP}config/model-resolver`]: () => import("@oh-my-pi/pi-coding-agent/config/model-resolver"),
	[`${OMP}utils/file-display-mode`]: () => import("@oh-my-pi/pi-coding-agent/utils/file-display-mode"),
	[`${OMP}tools/approval-cache`]: () => import("@oh-my-pi/pi-coding-agent/tools/approval-cache"),
	[`${OMP}tools/read`]: () => import("@oh-my-pi/pi-coding-agent/tools/read"),
	[`${OMP}tools/grep`]: () => import("@oh-my-pi/pi-coding-agent/tools/grep"),
	[`${OMP}tools/glob`]: () => import("@oh-my-pi/pi-coding-agent/tools/glob"),
	[`${OMP}tools/approval-targets`]: () => import("@oh-my-pi/pi-coding-agent/tools/approval-targets"),
};
const size = text => Buffer.byteLength(text);
const slashes = path => path.replace(/\\/g, "/");
const rel = (root, path) => slashes(relative(root, resolve(root, path)));
// The file the engine works on: links resolved as far as the path exists.
const real = path => {
	try { return realpathSync.native(path); } catch {}
	const up = dirname(path);
	return up === path ? path : join(real(up), basename(path));
};
const answer = (text, isError) => ({ content: [{ type: "text", text }], details: undefined, ...(isError && { isError }) });
// Caught errors go to the OMP log (~/.omp/logs): the turn goes on, the trace stays.
let warn = () => {};
const settings = async (pi, load, keys) => {
	try {
		const { lookup } = await load(`${OMP}config/registry`);
		return Object.fromEntries(keys.map(key => [key, lookup(key)?.get(pi.pi.settings)]));
	} catch (error) { warn("settings read", error); }
};

// ---- Cursor-style file tools ----

const SPECIAL = /\.(?:zip|jar|apk|whl|vsix|tar|tgz|gz|bz2|xz|zst|7z|rar|iso|cab|cpio|rpm|deb|ar|lzh|arj|asar|db|sqlite3?|pdf|docx?|xlsx?|pptx?|ipynb|png|jpe?g|gif|webp|bmp|tiff?|heic|heif|avif|ico|svgz?|mp4|m4v|mov|webm|mkv|avi)$/i;
const nativeGlobPattern = (pattern, directory) => (!directory ? /^www\.|[;:]/i : /^(?:[a-z][a-z0-9+.-]*:\/\/|local:\/)|[\\/]local:\/\/(?=[^/]|$)/i).test(pattern);
const absolute = (cwd, path) => resolve(cwd, (path || ".").replace(/^~(?=\/|$)/, homedir()));
// An existing literal wins over selector, list and mask syntax.
function localStat(path, cwd, bigint = false) {
	if (path != null && (typeof path !== "string" || /^[a-z][a-z0-9+.-]*:\/\//i.test(path) || SPECIAL.test(path))) return;
	try {
		const info = statSync(absolute(cwd, path), { bigint, throwIfNoEntry: false });
		if (info?.isFile() || info?.isDirectory()) return info;
	} catch {}
}

const stamp = path => statSync(path, { bigint: true, throwIfNoEntry: false });
const unchanged = (a, b) => b && a.dev === b.dev && a.ino === b.ino && a.size === b.size && a.mtimeNs === b.mtimeNs && a.ctimeNs === b.ctimeNs;
const nativeGrep = args => args?.case !== undefined || args?.skip !== undefined;
// The captured native tool already adds its notice; the outer OMP wrapper adds it again.
const delegated = async (ctx, params, signal, onUpdate, load) => {
	const result = await ctx.invokeTool(params, { signal, onUpdate }), meta = result.details?.meta;
	if (!meta) return result;
	const { stripOutputNotice } = await load(TUI), content = [...result.content], at = content.findLastIndex(block => block.type === "text");
	if (at >= 0) content[at] = { ...content[at], text: stripOutputNotice(content[at].text, meta) };
	return { ...result, content };
};
const integer = (value, min = 0) => value === undefined || (Number.isSafeInteger(value) && value >= min);

async function lineCount(path, bytes, length, signal) {
	let lines = 0, last;
	for await (const chunk of bytes ? [bytes] : createReadStream(path, { end: length - 1, signal })) {
		for (let at = chunk.indexOf(10); at !== -1; at = chunk.indexOf(10, at + 1)) lines++;
		last = chunk.at(-1);
	}
	return lines + Number(last !== 10);
}

// Native local read ignores cancellation inside its file window; stop waiting on abort.
async function abortable(signal, run) {
	if (!signal) return run();
	signal.throwIfAborted();
	let abort;
	const cancelled = new Promise((_, reject) => {
		abort = () => reject(signal.reason);
		signal.addEventListener("abort", abort, { once: true });
	});
	try { return await Promise.race([run(), cancelled]); }
	finally { signal.removeEventListener("abort", abort); }
}

async function runRead(params, ctx, signal, onUpdate, load, editable) {
	const { path, offset, limit } = params;
	if (offset === undefined && limit === undefined) return delegated(ctx, params, signal, onUpdate, load);
	if (!integer(offset, -Number.MAX_SAFE_INTEGER) || offset === 0 || !integer(limit, 1)) return answer("offset must be a non-zero integer; limit must be a positive integer", true);
	signal?.throwIfAborted();
	if (typeof ctx.invokeTool !== "function") throw new Error("Native read is unavailable.");
	const full = absolute(ctx.cwd, path), info = localStat(path, ctx.cwd, true);
	if (!info?.isFile()) return answer(texts.readRangeTarget, true);
	if (info.size === 0n) return delegated(ctx, { path }, signal, onUpdate, load);
	const length = Number(info.size), small = length <= MAX_FILE_BYTES;
	const hash = small && (await load(NATIVES)).hashlineFileHash;
	const bytes = Buffer.from(await Bun.file(full).slice(0, small ? length : 65536).arrayBuffer());
	if (bytes.includes(0) || (small && !isUtf8(bytes))) return answer(texts.readRangeTarget, true);
	const total = offset < 0 ? await lineCount(full, small ? bytes : undefined, length, signal) : undefined;
	const start = offset < 0 ? Math.max(1, total + offset + 1) : offset ?? 1;
	const end = limit === undefined ? "" : Math.min(Number.MAX_SAFE_INTEGER, start + limit - 1);
	const selected = `${full}:raw:${start}-${end}`;
	if (existsSync(selected)) return answer("Read selector conflicts with a literal file.", true);
	const result = await abortable(signal, () => delegated(ctx, { path: selected }, signal, onUpdate, load));
	if (!unchanged(info, stamp(full))) return answer("File changed during read; retry.", true);
	const details = result.details, display = details?.displayContent, block = result.content?.[0];
	const eof = !result.isError && details?.raw && block?.type === "text" && block.text === "" && /^Line \d+ is beyond end of file \((\d+) lines total\)\./.exec(details.notes?.[0]);
	if (eof) return answer(texts.readPastEnd.replace("{line}", start).replace("{total}", eof[1]));
	if (result.isError || !display?.lineNumbers?.length || block?.type !== "text" || details.truncation?.firstLineExceedsLimit || /^\n\n\[Showing line \d+ \(partial, [^\n]+\); file not scanned to EOF\]$/.test(block.text.slice(display.text.length))) return result;
	if (!details.raw || details.fileSize !== length || details.meta?.source?.type !== "path" || real(details.meta.source.value) !== real(full)) return result;
	// An open native raw range can count its terminal LF as an extra display row.
	const shown = display.lineNumbers.filter(n => n > 0 && n <= (details.totalLines ?? Infinity));
	if (!shown.length) return result;
	const text = display.text.split("\n").slice(0, shown.length), source = small ? bytes.toString("utf8") : undefined, rows = source?.replace(/^\uFEFF/, "").replace(/\r\n/g, "\n").split("\n");
	const tag = editable && rows && !/\r(?!\n)/.test(source) && shown[0] === start && shown.every((n, i) => rows[n - 1] === text[i].replace(/\r$/, "")) && hash(source);
	const body = shown.map((line, i) => `${line}:${text[i].replace(/\r$/, "")}`).join("\n");
	const next = shown.at(-1) + 1, remaining = (details.totalLines ?? total ?? Infinity) - next + 1;
	const footer = remaining > 0 ? `\n[${Number.isFinite(remaining) ? `${remaining} more lines. ` : ""}Use offset=${next} to continue]` : "";
	return { ...result, content: [{ type: "text", text: `${tag ? `[${path}#${tag}]\n` : ""}${body}${footer}` }], details: { ...details, displayContent: { ...display, lineNumbers: shown, text: text.join("\n") }, raw: false, rowPrefixes: true } };
}

const globMask = pattern => pattern.replace(/^(?:\.\/)*(\*\*\/)?/, "**/");
const globArgs = args => {
	const { path, target_directory: directory, glob_pattern: pattern } = args ?? {};
	if (path !== undefined || !pattern) return { path: path ?? (directory || undefined) };
	const mask = nativeGlobPattern(pattern) ? pattern : globMask(pattern);
	return { path: directory ? `${directory.replace(/\/$/, "")}/${mask}` : mask };
};
const globRoot = ({ path, target_directory: directory, glob_pattern: pattern }, cwd) =>
	path === undefined && pattern && !nativeGlobPattern(pattern, directory) && localStat(directory, cwd)?.isDirectory() ? absolute(cwd, directory || ".") : undefined;

async function delegateGlob(args, ctx, signal, onUpdate, load) {
	const { limit } = args;
	if (limit !== undefined && (!Number.isFinite(limit) || limit <= 0)) return answer("Limit must be a positive number", true);
	const native = Object.fromEntries(Object.entries(args).filter(([, value]) => value !== undefined));
	if (limit !== undefined) native.limit = Math.min(200, Math.max(1, Math.floor(limit)));
	const result = await delegated(ctx, native, signal, onUpdate, load);
	if (!(limit > 200) || result.isError || !result.details?.fileCount) return result;
	const content = [...result.content], at = content.findLastIndex(block => block.type === "text");
	if (at < 0) return result;
	content[at] = { ...content[at], text: `${content[at].text}\n\nRequested limit ${limit} clamped to the max of 200` };
	return { ...result, content };
}

async function runGlob(params, ctx, signal, onUpdate, load) {
	const { glob_pattern: pattern, target_directory, path, hidden, gitignore, limit } = params, directory = target_directory || undefined;
	if (path !== undefined) {
		if (pattern !== undefined || directory !== undefined) return answer("Use path for native glob, or glob_pattern and target_directory.", true);
		return delegateGlob({ path, hidden, gitignore, limit }, ctx, signal, onUpdate, load);
	}
	if (!pattern) return delegateGlob({ path: directory, hidden, gitignore, limit }, ctx, signal, onUpdate, load);
	const root = globRoot(params, ctx.cwd);
	if (!root) {
		if (directory && nativeGlobPattern(pattern)) return answer("Use path for a native address or path list.", true);
		return delegateGlob({ ...globArgs(params), hidden, gitignore, limit }, ctx, signal, onUpdate, load);
	}
	if (root === dirname(root)) return answer("Searching from root directory '/' is not allowed", true);
	if (limit !== undefined && (!Number.isFinite(limit) || limit <= 0)) return answer("Limit must be a positive number", true);
	const natives = await load(NATIVES);
	const result = await natives.glob({
		path: root, pattern: globMask(pattern), fileType: natives.FileType.File,
		hidden: hidden !== false, gitignore: gitignore !== false, sortByMtime: true, timeoutMs: TIMEOUT_MS, signal,
	});
	const files = result.matches.map(match => match.path), output = [`Result of search in '${directory ?? "."}' (total ${files.length} files):`];
	const cap = Math.min(100, Math.max(1, Math.floor(limit ?? 100)));
	let used = output[0].length, count = 0;
	for (const file of files) {
		const line = `- ${file}`;
		if (count >= cap || (count && used + line.length + 1 > 4800)) break;
		output.push(line);
		used += line.length + 1;
		count++;
	}
	if (count < files.length) output.push(`... ${files.length - count} more files ... (Do a more specific search if needed)`);
	return answer(output.join("\n"));
}

// A page holds whole matching entries; overlapping context rows appear only once.
function grepPage(matches, cwd, root, offset, limit, before, after) {
	const files = new Map(), entries = [];
	for (const match of matches) {
		const full = resolve(root, match.path), file = files.get(full) ?? { full, path: rel(cwd, full), rows: new Map() };
		files.set(full, file);
		const parts = match.line.split(/\r?\n/);
		for (const row of [...(match.contextBefore ?? []), ...(match.contextAfter ?? [])]) if (!file.rows.has(row.lineNumber)) file.rows.set(row.lineNumber, row.line);
		parts.forEach((line, i) => file.rows.set(match.lineNumber + i, line));
		entries.push({ file, start: match.lineNumber, end: match.lineNumber + parts.length - 1 });
	}
	const page = new Map();
	let used = 0, taken = 0, index = offset, partial = false;
	for (; index < entries.length && (limit === undefined || taken < limit); index++) {
		const entry = entries[index], rows = page.get(entry.file) ?? new Map(), add = [];
		const low = Math.max(1, entry.start - before), high = entry.end + after;
		if (high - low < entry.file.rows.size) {
			for (let n = low; n <= high; n++) if (entry.file.rows.has(n) && !rows.has(n)) add.push([n, entry.file.rows.get(n)]);
		} else for (const [n, text] of entry.file.rows) if (n >= low && n <= high && !rows.has(n)) add.push([n, text]);
		const cost = add.reduce((n, [number, text]) => n + String(number).length + text.length + 5, page.has(entry.file) ? 0 : entry.file.path.length + 10);
		if (taken && used + cost > 14500) break;
		if (!taken && cost > 14500) {
			add.sort((a, b) => Number(b[0] >= entry.start && b[0] <= entry.end) - Number(a[0] >= entry.start && a[0] <= entry.end));
			let room = 14000;
			for (const [n, text] of add) {
				if (room < 50) break;
				const short = text.length + 25 > room, shown = short ? `${text.slice(0, room - 40)}... [line truncated; use read]` : text;
				rows.set(n, { text: shown, match: n >= entry.start && n <= entry.end, partial: short });
				room -= shown.length + String(n).length + 5;
			}
			page.set(entry.file, rows);
			taken++;
			partial = true;
			break;
		}
		for (const [number, text] of add) rows.set(number, { text, match: false });
		for (let number = entry.start; number <= entry.end; number++) if (rows.has(number)) rows.get(number).match = true;
		page.set(entry.file, rows);
		used += cost;
		taken++;
	}
	return { page, taken, total: entries.length, partial };
}

// Native grep mints the session snapshot and marks only rows actually shown.
async function grepHeader(file, rows, ctx, signal, load, store, editable) {
	const untagged = `[${file.path}]`, info = stamp(file.full);
	if (!editable || !info?.isFile() || info.size > MAX_FILE_BYTES) return untagged;
	const natives = await load(NATIVES), bytes = await Bun.file(file.full).slice(0, Number(info.size)).arrayBuffer().catch(() => undefined);
	if (!bytes) return untagged;
	const text = Buffer.from(bytes).toString("utf8");
	if (/\r(?!\n)/.test(text)) return untagged;
	const lines = text.replace(/\r\n/g, "\n").split("\n"), before = natives.hashlineFileHash(text);
	if ([...rows].some(([n, row]) => row.partial || lines[n - 1]?.trimEnd() !== row.text)) return untagged;
	const seen = [...rows].filter(([n]) => size(lines[n - 1]) <= 512).map(([n]) => n);
	for (let i = 0; i < seen.length; i += 30) {
		const path = `${file.full}:${seen.slice(i, i + 30).map(n => `${n}-${n}`).join(",")}`;
		if (existsSync(path)) return untagged;
		const result = await delegated(ctx, { pattern: "^", path }, signal, () => {}, load);
		if (/^\[.*#([0-9A-F]{4})\]/m.exec(result.content?.[0]?.text ?? "")?.[1] !== before) return untagged;
	}
	if (!seen.length || !unchanged(info, stamp(file.full))) return untagged;
	try { store?.recordSnapshot(file.full, text, seen); } catch (error) { warn("grep snapshot", error); }
	return `[${file.path}#${before}]`;
}

async function runGrep(params, ctx, signal, onUpdate, load, store, editable) {
	const { pattern, path, gitignore, output_mode: mode = "content" } = params;
	const target = !nativeGrep(params) && localStat(path, ctx.cwd);
	if (!target) {
		const extra = Object.keys(params).filter(key => params[key] !== undefined && !["pattern", "path", "case", "gitignore", "skip"].includes(key));
		if (extra.length) return answer(`Native grep does not support ${extra.join(", ")}.`, true);
		return delegated(ctx, params, signal, onUpdate, load);
	}
	if (!pattern?.trim()) return answer("pattern must not be empty", true);
	for (const key of ["-A", "-B", "-C", "head_limit", "offset"]) if (!integer(params[key])) return answer(`${key} must be a non-negative integer`, true);
	const root = absolute(ctx.cwd, path), before = params["-B"] ?? params["-C"] ?? 0, after = params["-A"] ?? params["-C"] ?? 0;
	const offset = params.offset ?? 0, limit = params.head_limit || undefined, natives = await load(NATIVES);
	const multiline = params.multiline === true || pattern.includes("\n") || pattern.includes("\\n");
	if (params.glob && target.isFile()) {
		const exclude = params.glob.startsWith("!"), glob = new Bun.Glob(exclude ? params.glob.slice(1) : params.glob);
		if (exclude === (glob.match(basename(root)) || glob.match(rel(ctx.cwd, root)))) return answer(`<workspace_result workspace_path="${ctx.cwd}">\nNo matching files${multiline ? "\nMultiline search checks at most the first 4 MiB of each file." : ""}\n</workspace_result>`);
	}
	const result = await natives.grep({
		pattern: params.multiline ? `(?s)${pattern}` : pattern, path: root, glob: params.glob, type: params.type, ignoreCase: params["-i"] === true,
		multiline, hidden: true, gitignore: gitignore !== false,
		mode: mode === "files_with_matches" ? "filesWithMatches" : mode,
		contextBefore: mode === "content" ? before : 0, contextAfter: mode === "content" ? after : 0,
		maxCount: mode === "content" ? Math.max(100000, offset + 1000) : undefined, timeoutMs: TIMEOUT_MS, signal,
	});
	const { matches } = result, head = `<workspace_result workspace_path="${ctx.cwd}">`, output = [head];
	let total, taken;
	if (mode === "content") {
		const page = grepPage(matches, ctx.cwd, root, offset, limit, before, after);
		total = page.total;
		taken = page.taken;
		for (const [file, rows] of page.page) {
			if (output.length > 1) output.push("");
			output.push(await grepHeader(file, rows, ctx, signal, load, store, editable));
			for (const [number, row] of [...rows].sort((a, b) => a[0] - b[0])) output.push(`  ${number}${row.match ? ":" : "-"}${row.text}`);
		}
		if (page.partial) output.push("[A line or context was truncated. Use read for the full lines.]");
	} else {
		total = matches.length;
		const chosen = matches.slice(offset, limit === undefined ? undefined : offset + limit);
		taken = 0;
		for (const match of chosen) {
			const file = rel(ctx.cwd, resolve(root, match.path)), line = mode === "count" ? `${file}:${match.matchCount}` : file;
			if (taken && output.join("\n").length + line.length > 14500) break;
			output.push(line);
			taken++;
		}
	}
	if (!taken) output.push(multiline ? total ? "No more results in searched content" : "No matches in searched content" : "No matches found");
	if (offset + taken < total || result.limitReached) output.push(`[Showing ${taken} of at least ${Math.max(total, offset + taken + 1)} matching ${mode === "content" ? "lines" : "files"}. Use offset=${offset + taken} to see more, or narrow the search.]`);
	if (multiline) output.push("Multiline search checks at most the first 4 MiB of each file; matches beyond that window are not shown.");
	if (result.skippedOversized) output.push(`[Skipped ${result.skippedOversized} unreadable large files.]`);
	if (result.binaryMatches?.length) output.push(`[Binary files also match: ${result.binaryMatches.join(", ")}]`);
	output.push("</workspace_result>");
	return answer(output.join("\n"));
}

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
		if (tool.nativeSchema && want.schema && JSON.stringify(tool.nativeSchema) !== JSON.stringify(want.schema)) return `rqw-base-tools: native ${name} changed schema`;
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
		const notice = await load(TUI);
		for (const [name, kind] of Object.entries(reference.notice)) if (typeof notice[name] !== kind) return `rqw-base-tools: notice ${name} changed`;
	} catch (error) {
		warn("engine check", error);
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

function rewriteEval(node) {
	if (!node || typeof node !== "object") return;
	if (Array.isArray(node.tools)) for (const item of node.tools) if (item && typeof item === "object") {
		const tool = item.function && typeof item.function === "object" ? item.function : item;
		if (typeof tool.name !== "string" || canon(tool.name) !== "eval" || typeof tool.description !== "string") continue;
		let text = tool.description;
		if (!text.includes(texts.eval.add)) text = text.replace(/\n|$/, `\n${texts.eval.add}$&`);
		tool.description = text.replaceAll(...texts.eval.swap);
	}
	for (const value of Object.values(node)) rewriteEval(value);
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

function recordShown(store, natives, cwd, path, content) {
	if (!store || !natives || !path) return;
	const info = stamp(path);
	if (!info?.isFile() || info.size > MAX_FILE_BYTES) return;
	const source = readFileSync(path, "utf8"), rows = source.replace(/^\uFEFF/, "").replace(/\r\n/g, "\n").split("\n");
	const output = content.filter(block => block.type === "text").map(block => block.text).join("\n").split("\n");
	let tag, seen = [];
	for (const line of output) {
		const header = /^\[([^\]#]+)#([0-9A-F]{4})\]$/.exec(line);
		if (header) {
			if (tag) break;
			if (real(resolve(cwd, header[1])) === real(path)) tag = header[2];
			continue;
		}
		if (!tag) continue;
		const row = /^\s*\*?(\d+):(.*)$/.exec(line), number = Number(row?.[1]);
		if (row && rows[number - 1] === row[2]) seen.push(number);
	}
	if (tag && tag === natives.hashlineFileHash(source) && unchanged(info, stamp(path))) store.recordSnapshot(path, source, [0, ...seen]);
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
	} catch (error) { warn("whole file count", error); }
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
	warn = (where, error) => void pi.logger.warn(`rqw-base-tools: ${where}`, { error: String(error?.stack ?? error) });
	const z = pi.zod, text = z.string().optional(), flag = z.boolean().optional();
	const int = z.number().int(), nonnegative = int.min(0).max(Number.MAX_SAFE_INTEGER).optional();
	let session, keys, store, builtins, natives;
	const pending = new Map(), readWaits = new Map();
	const editable = async ctx => {
		try {
			const [{ resolveFileDisplayMode }, { formatModelStringWithRouting }] = await Promise.all([load(`${OMP}utils/file-display-mode`), load(`${OMP}config/model-resolver`)]);
			return resolveFileDisplayMode({ settings: pi.pi.settings, hasEditTool: pi.getActiveTools().some(name => canon(name) === "edit"), getActiveModelString: () => ctx.model && formatModelStringWithRouting(ctx.model) }).hashLines;
		} catch (error) { warn("edit mode", error); return false; }
	};
	pi.on("session_start", async (_event, ctx) => {
		session = ctx.sessionManager;
		keys = { ...(await load(`${OMP}tools/approval-cache`)), ...(await load(`${OMP}tools/approval-targets`)) };
		natives = await load(NATIVES).catch(error => warn("engine import", error));
		store = natives && new natives.EditStore();
		const toolSession = { get cwd() { return session.getCwd(); }, settings: pi.pi.settings, hasEditTool: true, getSessionSpawns: () => "*" };
		try {
			const [read, grep, glob] = await Promise.all(["read", "grep", "glob"].map(name => load(`${OMP}tools/${name}`)));
			builtins = { read: new read.ReadTool(toolSession), grep: new grep.GrepTool(toolSession), glob: new glob.GlobTool(toolSession) };
		} catch (error) {
			warn("native tool import", error);
			ctx.ui?.notify?.("rqw-base-tools: native tool import failed", "warning");
		}
	});

	const tier = (name, args) => builtins?.[name]?.approval(args) ?? "exec";
	const targets = (name, args) => builtins?.[name]?.approvalCacheTargets(args);
	const cwd = () => session?.getCwd();
	const tree = root => keys.approvalTreeSearchKey(keys.approvalDirectoryKey(root));
	const grepTarget = args => !nativeGrep(args) && cwd() && localStat(args?.path, cwd());
	pi.registerTool({
		name: "grep", label: "grep", loadMode: "discoverable", strict: false,
		approval: args => grepTarget(args) ? "read" : tier("grep", args),
		approvalCacheTargets: args => {
			const target = grepTarget(args);
			if (!target) return targets("grep", args);
			const root = absolute(cwd(), args?.path);
			return [target.isDirectory() ? tree(root) : keys.approvalCacheKeyForPath(root)];
		},
		description: texts.grep,
		parameters: z.object({
			pattern: z.string(), path: text, glob: text, type: text, output_mode: z.enum(["content", "files_with_matches", "count"]).optional(),
			"-A": nonnegative, "-B": nonnegative, "-C": nonnegative, "-i": flag, head_limit: nonnegative, offset: nonnegative, multiline: flag,
			case: flag, gitignore: flag, skip: z.number().nullable().optional(),
		}),
		execute: async (_id, params, signal, onUpdate, ctx) => runGrep(params, ctx, signal, onUpdate, load, store, await editable(ctx)),
	});
	pi.registerTool({
		name: "glob", label: "glob", loadMode: "essential", strict: false,
		approval: args => cwd() && globRoot(args ?? {}, cwd()) ? "read" : tier("glob", globArgs(args)),
		approvalCacheTargets: args => {
			const root = cwd() && globRoot(args ?? {}, cwd());
			return root ? [tree(root)] : targets("glob", globArgs(args));
		},
		description: texts.glob,
		parameters: z.object({ glob_pattern: text, target_directory: text, path: text, hidden: flag, gitignore: flag, limit: z.number().positive().optional() }),
		execute: (_id, params, signal, onUpdate, ctx) => runGlob(params, ctx, signal, onUpdate, load),
	});
	pi.registerTool({
		name: "read", label: "read", loadMode: "essential", readsSkillUris: true, strict: false,
		approval: args => tier("read", args), approvalCacheTargets: args => targets("read", args),
		docTopics: () => builtins?.read?.docTopics?.() ?? {},
		description: texts.read,
		parameters: z.object({ path: z.string(), offset: z.union([int.min(-Number.MAX_SAFE_INTEGER).max(-1), int.min(1).max(Number.MAX_SAFE_INTEGER)]).optional(), limit: int.min(1).max(Number.MAX_SAFE_INTEGER).optional() }),
		execute: async (id, params, signal, onUpdate, ctx) => {
			const wait = readWaits.get(id);
			readWaits.delete(id);
			if (wait) await abortable(signal, () => wait);
			return runRead(params, ctx, signal, onUpdate, load, await editable(ctx));
		},
	});

	// Only tool definitions change: messages stay as they are.
	const checked = new Set();
	pi.on("before_provider_request", async (event, ctx) => {
		const tools = toolsOf(event.payload), id = ctx.sessionManager?.getSessionId();
		if (tools.length && !checked.has(id)) {
			checked.add(id);
			const observed = tools.map(tool => {
				const base = builtins?.[canon(tool.name)];
				if (!base) return tool;
				const schema = base.parameters.toJsonSchema();
				return { name: tool.name, description: base.description, nativeSchema: schema, parameters: schema };
			});
			const moved = checkReference(observed, await settings(pi, load, Object.keys(reference.settings)), ctx.agent?.kind === "sub") ?? await checkEngine(load);
			if (moved) ctx.ui?.notify?.(moved, "warning");
		}
		rewrite(tools);
		rewriteEval(event.payload);
		return event.payload;
	});

	const skips = new Map();
	// A call that was denied or cancelled gets no result: its entry goes when the call ends.
	pi.on("tool_execution_end", event => {
		skips.delete(event.toolCallId);
		pending.get(event.toolCallId)?.resolve();
		pending.delete(event.toolCallId);
		readWaits.delete(event.toolCallId);
	});
	pi.on("tool_call", async (event, ctx) => {
		const name = canon(event.toolName), input = event.input?.input;
		if (name === "bash") pending.set(event.toolCallId, Promise.withResolvers());
		if (name === "read") readWaits.set(event.toolCallId, Promise.all([...pending.values()].map(item => item.promise)));
		skips.delete(event.toolCallId);
		if (canon(event.toolName) !== "edit" || typeof input !== "string") return;
		// Fail open: an error or a slow dry run leaves the patch to the native edit.
		const partial = await Promise.race([
			dryRunner(pi, load, ctx.cwd, store).then(dry => partialPatch(input, ctx.cwd, dry)).catch(error => warn("patch dry run", error)),
			new Promise(done => setTimeout(done, DRY_RUN_MS).unref()),
		]);
		if (!partial) return;
		skips.set(event.toolCallId, partial.skipped);
		return { input: { input: partial.input } };
	});
	pi.on("tool_result", (event, ctx) => {
		const content = wholeFile(event), skipped = skips.get(event.toolCallId), details = event.details, name = canon(event.toolName);
		if (!event.isError) try {
			const entries = name === "read" ? [details?.meta?.source] : name === "edit" ? details?.perFileResults ?? [details] : [];
			for (const entry of entries) {
				const path = entry?.path ?? (entry?.type === "path" ? entry.value : undefined);
				entry?.sourcePath && store?.relocate(entry.sourcePath, path);
				if (name === "edit" && path) store?.recordSnapshotFile(path, [0]);
				recordShown(store, natives, ctx?.cwd ?? session?.getCwd(), path, event.content);
			}
		} catch (error) { warn("edit snapshot", error); }
		if (content) return { content };
		if (skips.delete(event.toolCallId)) return skippedResult(event, skipped);
	});
}
