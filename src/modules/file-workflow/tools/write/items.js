// Argument mapping and result text of write: one file or a page of them, each file refused while another call holds it.
import { inFlight, lockKey } from "../../shared/paging.js";

function textOf(result) {
	return result.content.flatMap((part) => (part.type === "text" && part.text ? [part.text] : [])).join("\n");
}

/** path and content for one file, or files for several; a bare path goes to the native write untouched. */
export function parseWriteItems(params) {
	const filesGiven = Array.isArray(params.files) && params.files.length > 0;
	const singleGiven = params.path !== undefined && params.path !== "" && params.content !== undefined;
	if (!filesGiven && !singleGiven && params.path !== undefined) return { native: { path: params.path } };
	if (filesGiven === singleGiven) return { error: "Give either path and content, or files." };
	return { items: singleGiven ? [{ path: params.path, content: params.content }] : params.files, single: singleGiven };
}

/** Writes the files in parallel; the result of each carries the native result of a written file. */
export async function runWriteItems(items, invoke, cwd) {
	return Promise.all(
		items.map(async (item) => {
			const key = lockKey(item.path, cwd);
			if (inFlight.has(key)) return { path: item.path, status: "busy", text: "" };
			inFlight.add(key);
			try {
				const result = await invoke({ path: item.path, content: item.content });
				const text = textOf(result);
				if (result.isError) return { path: item.path, status: "failed", message: text || "failed", text: "" };
				return { path: item.path, status: "written", text, raw: result };
			} catch (error) {
				return { path: item.path, status: "failed", message: error instanceof Error ? error.message : String(error), text: "" };
			} finally {
				inFlight.delete(key);
			}
		}),
	);
}

/** The model-facing lines of a write result. */
export function formatWriteRuns(runs) {
	const lines = [];
	for (const run of runs) {
		if (run.status !== "written") continue;
		lines.push(`Written: ${run.path}`);
		if (run.text) lines.push(run.text.split("\n").map((line) => `  ${line}`).join("\n"));
	}
	for (const run of runs) {
		if (run.status === "busy") lines.push(`Busy, not written (another write or edit of this file is in progress): ${run.path}`);
	}
	for (const run of runs) {
		if (run.status === "failed") lines.push(`Failed: ${run.path}: ${run.message}`);
	}
	return lines.join("\n");
}

/** The whole tool result of a write call; a single written file hands back the native result itself. */
export function writeResult(runs, single) {
	const [only] = runs;
	if (single && only.status === "written") return only.raw;
	return {
		content: [{ type: "text", text: formatWriteRuns(runs) }],
		details: {
			files: runs.map((run) => (run.message === undefined ? { path: run.path, status: run.status } : { path: run.path, status: run.status, message: run.message })),
		},
		isError: runs.some((run) => run.status !== "written"),
	};
}
