import { booleanLike, checkType, invalidArguments, optionalEnum, optionalLenientNumber, optionalString } from "../../shared/args.js";

const OUTPUT_MODES = ["content", "files_with_matches", "count"];
const CONTEXT_FLAGS = ["-B", "-A", "-C"];
const MAX_INT32 = 2_147_483_647;

/** Rounds the number and clamps it to 0..int32 max; NaN becomes 0. */
export function toInt32(value, round) {
	if (value === undefined) return undefined;
	const rounded = round(value);
	return Number.isNaN(rounded) ? 0 : Math.min(Math.max(rounded, 0), MAX_INT32);
}

/**
 * pattern is required and must name something; a negative context flag is an error; the context and paging numbers are
 * lenient; the two flags accept boolean spellings, and a null or absent flag reads as false.
 */
export function parseGrepArgs(params) {
	const issues = [];
	if (!checkType(params, "object", [], issues)) return { error: invalidArguments(issues) };
	const input = params;
	const pattern = checkType(input.pattern, "string", ["pattern"], issues) ? input.pattern : "";
	const path = optionalString(input.path, ["path"], issues);
	const glob = optionalString(input.glob, ["glob"], issues);
	const outputMode = optionalEnum(input.output_mode, OUTPUT_MODES, ["output_mode"], issues);
	const before = optionalLenientNumber(input["-B"], ["-B"], issues);
	const after = optionalLenientNumber(input["-A"], ["-A"], issues);
	const context = optionalLenientNumber(input["-C"], ["-C"], issues);
	const caseInsensitive = booleanLike(input["-i"], ["-i"], issues);
	const type = optionalString(input.type, ["type"], issues);
	const headLimit = optionalLenientNumber(input.head_limit, ["head_limit"], issues, 0);
	const offset = optionalLenientNumber(input.offset, ["offset"], issues, 0);
	const multiline = booleanLike(input.multiline, ["multiline"], issues);
	if (pattern === "" && !issues.some((issue) => issue.path[0] === "pattern")) {
		issues.push({ path: ["pattern"], message: 'pattern is empty. Pass "." to match every line.' });
	}
	const contexts = { "-B": before, "-A": after, "-C": context };
	for (const flag of CONTEXT_FLAGS) {
		if (contexts[flag] !== undefined && contexts[flag] < 0) issues.push({ path: [flag], message: "Must be 0 or more context lines." });
	}
	if (issues.length > 0) return { error: invalidArguments(issues) };
	return {
		args: {
			pattern,
			path,
			glob,
			output_mode: outputMode,
			"-B": before,
			"-A": after,
			"-C": context,
			"-i": caseInsensitive,
			type,
			head_limit: headLimit,
			offset,
			multiline,
		},
	};
}
