// Line reader over decoded text: the range a call asks for, the "not shown" markers around it, and the binary check.

/** Longer output is replaced by a message that asks for offset and limit. */
export const READ_CHAR_HARD_LIMIT = 100_000;
/** Text is cut to this many characters before the line logic runs. */
export const MAX_TEXT_SIZE = 8 * 1024 * 1024;
/** The first NUL byte of a file marks it as binary data, not text. */
const BINARY_PROBE_BYTES = 8000;

function capText(text) {
	return text.length > MAX_TEXT_SIZE ? text.slice(0, MAX_TEXT_SIZE) : text;
}

/** True when the first 8000 bytes hold a NUL byte. */
export function isBinary(bytes) {
	return bytes.subarray(0, BINARY_PROBE_BYTES).includes(0);
}

/**
 * The text an offset and limit select. A file whose line endings are at least 5% CRLF has its "\r" removed from every
 * line that ends with a newline. A negative offset takes the last |offset| lines; an offset past the end returns the
 * whole text with rangeApplied false.
 */
export function readTextRange(text, offset, limit) {
	const parts = text.split("\n");
	const totalLines = parts.length;
	let crlf = 0;
	let lf = 0;
	for (let i = 0; i < totalLines - 1; i++) {
		if (parts[i].endsWith("\r")) crlf++;
		else lf++;
	}
	const newlines = crlf + lf;
	const normalizeCrlf = newlines > 0 && (crlf / newlines) * 100 >= 5;
	const lines = parts.map((line, i) => (normalizeCrlf && i < totalLines - 1 && line.endsWith("\r") ? line.slice(0, -1) : line));
	const fullText = lines.join("\n");
	if (offset === undefined && limit === undefined) return { content: capText(fullText), totalLines, rangeApplied: false };
	if (fullText === "") return { content: "", totalLines, rangeApplied: false };
	const effectiveOffset = offset ?? 1;
	if (effectiveOffset < 0) {
		const capacity = Math.abs(effectiveOffset);
		const tail = lines.slice(Math.max(0, totalLines - capacity));
		return { content: capText(tail.slice(0, limit ?? capacity).join("\n")), totalLines, rangeApplied: true };
	}
	const start = Math.max(0, effectiveOffset - 1);
	if (start >= totalLines) return { content: capText(fullText), totalLines, rangeApplied: false };
	const end = limit === undefined ? totalLines : start + limit;
	return { content: capText(lines.slice(start, end).join("\n")), totalLines, rangeApplied: true };
}

/** The lines an offset and limit select, or undefined when neither is given; an offset past the end is an error. */
export function computeReadSlice(totalLines, offset, limit) {
	if (offset === undefined && limit === undefined) return undefined;
	const effectiveOffset = offset ?? 1;
	const effectiveLimit = limit ?? (effectiveOffset < 0 ? Math.abs(effectiveOffset) : totalLines);
	const start = effectiveOffset < 0 ? Math.max(0, totalLines + effectiveOffset) : Math.max(0, effectiveOffset - 1);
	const end = Math.min(totalLines, start + effectiveLimit);
	if (start >= totalLines) throw new Error(`Offset ${offset} is beyond file length (${totalLines} lines)`);
	return { start, end, readRange: { startLine: start + 1, endLine: end } };
}

/** The content with a "not shown" line above and below when the range is only part of the file. */
export function formatReadCodeBlock(content, range, totalLines) {
	let result = content;
	if (range.startLine <= 1 && range.endLine >= totalLines) return result;
	if (range.startLine > 1) {
		const hidden = range.startLine - 1;
		result = `... ${hidden} ${hidden === 1 ? "line" : "lines"} not shown ...\n${result}`;
	}
	const endLine = range.startLine + content.split("\n").length - 1;
	if (totalLines > endLine) {
		const hidden = totalLines - endLine;
		result = `${result}\n... ${hidden} ${hidden === 1 ? "line" : "lines"} not shown ...`;
	}
	return result;
}
