// The result shape of a tool: one text block, marked as an error when the call failed.

/** A tool result holding one text block. */
export function toolText(text, isError = false) {
	const result = { content: [{ type: "text", text }] };
	return isError ? { ...result, isError: true } : result;
}

/** The text cut to `max` characters: its first and last halves joined by a marker. */
export function truncateOutput(text, max) {
	if (text.length <= max) return text;
	const half = Math.floor(max / 2);
	return `${text.slice(0, half)}\n\n... (output truncated) ...\n\n${text.slice(text.length - half)}`;
}
