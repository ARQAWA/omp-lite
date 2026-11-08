// Paths and file locks shared by read, grep, glob, edit and write.
import { realpath } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, isAbsolute, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

/** Expands ~ and file:// and resolves the path against base unless it is absolute. */
export function resolvePath(path, base) {
	const plain = path.startsWith("file://") ? fileURLToPath(path) : path;
	const expanded = plain.replace(/^~(?=$|\/|\\)/, homedir());
	if (base !== undefined && !isAbsolute(expanded)) return resolve(base, expanded);
	return resolve(expanded);
}

/** Realpath of the longest existing ancestor with the rest appended; null when a non-ENOENT error stops the walk. */
export async function resolveRealPathStrict(path) {
	const tail = [];
	let current = resolve(path);
	for (;;) {
		try {
			return join(await realpath(current), ...tail.reverse());
		} catch (error) {
			if (error.code !== "ENOENT") return null;
			const parent = dirname(current);
			if (parent === current) return null;
			tail.push(basename(current));
			current = parent;
		}
	}
}

/** Workspace roots compare case-insensitively on darwin and win32; "/a/bc" is not inside "/a/b". */
export function isInsideWorkspaceRoot(target, root) {
	const fold = process.platform === "win32" || process.platform === "darwin" ? (value) => value.toLowerCase() : (value) => value;
	const t = fold(target);
	const r = fold(root);
	if (t === r) return true;
	return t.startsWith(r.endsWith(sep) ? r : r + sep);
}

/** Lock key of a path: internal URLs as given, files as absolute paths (case-folded on Windows). */
export function lockKey(path, cwd) {
	if (path.includes("://")) return path;
	const absolute = resolve(cwd, path);
	return process.platform === "win32" ? absolute.toLowerCase() : absolute;
}

// Files that a write or edit call is changing right now, shared by both tools across the process.
const STORE = (globalThis[Symbol.for("file-workflow.inFlight")] ??= new Set());
export { STORE as inFlight };
