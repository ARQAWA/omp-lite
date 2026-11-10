// `files`: the project file map on OMP's own native glob engine.
// No 200-path cap and no git: the engine walks the directory itself.
// The engine import is a marked workaround: omp://extensions.md does not
// describe imports from an extension, but cursor-tools already does it.

import { isAbsolute, relative, resolve } from "node:path";

export const TIMEOUT_MS = 30000;
export const SPILL_RESERVE_KB = 5;

export const FILES_DESCRIPTION = `Project file map. One call covers the whole directory, nothing is dropped.
- No \`pattern\`: all files under \`path\` that match \`glob\`. First line: \`total N files\`.
Every file is either listed or counted in a folded line of its directory: \`src/vendor/ (812 files)\`. Expand a folded directory with \`path\`.
Left out, as in \`glob\`: files excluded by \`.gitignore\` (unless \`gitignore: false\`), \`node_modules\`, \`.git\`.
Local directories only.
Last line is always \`[all N files listed]\` or \`[N files: K listed, the rest folded into M directories]\`.
A timeout is an error, never a partial list: narrow \`path\`.
Send all independent \`files\` calls in one response.
Next step: \`read\` every relevant file, all in one response.`;

const bytes = line => Buffer.byteLength(`${line}\n`);
const byPath = (a, b) => a.localeCompare(b);

/** The answer budget: the spill threshold minus a small reserve for the last line. */
export function mapBudget(threshold) {
	const kb = Number.isFinite(threshold) ? threshold : 50;
	return Math.max(1, (kb - SPILL_RESERVE_KB) * 1024);
}

/** Engine paths are relative to the search root; keep one stable path spelling. */
export function normalizeFiles(files, root) {
	const shown = files.map(file => {
		const path = isAbsolute(file) ? file : resolve(root, file);
		return relative(root, path).replace(/\\/g, "/");
	});
	return [...new Set(shown)].sort(byPath);
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
 * Renders the map under `budget` bytes. Deep directories are folded first,
 * then the root. Counts in the last line always add up to the total.
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
		const label = group.dir === "" ? `./ (${group.names.length} files)` : `${group.dir}/ (${group.names.length} files)`;
		for (const line of lines.get(group)) size -= bytes(line);
		size += bytes(label);
		lines.set(group, [label]);
		folded.add(group);
	};
	const total = () => size + bytes(footer());

	while (total() > budget) {
		const next = groups
			.filter(group => !folded.has(group) && group.dir !== "")
			.sort((a, b) => b.depth - a.depth || b.dir.localeCompare(a.dir))[0];
		if (next === undefined) break;
		fold(next);
	}
	const root = groups.find(group => group.dir === "");
	if (total() > budget && root !== undefined && !folded.has(root)) fold(root);

	const body = groups.flatMap(group => lines.get(group));
	return [`${header}`, ...body, footer()].join("\n");
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

/** Runs one map call. `engine` and `threshold` are injected by tests. */
export async function runMap(params = {}, ctx = {}, options = {}) {
	const cwd = ctx.cwd ?? process.cwd();
	const root = params.path ? (isAbsolute(params.path) ? params.path : resolve(cwd, params.path)) : cwd;
	let natives;
	try {
		natives = await (options.engine ?? defaultEngine)();
	} catch (error) {
		return text(`files: native engine unavailable (${error instanceof Error ? error.message : String(error)})`, true);
	}
	if (typeof natives?.glob !== "function") return text("files: native engine has no glob function", true);
	const pattern = typeof params.glob === "string" && params.glob !== "" ? params.glob : "**/*";
	try {
		const result = await natives.glob({
			pattern,
			path: root,
			fileType: natives.FileType?.File ?? 1,
			hidden: params.hidden !== false,
			gitignore: params.gitignore !== false,
			includeNodeModules: false,
			timeoutMs: TIMEOUT_MS,
			signal: options.signal,
		});
		const threshold = options.threshold ?? (await spillThreshold(options.pi));
		const files = normalizeFiles((result?.matches ?? []).map(match => match.path), root);
		return text(renderMap(files, mapBudget(threshold)));
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
			hidden: z.boolean().optional(),
			gitignore: z.boolean().optional(),
		}),
		execute: (toolCallId, params, signal, onUpdate, ctx) => runMap(params, ctx, { signal, pi, ...options }),
	});
}

export default function baseTools(pi) {
	install(pi);
}
