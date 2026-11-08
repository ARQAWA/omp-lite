// Argument checks shared by the six tools. Each tool collects every issue and reports them as
// "Invalid arguments:" with one "<field>: <message>" line per issue.

/** Name of a value's type, as in "Expected string, received number". */
export function receivedName(value) {
	if (value === null) return "null";
	if (Array.isArray(value)) return "array";
	if (typeof value === "number" && Number.isNaN(value)) return "nan";
	return typeof value;
}

function hasType(value, type) {
	switch (type) {
		case "string":
			return typeof value === "string";
		case "number":
			return typeof value === "number" && !Number.isNaN(value);
		case "boolean":
			return typeof value === "boolean";
		case "object":
			return typeof value === "object" && value !== null && !Array.isArray(value);
		case "array":
			return Array.isArray(value);
	}
}

/** Records an issue when a value does not have the type ("Required" when it is absent); returns whether it does. */
export function checkType(value, type, path, issues) {
	if (hasType(value, type)) return true;
	issues.push({ path, message: value === undefined ? "Required" : `Expected ${type}, received ${receivedName(value)}` });
	return false;
}

/** One "path: message" line per issue, "argument" for the whole value. */
export function invalidArguments(issues) {
	const lines = issues.map((issue) => `${issue.path.length > 0 ? issue.path.join(".") : "argument"}: ${issue.message}`);
	return `Invalid arguments:\n${lines.join("\n")}`;
}

/** An optional field: an absent value stays absent, and a present one, null included, must have the type. */
export function optionalString(value, path, issues) {
	if (value === undefined) return undefined;
	return checkType(value, "string", path, issues) ? value : undefined;
}

/** An enum: a value that is not a string gets the type message, and a string outside the options gets the enum message. */
export function optionalEnum(value, options, path, issues) {
	if (value === undefined) return undefined;
	const expected = options.map((option) => `'${option}'`).join(" | ");
	if (typeof value !== "string") {
		issues.push({ path, message: `Expected ${expected}, received ${receivedName(value)}` });
		return undefined;
	}
	if (!options.includes(value)) {
		issues.push({ path, message: `Invalid enum value. Expected ${expected}, received '${value}'` });
		return undefined;
	}
	return value;
}

/** A numeric string is read as its number; anything else reaches the number check unchanged. */
export function lenientNumber(value) {
	if (typeof value !== "string") return value;
	const trimmed = value.trim();
	if (trimmed === "") return value;
	const num = Number(trimmed);
	return Number.isNaN(num) ? value : num;
}

/** An optional lenient number, with a minimum when one is given. */
export function optionalLenientNumber(value, path, issues, min) {
	if (value === undefined) return undefined;
	const number = lenientNumber(value);
	if (!checkType(number, "number", path, issues)) return undefined;
	if (min !== undefined && number < min) {
		issues.push({ path, message: `Number must be greater than or equal to ${min}` });
		return undefined;
	}
	return number;
}

/** A flag with a default of false: null and an absent value read as false, "yes", "1" and friends as booleans. */
export function booleanLike(value, path, issues) {
	if (value === null) return false;
	const spelled = typeof value === "string" ? { true: true, yes: true, "1": true, false: false, no: false, "0": false }[value.trim().toLowerCase()] : undefined;
	const read = spelled ?? (value === 1 ? true : value === 0 ? false : value);
	if (read === undefined) return false;
	if (typeof read === "boolean") return read;
	checkType(read, "boolean", path, issues);
	return false;
}
