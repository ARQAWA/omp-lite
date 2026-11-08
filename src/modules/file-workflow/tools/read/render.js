import { computeReadSlice, formatReadCodeBlock, READ_CHAR_HARD_LIMIT } from "./lines.js";

/** A file read without offset and limit comes back whole up to this many lines; a longer one shows the way on. */
export const FIRST_READ_LINES = 1000;
/** A range in a code file grows to the enclosing blocks, at most this many lines each way. */
const EXPAND_REACH = 150;

/** The range widened to the block boundaries within 150 lines of it; unchanged without bounds. */
export function growToBlocks(content, bounds, offset, limit) {
	const total = content.split("\n").length;
	const start = offset;
	const end = Math.min(total, limit === undefined ? total : offset + limit - 1);
	if (start > total || bounds === undefined || bounds.length === 0) return { offset, limit };
	const up = bounds.filter((line) => line < start && line >= start - EXPAND_REACH);
	const down = bounds.filter((line) => line > end && line <= end + EXPAND_REACH);
	const newStart = up.length > 0 ? Math.min(...up) : start;
	const newEnd = down.length > 0 ? Math.max(...down) : end;
	return { offset: newStart, limit: newEnd - newStart + 1 };
}

/** The model-facing text: "File is empty.", the range with "not shown" markers, or the greedy cut with a hint. */
export function renderRead(read, offset, limit) {
	if (read.content === "" && !read.rangeApplied) return "File is empty.";
	const total = read.totalLines;
	let lines = read.content.split("\n");
	let start = 1;
	const slice = computeReadSlice(total, offset, limit);
	if (slice !== undefined) {
		if (read.rangeApplied) start = slice.readRange.startLine;
		else {
			lines = lines.slice(slice.start, slice.end);
			start = slice.readRange.startLine;
		}
	}
	const greedyCut = offset === undefined && limit === undefined && lines.length > FIRST_READ_LINES;
	if (greedyCut) lines = lines.slice(0, FIRST_READ_LINES);
	const body = lines.join("\n");
	if (body.length > READ_CHAR_HARD_LIMIT) {
		throw new Error(
			`Requested content exceeds maximum allowed characters (${READ_CHAR_HARD_LIMIT} characters).\nPlease use offset and limit parameters to read specific portions of the file, or use the 'grep' tool to search for specific content.`,
		);
	}
	const end = start + lines.length - 1;
	const text = formatReadCodeBlock(body, { startLine: start, endLine: end }, total);
	return greedyCut ? `${text}\n[Use offset=${end + 1} to continue.]` : text;
}
