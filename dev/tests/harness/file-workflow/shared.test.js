import { describe, expect, test } from "bun:test";
import { homedir } from "node:os";
import {
	booleanLike,
	checkType,
	invalidArguments,
	lenientNumber,
	optionalEnum,
	optionalLenientNumber,
	optionalString,
	receivedName,
} from "../../../../src/modules/file-workflow/shared/args.js";
import { dropEmpty, sortedSchema } from "../../../../src/modules/file-workflow/shared/data.js";
import { isInsideWorkspaceRoot, lockKey, resolvePath } from "../../../../src/modules/file-workflow/shared/paging.js";
import { toolText, truncateOutput } from "../../../../src/modules/file-workflow/shared/tool-text.js";

describe("dropEmpty", () => {
	test("drops null, undefined and empty strings", () => {
		expect(dropEmpty({ a: null, b: undefined, c: "", d: "x" })).toEqual({ d: "x" });
	});

	test("keeps zero and false", () => {
		expect(dropEmpty({ a: 0, b: false })).toEqual({ a: 0, b: false });
	});

	test("an empty object stays empty", () => {
		expect(dropEmpty({})).toEqual({});
	});
});

test("sortedSchema sorts keys at every level", () => {
	const sorted = sortedSchema({ b: { d: 1, c: 2 }, a: [{ z: 1, y: 2 }] });
	expect(Object.keys(sorted)).toEqual(["a", "b"]);
	expect(Object.keys(sorted.b)).toEqual(["c", "d"]);
	expect(Object.keys(sorted.a[0])).toEqual(["y", "z"]);
	expect(sortedSchema({})).toEqual({});
});

test("toolText marks an error and keeps the text", () => {
	expect(toolText("")).toEqual({ content: [{ type: "text", text: "" }] });
	expect(toolText("no", true)).toEqual({ content: [{ type: "text", text: "no" }], isError: true });
});

describe("truncateOutput", () => {
	test("a string of exactly max stays whole", () => {
		expect(truncateOutput("abcd", 4)).toBe("abcd");
	});

	test("a longer one keeps its two halves around a marker", () => {
		expect(truncateOutput("0123456789", 4)).toBe("01\n\n... (output truncated) ...\n\n89");
	});

	test("multiline text keeps its character halves", () => {
		const out = truncateOutput("one\ntwo\nthree\nfour", 10);
		expect([out.startsWith("one\nt"), out.endsWith("\nfour"), out.includes("... (output truncated) ...")]).toEqual([true, true, true]);
	});
});

describe("resolvePath", () => {
	test("expands ~", () => {
		expect(resolvePath("~", "/tmp")).toBe(homedir());
		expect(resolvePath("~/x", "/tmp")).toBe(`${homedir()}/x`);
	});

	test("resolves a relative path against the base", () => {
		expect(resolvePath("a/b", "/tmp")).toBe("/tmp/a/b");
	});

	test("an absolute path keeps itself", () => {
		expect(resolvePath("/a/b", "/tmp")).toBe("/a/b");
	});
});

describe("lockKey", () => {
	test("absolute path stays itself", () => {
		expect(lockKey("/a/b.ts", "/work")).toBe("/a/b.ts");
	});

	test("relative path is resolved against cwd", () => {
		expect(lockKey("b.ts", "/work")).toBe("/work/b.ts");
	});

	test(".. is folded", () => {
		expect(lockKey("../x.ts", "/work/sub")).toBe("/work/x.ts");
	});

	test("an internal URL is kept as given", () => {
		expect(lockKey("local://notes.md", "/work")).toBe("local://notes.md");
	});
});

describe("isInsideWorkspaceRoot", () => {
	test("the root itself is inside", () => {
		expect(isInsideWorkspaceRoot("/a/b", "/a/b")).toBe(true);
	});

	test("a child is inside", () => {
		expect(isInsideWorkspaceRoot("/a/b/c.ts", "/a/b")).toBe(true);
	});

	test("a shared prefix is not inside", () => {
		expect(isInsideWorkspaceRoot("/a/bc", "/a/b")).toBe(false);
	});

	test("a sibling is not inside", () => {
		expect(isInsideWorkspaceRoot("/a/other", "/a/b")).toBe(false);
	});
});

describe("argument checks", () => {
	test("receivedName names the type", () => {
		expect([receivedName(null), receivedName([]), receivedName(NaN), receivedName("x")]).toEqual(["null", "array", "nan", "string"]);
	});

	test("checkType records a missing value as Required", () => {
		const issues = [];
		expect(checkType(undefined, "string", ["path"], issues)).toBe(false);
		expect(issues).toEqual([{ path: ["path"], message: "Required" }]);
	});

	test("invalidArguments lists one line per issue", () => {
		const text = invalidArguments([
			{ path: ["edits", 0, "path"], message: "Required" },
			{ path: [], message: "Expected object, received array" },
		]);
		expect(text).toBe("Invalid arguments:\nedits.0.path: Required\nargument: Expected object, received array");
	});

	test("optionalString tolerates an absent value but not null", () => {
		const issues = [];
		expect(optionalString(undefined, ["path"], issues)).toBeUndefined();
		expect(optionalString(null, ["path"], issues)).toBeUndefined();
		expect(issues).toEqual([{ path: ["path"], message: "Expected string, received null" }]);
	});

	test("optionalEnum rejects a value outside the options", () => {
		const issues = [];
		expect(optionalEnum("count", ["content", "count"], ["mode"], issues)).toBe("count");
		expect(optionalEnum("other", ["content", "count"], ["mode"], issues)).toBeUndefined();
		expect(issues).toEqual([
			{ path: ["mode"], message: "Invalid enum value. Expected 'content' | 'count', received 'other'" },
		]);
	});

	test("lenientNumber reads a numeric string", () => {
		expect(lenientNumber(" 5 ")).toBe(5);
		expect(lenientNumber("x")).toBe("x");
		expect(lenientNumber(3)).toBe(3);
	});

	test("optionalLenientNumber enforces the minimum", () => {
		const issues = [];
		expect(optionalLenientNumber("2", ["head_limit"], issues, 0)).toBe(2);
		expect(optionalLenientNumber(-1, ["head_limit"], issues, 0)).toBeUndefined();
		expect(issues).toEqual([{ path: ["head_limit"], message: "Number must be greater than or equal to 0" }]);
	});

	test("booleanLike reads spellings and defaults to false", () => {
		const issues = [];
		expect(booleanLike("yes", ["-i"], issues)).toBe(true);
		expect(booleanLike(1, ["-i"], issues)).toBe(true);
		expect(booleanLike(null, ["-i"], issues)).toBe(false);
		expect(booleanLike(undefined, ["-i"], issues)).toBe(false);
		expect(booleanLike(0, ["-i"], issues)).toBe(false);
		expect(booleanLike("maybe", ["-i"], issues)).toBe(false);
		expect(issues).toEqual([{ path: ["-i"], message: "Expected boolean, received string" }]);
	});
});
