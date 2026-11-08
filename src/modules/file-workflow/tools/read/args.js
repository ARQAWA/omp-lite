import { lenientNumber, receivedName } from "../../shared/args.js";

// Arguments of read. A negative offset counts back from the last line; 0 means the first line.
const INT32_MAX = 2 ** 31 - 1;
const INT32_MIN = -(2 ** 31);

function parseInteger(field, raw, issues) {
	const value = lenientNumber(raw);
	if (value === undefined) return undefined;
	if (typeof value !== "number") {
		issues.push({ path: field, message: `Expected number, received ${receivedName(value)}` });
		return undefined;
	}
	if (!Number.isInteger(value)) {
		issues.push({ path: field, message: "Expected integer, received float" });
		return undefined;
	}
	return value;
}

function clampInt32(value) {
	return value === undefined ? undefined : Math.min(INT32_MAX, Math.max(INT32_MIN, value));
}

function invalidArguments(issues) {
	return new Error(`Invalid arguments:\n${issues.map((issue) => `${issue.path}: ${issue.message}`).join("\n")}`);
}

/** The path plus the optional offset and limit; throws an Error listing every bad field. */
export function parseReadArgs(params) {
	if (params === null || typeof params !== "object" || Array.isArray(params)) {
		throw invalidArguments([{ path: "argument", message: `Expected object, received ${receivedName(params)}` }]);
	}
	const issues = [];
	const path = params.path;
	if (typeof path !== "string") {
		issues.push({ path: "path", message: path === undefined ? "Required" : `Expected string, received ${receivedName(path)}` });
	}
	const offset = parseInteger("offset", params.offset, issues);
	const limit = parseInteger("limit", params.limit, issues);
	if (limit !== undefined && limit < 1) issues.push({ path: "limit", message: "Limit must be >= 1." });
	if (issues.length > 0) throw invalidArguments(issues);
	return { path: path ?? "", offset: clampInt32(offset === 0 ? 1 : offset), limit: clampInt32(limit) };
}
