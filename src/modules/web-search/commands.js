// Only text commands this tool executes; the rest of the native schema stays declared but unused.
const ALLOWED = ["search_query", "open", "click", "find"];

export function commands(raw) {
	let parsed;
	try {
		parsed = JSON.parse(raw);
	} catch {
		return undefined;
	}
	if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return undefined;
	const out = {};
	for (const key of ALLOWED) if (parsed[key] !== undefined) out[key] = parsed[key];
	if (!Object.keys(out).length) return undefined;
	if (parsed.response_length !== undefined) out.response_length = parsed.response_length;
	return out;
}
