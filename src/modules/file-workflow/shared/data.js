// Shaping of tool arguments: the fields GPT sends empty are dropped, and schema keys are sorted.

/** Arguments without the null, undefined and empty-string values that stand for an omitted optional field. */
export function dropEmpty(params) {
	return Object.fromEntries(Object.entries(params).filter(([, value]) => value !== null && value !== undefined && value !== ""));
}

/** The same value with the keys of every object sorted, the order these tools have always sent. */
export function sortedSchema(value) {
	if (Array.isArray(value)) return value.map(sortedSchema);
	if (typeof value !== "object" || value === null) return value;
	const entries = Object.entries(value).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
	return Object.fromEntries(entries.map(([key, inner]) => [key, sortedSchema(inner)]));
}
