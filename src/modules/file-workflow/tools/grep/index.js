import { classifyRipgrepMessage, searchWorkspace } from "../../shared/search/engine.js";
import { formatSearchError } from "../../shared/search/format.js";
import { sortedSchema } from "../../shared/data.js";
import { toolText } from "../../shared/tool-text.js";
import { parseGrepArgs, toInt32 } from "./args.js";
import description from "./description.md" with { type: "text" };
import { applyPagination, formatSearchResult, SearchResultCache } from "./format.js";
import { buildSearchRequest } from "./request.js";

const searchCache = new SearchResultCache();

const PARAMETERS = {
	type: "object",
	properties: {
		pattern: { type: "string", description: "The regular expression pattern to search for in file contents" },
		path: { type: "string", description: "File or directory to search in (rg pattern -- PATH). Defaults to the workspace root." },
		glob: { type: "string", description: 'Glob pattern to filter files (e.g. "*.js", "*.{ts,tsx}") - maps to rg --glob' },
		output_mode: {
			type: "string",
			enum: ["content", "files_with_matches", "count"],
			description:
				'Output mode: "content" shows matching lines (supports -A/-B/-C context, -n line numbers, head_limit), "files_with_matches" shows file paths (supports head_limit), "count" shows match counts (supports head_limit). Defaults to "content".',
		},
		"-B": { type: "number", description: 'Number of lines to show before each match (rg -B). Requires output_mode: "content", ignored otherwise.' },
		"-A": { type: "number", description: 'Number of lines to show after each match (rg -A). Requires output_mode: "content", ignored otherwise.' },
		"-C": { type: "number", description: 'Number of lines to show before and after each match (rg -C). Requires output_mode: "content", ignored otherwise.' },
		"-i": { type: "boolean", description: "Case insensitive search (rg -i) Defaults to false" },
		type: { type: "string", description: "File type to search (rg --type). Common types: js, py, rust, go, java, etc. More efficient than glob for standard file types." },
		head_limit: {
			type: "number",
			minimum: 0,
			description: 'Limit output size. For "content" mode: limits total matches shown. For "files_with_matches" and "count" modes: limits number of files.',
		},
		offset: {
			type: "number",
			minimum: 0,
			description:
				'Skip first N entries. For "content" mode: skips first N matches. For "files_with_matches" and "count" modes: skips first N files. Use with head_limit for pagination.',
		},
		multiline: { type: "boolean", description: "Enable multiline mode where . matches newlines and patterns can span lines (rg -U --multiline-dotall). Default: false." },
	},
	required: ["pattern"],
};

export default function grep(pi) {
	pi.registerTool({
		name: "grep",
		label: "grep",
		loadMode: "essential",
		concurrency: "shared",
		strict: false,
		description: description.trim(),
		parameters: sortedSchema(PARAMETERS),
		execute: (_toolCallId, params, signal, _onUpdate, ctx) => executeGrep(params, signal, ctx),
	});
}

async function executeGrep(params, signal, ctx) {
	const parsed = parseGrepArgs(params);
	if ("error" in parsed) return toolText(formatSearchError(parsed.error), true);
	const args = parsed.args;
	try {
		const request = buildSearchRequest(args);
		const offset = toInt32(args.offset, Math.floor) ?? 0;
		const headLimit = toInt32(args.head_limit, Math.ceil) || undefined;
		// The last five full results are cached, so paging through one costs no new search.
		let success = searchCache.get(request);
		if (success === undefined) {
			success = await searchWorkspace(request, ctx.cwd, signal);
			searchCache.set(request, success);
		}
		return toolText(formatSearchResult({ ...success, union: applyPagination(success.union, offset, headLimit) }));
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		return toolText(formatSearchError(classifyRipgrepMessage(message, args.pattern)), true);
	}
}
