// The replace mode (description.md) for every model except GPT, which gets omp's apply_patch text and grammar.
const GPT = /gpt/i;

/** The parameters without the empty path and old_string GPT sends for the fields it left out. */
export function cleanParams(raw) {
	const params = { ...(raw ?? {}) };
	if (params.path === "") delete params.path;
	if (params.old_string === "") delete params.old_string;
	if (Array.isArray(params.edits) && params.edits.length === 0) delete params.edits;
	return params;
}

/** GPT models take one freeform patch; every other model takes path, old_string and new_string. */
export function chooseEditMode(model) {
	return GPT.test(model?.id ?? model ?? "") ? "apply_patch" : "replace";
}

/** The replacements of a replace-mode call: one item, or the edits array; never both and never neither. */
export function replaceItems(params) {
	const single = params.path !== undefined && params.old_string !== undefined && params.new_string !== undefined;
	const many = Array.isArray(params.edits) && params.edits.length > 0;
	if (single === many) return { error: "Give either path, old_string and new_string, or edits." };
	if (single) {
		const item = { path: params.path, old_string: params.old_string, new_string: params.new_string };
		if (params.replace_all !== undefined) item.replace_all = params.replace_all;
		return { items: [item], single: true };
	}
	return { items: params.edits, single: false };
}
