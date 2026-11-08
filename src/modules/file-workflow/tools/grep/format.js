// The model-facing text of a grep result: one workspace_result block under the character budget, and the page cuts.
import { formatBlock, GREP_CHAR_BUDGET } from "../../shared/search/format.js";

/** The last five full (unpaginated) results, most recent first. */
export class SearchResultCache {
	entries = [];

	constructor(capacity = 5) {
		this.capacity = capacity;
	}

	get(args) {
		const index = this.entries.findIndex((entry) => sameSearch(entry.args, args));
		if (index === -1) return undefined;
		const [entry] = this.entries.splice(index, 1);
		this.entries.unshift(entry);
		return entry.result;
	}

	set(args, result) {
		const existing = this.entries.findIndex((entry) => sameSearch(entry.args, args));
		if (existing !== -1) this.entries.splice(existing, 1);
		else if (this.entries.length >= this.capacity) this.entries.pop();
		this.entries.unshift({ args, result });
	}
}

function sameSearch(a, b) {
	return (
		a.pattern === b.pattern &&
		a.path === b.path &&
		a.glob === b.glob &&
		(a.outputMode ?? "content") === (b.outputMode ?? "content") &&
		a.type === b.type &&
		a.caseInsensitive === b.caseInsensitive &&
		a.multiline === b.multiline &&
		a.contextBefore === b.contextBefore &&
		a.contextAfter === b.contextAfter &&
		a.context === b.context
	);
}

/** One workspace_result block, with the char budget applied when the block is too long. */
export function formatSearchResult(success) {
	const full = formatBlock(success.union, Number.MAX_SAFE_INTEGER);
	const budget = full.length > GREP_CHAR_BUDGET ? GREP_CHAR_BUDGET : full.length;
	const section = formatBlock(success.union, budget);
	return `<workspace_result workspace_path="${success.root}">\n${section}\n</workspace_result>\n`.trim();
}

function paginateArray(items, offset, headLimit) {
	const start = Math.min(offset, items.length);
	const end = headLimit !== undefined ? Math.min(start + headLimit, items.length) : items.length;
	return { items: items.slice(start, end), truncated: headLimit !== undefined && start + headLimit < items.length };
}

function paginateContent(value, offset, headLimit) {
	const limit = headLimit ?? Number.POSITIVE_INFINITY;
	let skipped = 0;
	let collected = 0;
	let hasMoreMatches = false;
	const matches = [];
	for (const fileMatch of value.matches) {
		if (hasMoreMatches) break;
		const lines = [];
		let pendingContext = [];
		for (const line of fileMatch.matches) {
			if (line.isContextLine) {
				if (lines.length > 0) lines.push(line);
				else pendingContext.push(line);
				continue;
			}
			if (skipped < offset) {
				skipped++;
				pendingContext = [];
				continue;
			}
			if (collected >= limit) {
				hasMoreMatches = true;
				break;
			}
			lines.push(...pendingContext);
			pendingContext = [];
			lines.push(line);
			collected++;
		}
		if (lines.length > 0) matches.push({ file: fileMatch.file, matches: lines });
	}
	return {
		...value,
		matches,
		clientTruncated: value.clientTruncated || hasMoreMatches,
		headLimitApplied: headLimit,
		offsetApplied: offset > 0 ? offset : undefined,
	};
}

/** head_limit and offset cut the page after the search ran; a page without either change is the union itself. */
export function applyPagination(union, offset, headLimit) {
	if (offset === 0 && headLimit === undefined) return union;
	const pageInfo = { headLimitApplied: headLimit, offsetApplied: offset > 0 ? offset : undefined };
	switch (union.mode) {
		case "content":
			return { mode: "content", value: paginateContent(union.value, offset, headLimit) };
		case "files_with_matches": {
			const page = paginateArray(union.value.files, offset, headLimit);
			return {
				mode: "files_with_matches",
				value: { ...union.value, files: page.items, clientTruncated: union.value.clientTruncated || page.truncated, ...pageInfo },
			};
		}
		case "count": {
			const page = paginateArray(union.value.counts, offset, headLimit);
			return {
				mode: "count",
				value: { ...union.value, counts: page.items, clientTruncated: union.value.clientTruncated || page.truncated, ...pageInfo },
			};
		}
	}
}
