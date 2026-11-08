// The apply_patch mode: a "*** Begin Patch" envelope, its file sections, and the per-file runs that apply them.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { inFlight, lockKey } from "../../shared/paging.js";

/** Splits a `*** Begin Patch` envelope into file sections; undefined when the input cannot be split. */
export function parsePatch(input) {
	const lines = input.split("\n");
	if (lines.at(-1) === "") lines.pop();
	if (lines.length < 2 || lines[0] !== "*** Begin Patch" || lines.at(-1) !== "*** End Patch") return undefined;
	const sections = [];
	let current;
	let hunkStarted = false;
	for (const line of lines.slice(1, -1)) {
		const header = /^\*\*\* (Add|Delete|Update) File: (.*)$/.exec(line);
		if (header) {
			current = {
				path: header[2],
				kind: header[1] === "Add" ? "add" : header[1] === "Delete" ? "delete" : "update",
				lines: [line],
				move: false,
				hunks: [],
			};
			sections.push(current);
			hunkStarted = false;
			continue;
		}
		if (!current) return undefined;
		if (line.startsWith("*** Move to: ")) {
			if (current.kind !== "update" || current.lines.length !== 1) return undefined;
			current.move = true;
			current.lines.push(line);
			continue;
		}
		if (line.startsWith("*** ") && line !== "*** End of File") return undefined;
		current.lines.push(line);
		if (current.hunks.length === 0) current.hunks.push([]);
		if (line.startsWith("@@")) {
			if (hunkStarted) current.hunks.push([]);
			hunkStarted = true;
		}
		current.hunks.at(-1).push(line);
	}
	return sections.length > 0 ? sections : undefined;
}

/** The lines of a file as a patch sees them: no BOM, no CR, and no empty last element. */
export function splitFileLines(text) {
	let body = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
	if (body === "") return [];
	const lines = body.split("\n").map((line) => (line.endsWith("\r") ? line.slice(0, -1) : line));
	if (lines[lines.length - 1] === "") lines.pop();
	return lines;
}

/** How much of two lines matches, from 0 to 1. */
export function lineSimilarity(a, b) {
	const max = Math.max(a.length, b.length);
	if (max === 0) return 1;
	let same = 0;
	for (let i = 0; i < Math.min(a.length, b.length); i++) if (a[i] === b[i]) same++;
	return same / max;
}

/** The closest place in a file to an old_string that did not match, line by line; undefined when the file cannot be read. */
export function nearestMatchText(relPath, oldString, cwd) {
	let lines;
	try {
		lines = splitFileLines(readFileSync(resolve(cwd, relPath), "utf8"));
	} catch {
		return undefined;
	}
	const want = splitFileLines(oldString).map((line) => line.replace(/\s+/g, " ").trim());
	const n = want.length;
	if (n === 0 || lines.length < n) return undefined;
	const norm = lines.map((line) => line.replace(/\s+/g, " ").trim());
	let bestStart = 0;
	let bestScore = -1;
	for (let s = 0; s + n <= lines.length; s++) {
		let score = 0;
		for (let k = 0; k < n; k++) score += lineSimilarity(norm[s + k], want[k]);
		if (score > bestScore) {
			bestScore = score;
			bestStart = s;
		}
	}
	const out = [`Nearest match in ${relPath} (lines ${bestStart + 1}-${bestStart + n}):`];
	for (let i = bestStart; i < bestStart + n; i++) out.push(`${i + 1}|${lines[i]}`);
	return out.join("\n");
}

/** The sections of one patch and how many hunks it counts for: 1 for Add, Delete and Update with Move. */
function hunkCount(section) {
	return section.kind === "update" && !section.move ? Math.max(1, section.hunks.length) : 1;
}

/** The sections of a patch grouped by the file they change. */
export function groupPatchSections(sections, cwd) {
	const groups = new Map();
	for (const section of sections) {
		const key = lockKey(section.path, cwd);
		groups.set(key, [...(groups.get(key) ?? []), section]);
	}
	return groups;
}

/** The text of a native result. */
export function textOf(result) {
	return result.content.flatMap((part) => (part.type === "text" && part.text ? [part.text] : [])).join("\n");
}

/** The diff a native result carries, or an empty string. */
export function diffOf(result) {
	const details = result.details;
	return typeof details === "object" && details !== null && "diff" in details && typeof details.diff === "string" ? details.diff : "";
}

async function callNative(invoke, input) {
	try {
		const result = await invoke({ input });
		return result.isError ? { result, error: textOf(result) } : { result };
	} catch (error) {
		return { error: error instanceof Error ? error.message : String(error) };
	}
}

async function applyGroup(key, group, invoke) {
	const path = group[0].path;
	const total = group.reduce((sum, section) => sum + hunkCount(section), 0);
	if (inFlight.has(key)) return { path, status: "busy", applied: 0, total, results: [], appliedHunks: [], rejections: [] };
	inFlight.add(key);
	try {
		const whole = await callNative(invoke, `*** Begin Patch\n${group.flatMap((section) => section.lines).join("\n")}\n*** End Patch`);
		if (whole.result && whole.error === undefined) {
			return { path, status: "edited", applied: total, total, results: [whole.result], appliedHunks: [], rejections: [] };
		}
		const hunks =
			group.every((section) => section.kind === "update" && !section.move)
				? group.flatMap((section) => section.hunks.map((lines) => ({ path: section.path, lines })))
				: [];
		if (hunks.length < 2 || hunks.length !== total) {
			return { path, status: "failed", applied: 0, total, results: [], appliedHunks: [], rejections: [], failure: whole.error ?? "" };
		}
		// One bad hunk in a multi-hunk patch: retry them one by one, so the good hunks still land.
		const results = [];
		const appliedHunks = [];
		const rejections = [];
		for (const [index, hunk] of hunks.entries()) {
			const outcome = await callNative(invoke, `*** Begin Patch\n*** Update File: ${hunk.path}\n${hunk.lines.join("\n")}\n*** End Patch`);
			if (outcome.result && outcome.error === undefined) {
				results.push(outcome.result);
				appliedHunks.push(index + 1);
			} else {
				rejections.push({ index: index + 1, total, text: outcome.error ?? "", lines: hunk.lines });
			}
		}
		const status = rejections.length === 0 ? "edited" : appliedHunks.length > 0 ? "partial" : "failed";
		return { path, status, applied: appliedHunks.length, total, results, appliedHunks, rejections };
	} finally {
		inFlight.delete(key);
	}
}

/** Applies every file section of a patch, one run per file, the files in parallel. */
export async function runPatch(sections, invoke, cwd) {
	const groups = groupPatchSections(sections, cwd);
	return Promise.all([...groups].map(([key, group]) => applyGroup(key, group, invoke)));
}

/** The model-facing lines of a patch result. */
export function formatPatchRuns(runs) {
	const out = [];
	for (const run of runs) {
		if (run.status === "busy") {
			out.push(`Busy, not edited (another write or edit of this file is in progress): ${run.path}`);
			continue;
		}
		if (run.status === "edited") out.push(`Applied: ${run.path} (${run.total} hunk(s))`);
		if (run.status === "partial") out.push(`Applied: ${run.path} (hunks ${run.appliedHunks.join(", ")} of ${run.total})`);
		for (const result of run.results) {
			const text = textOf(result);
			if (text) out.push(text.split("\n").map((line) => `  ${line}`).join("\n"));
		}
		for (const rejection of run.rejections) out.push(`Rejected: ${run.path}, hunk ${rejection.index} of ${rejection.total}:`, rejection.text);
		if (run.status === "failed" && run.rejections.length === 0) out.push(`Rejected: ${run.path}: ${run.failure || "failed"}`);
	}
	const applied = runs.reduce((sum, run) => sum + run.applied, 0);
	const total = runs.reduce((sum, run) => sum + run.total, 0);
	if (total > applied) out.push(`Applied ${applied} of ${total} hunks; rejected ${total - applied}.`);
	return out.join("\n");
}

/** The whole tool result of a patch: the text, the diffs and one entry per file. */
export function patchResult(runs) {
	return {
		content: [{ type: "text", text: formatPatchRuns(runs) }],
		details: {
			diff: runs.flatMap((run) => run.results.map((result) => diffOf(result))).filter(Boolean).join("\n"),
			perFileResults: runs.map((run) => ({
				path: run.path,
				diff: run.results.map((result) => diffOf(result)).filter(Boolean).join("\n"),
				isError: run.status !== "edited",
			})),
			files: runs.map((run) => ({
				path: run.path,
				status: run.status,
				applied: run.applied,
				total: run.total,
				...(run.status === "partial" || run.status === "failed"
					? { message: (run.rejections[0]?.text ?? run.failure ?? "").split("\n")[0] || "failed" }
					: {}),
			})),
		},
		isError: runs.some((run) => run.status !== "edited"),
	};
}
