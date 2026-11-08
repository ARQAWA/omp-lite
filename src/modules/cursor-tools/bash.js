// bash wrapper: Cursor's block_until_ms over omp's native bash tool.
// Only zero is translated, because it means "background now"; any other value
// needs the shared auto-background threshold, which the native tool reads after
// an await, so a per-call override cannot be held safely.

/** Drops the Cursor field and, for zero, asks the native tool to start in the background. */
export function mapBashParams(params) {
	const { block_until_ms: blockUntilMs, ...rest } = params ?? {};
	if (blockUntilMs !== 0) return rest;
	if (rest.pty === true || rest.name !== undefined) return rest;
	return { ...rest, async: true };
}

export function text(value, isError = false) {
	return { content: [{ type: "text", text: value }], details: undefined, ...(isError ? { isError: true } : {}) };
}

export async function executeBash(toolCallId, params, signal, onUpdate, ctx) {
	const blockUntilMs = params?.block_until_ms;
	if (blockUntilMs !== undefined && blockUntilMs !== 0) {
		return text("block_until_ms only accepts 0; other values would race the shared auto-background threshold", true);
	}
	if (blockUntilMs === 0 && (params.pty === true || params.name !== undefined)) {
		return text("block_until_ms: 0 cannot be combined with pty or a named service", true);
	}
	if (typeof ctx?.invokeTool !== "function") return text("native bash is unavailable in this runtime", true);
	return ctx.invokeTool(mapBashParams(params), { signal, onUpdate });
}
