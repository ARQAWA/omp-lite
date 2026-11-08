// The replace mode: exact-text replacements, the files in parallel and the edits of one file in the given order.
import { inFlight, lockKey } from "../../shared/paging.js";
import { diffOf, nearestMatchText, textOf } from "./patch.js";

async function runFile(key, edits, invoke, cwd) {
	const path = edits[0].path;
	const total = edits.length;
	if (inFlight.has(key)) return { path, status: "busy", applied: 0, total, results: [] };
	inFlight.add(key);
	const results = [];
	try {
		for (const [index, item] of edits.entries()) {
			let failure;
			try {
				const args = { path: item.path, old_string: item.old_string, new_string: item.new_string };
				if (item.replace_all !== undefined) args.replace_all = item.replace_all;
				const result = await invoke(args);
				results.push(result);
				if (result.isError) failure = textOf(result);
			} catch (error) {
				failure = error instanceof Error ? error.message : String(error);
			}
			if (failure !== undefined) {
				return {
					path,
					status: "failed",
					applied: index,
					total,
					results,
					failure,
					failedEdit: index + 1,
					nearest: nearestMatchText(item.path, item.old_string, cwd),
				};
			}
		}
		return { path, status: "edited", applied: total, total, results };
	} finally {
		inFlight.delete(key);
	}
}

/** Applies the replacements, one run per file, the files in parallel. */
export async function runReplaceItems(items, invoke, cwd) {
	const groups = new Map();
	for (const item of items) {
		const key = lockKey(item.path, cwd);
		groups.set(key, [...(groups.get(key) ?? []), item]);
	}
	return Promise.all([...groups].map(([key, edits]) => runFile(key, edits, invoke, cwd)));
}

/** The model-facing lines of a replace result. */
export function formatReplaceRuns(runs) {
	const lines = [];
	for (const run of runs) {
		if (run.status !== "edited") continue;
		lines.push(`Edited: ${run.path} (${run.total} replacement(s))`);
		for (const result of run.results) {
			const text = textOf(result);
			if (text) lines.push(text.split("\n").map((line) => `  ${line}`).join("\n"));
		}
	}
	for (const run of runs) {
		if (run.status === "busy") lines.push(`Busy, not edited (another write or edit of this file is in progress): ${run.path}`);
	}
	for (const run of runs) {
		if (run.status !== "failed") continue;
		lines.push(`Failed: ${run.path}, edit ${run.failedEdit} of ${run.total}: ${run.failure || "failed"}`);
		if (run.nearest) lines.push(run.nearest);
		if (run.applied > 0) lines.push(`  Applied before the failure: ${run.applied} of ${run.total}`);
	}
	for (const run of runs) {
		if (run.status === "failed" && run.failedEdit < run.total) lines.push(`Skipped after the failure above: ${run.path}, edits ${run.failedEdit + 1}-${run.total}`);
	}
	return lines.join("\n");
}

/** The whole tool result of a replace call; a single edit hands back the native result itself. */
export function replaceResult(runs, single) {
	if (single) {
		const run = runs[0];
		if (run.status === "edited") return run.results[0];
		if (run.status === "busy") {
			return {
				content: [{ type: "text", text: `Busy, not edited (another write or edit of this file is in progress): ${run.path}` }],
				isError: true,
			};
		}
		const text = [run.failure ?? "", run.nearest ?? ""].filter((part) => part !== "").join("\n");
		return { content: [{ type: "text", text }], details: run.results.at(-1)?.details, isError: true };
	}
	const diff = (run) =>
		run.results
			.map((result) => diffOf(result))
			.filter(Boolean)
			.join("\n");
	return {
		content: [{ type: "text", text: formatReplaceRuns(runs) }],
		details: {
			files: runs.map((run) => ({
				path: run.path,
				status: run.status,
				applied: run.applied,
				total: run.total,
				...(run.status === "failed" ? { message: run.failure || "failed" } : {}),
			})),
			diff: runs.map((run) => diff(run)).filter(Boolean).join("\n"),
			perFileResults: runs.map((run) => ({ path: run.path, diff: diff(run), isError: run.status !== "edited" })),
		},
		isError: runs.some((run) => run.status !== "edited"),
	};
}
