// Result text of a search: the per-mode blocks, their footers, and the character budget.
import { truncateOutput } from "../tool-text.js";

// 50 KB in characters per result block, with no line cap.
export const GREP_CHAR_BUDGET = 51_200;
export const GLOB_CHAR_BUDGET = 51_200;

/** Joins lines, trims, and keeps whole lines that fit the budget. */
function truncateLines(lines, charBudget) {
	const joined = lines.join("\n");
	const content = joined.trim();
	if (content.length <= charBudget) return { content, truncated: false, keptLines: lines.length };
	const cut = content.slice(0, charBudget);
	const lastNewline = cut.lastIndexOf("\n");
	if (lastNewline === -1) return { content: "... [First line would be too large to fit within character budget] ...", truncated: true, keptLines: 0 };
	const cutIndex = joined.length - joined.trimStart().length + lastNewline;
	return { content: cut.slice(0, lastNewline).trim(), truncated: true, keptLines: joined.slice(0, cutIndex).split("\n").length };
}

function buildFooter(footer) {
	const offset = footer.offsetApplied ?? 0;
	const end = offset + footer.returned;
	const reachedEnd = footer.headLimitApplied === undefined || footer.returned < footer.headLimitApplied;
	const cutBeforeEnd = footer.ripgrepTruncated || (reachedEnd && (footer.clientTruncated || end < footer.total));
	const nextStep = describeNextStep(footer, { offset, end, reachedEnd, cutBeforeEnd });
	if (nextStep === undefined) return "";
	const lead = footer.charTruncated || cutBeforeEnd ? "Results truncated. " : "";
	const shown = footer.shown === 0 ? "none" : offset === 0 ? `${footer.shown}` : `${offset + 1}-${offset + footer.shown}`;
	const total = Math.max(footer.total, end);
	const isLowerBound = footer.ripgrepTruncated || (footer.clientTruncated && (!reachedEnd || footer.total <= end));
	const totalText = `${isLowerBound ? "at least " : ""}${total} ${footer.unit}${total === 1 ? "" : "s"}`;
	return `\n[${lead}Showing ${shown} of ${totalText}. ${nextStep}]`;
}

function describeNextStep(footer, position) {
	const fullPageMayHaveMore = !position.reachedEnd && (position.end < footer.total || footer.clientTruncated || footer.ripgrepTruncated);
	const canContinue = footer.shown > 0 && (footer.shown < footer.returned || fullPageMayHaveMore);
	if (!canContinue) {
		const hidesMatches = footer.charTruncated && footer.shown < footer.returned;
		return position.cutBeforeEnd || hidesMatches ? "Narrow the search to see the rest." : undefined;
	}
	if (!footer.singleWorkspace) return "Set path to one workspace to page through it, or narrow the search.";
	const nextOffset = position.offset + footer.shown;
	if (position.cutBeforeEnd && position.reachedEnd) {
		return `Use offset=${nextOffset} to see more of the first ${position.end}, or narrow the search to see the rest.`;
	}
	return `Use offset=${nextOffset} to see more, or narrow the search.`;
}

function formatContent(value, charBudget) {
	const lines = [];
	const isMatchLine = [];
	const hasContext = value.matches.some((fileMatch) => fileMatch.matches.some((match) => match.isContextLine));
	for (const fileMatch of value.matches) {
		lines.push(fileMatch.file);
		isMatchLine.push(false);
		let previousLineNumber;
		for (const match of fileMatch.matches) {
			if (hasContext && previousLineNumber !== undefined && match.lineNumber - previousLineNumber > 1) {
				lines.push("  --");
				isMatchLine.push(false);
			}
			previousLineNumber = match.lineNumber;
			lines.push(`  ${match.lineNumber}${match.isContextLine ? "-" : ":"}${match.content}`);
			isMatchLine.push(!match.isContextLine);
		}
		lines.push("");
		isMatchLine.push(false);
	}
	const { content, truncated, keptLines } = truncateLines(lines, charBudget);
	return (
		content +
		buildFooter({
			headLimitApplied: value.headLimitApplied,
			offsetApplied: value.offsetApplied,
			charTruncated: truncated,
			clientTruncated: value.clientTruncated,
			ripgrepTruncated: value.ripgrepTruncated,
			shown: isMatchLine.slice(0, keptLines).filter(Boolean).length,
			returned: isMatchLine.filter(Boolean).length,
			total: value.totalMatchedLines,
			unit: "matching line",
			singleWorkspace: true,
		})
	);
}

function formatFiles(value, charBudget) {
	const { content, truncated, keptLines } = truncateLines(value.files, charBudget);
	return (
		content +
		buildFooter({
			headLimitApplied: value.headLimitApplied,
			offsetApplied: value.offsetApplied,
			charTruncated: truncated,
			clientTruncated: value.clientTruncated,
			ripgrepTruncated: value.ripgrepTruncated,
			shown: keptLines,
			returned: value.files.length,
			total: value.totalFiles,
			unit: "file",
			singleWorkspace: true,
		})
	);
}

function formatCount(value, charBudget) {
	const lines = value.counts.map((count) => `${count.file}:${count.count}`);
	const { content, truncated, keptLines } = truncateLines(lines, charBudget);
	return (
		content +
		buildFooter({
			headLimitApplied: value.headLimitApplied,
			offsetApplied: value.offsetApplied,
			charTruncated: truncated,
			clientTruncated: value.clientTruncated,
			ripgrepTruncated: value.ripgrepTruncated,
			shown: keptLines,
			returned: lines.length,
			total: value.totalFiles,
			unit: "file",
			singleWorkspace: true,
		})
	);
}

// Text for an empty page: the empty text on the first page, or a note about the offset past the end.
function describeEmptyPage(page, total, emptyText) {
	const offset = page.offsetApplied ?? 0;
	if (offset === 0 || total === 0) return emptyText;
	const moreExist = page.clientTruncated || page.ripgrepTruncated || offset < total;
	return moreExist ? `No more results at offset=${offset}. Narrow the search to see the rest.` : `No more results at offset=${offset}.`;
}

/** One result block in the mode of the union, cut to the character budget. */
export function formatBlock(union, charBudget) {
	switch (union.mode) {
		case "content":
			return union.value.matches.length === 0
				? describeEmptyPage(union.value, union.value.totalMatchedLines, "No matches found")
				: formatContent(union.value, charBudget);
		case "files_with_matches":
			return union.value.files.length === 0
				? describeEmptyPage(union.value, union.value.totalFiles, "No files with matches found")
				: formatFiles(union.value, charBudget);
		case "count":
			return union.value.counts.length === 0
				? describeEmptyPage(union.value, union.value.totalFiles, "No matches found")
				: formatCount(union.value, charBudget);
	}
}

/** Model-facing text of a search error, cut to the budget. */
export function formatSearchError(message) {
	return `Error running tool: ${truncateOutput(message, GREP_CHAR_BUDGET)}`;
}
