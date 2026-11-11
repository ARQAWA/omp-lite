import { expect, test } from "bun:test";
import { wholeFileContent } from "../../../../src/modules/base-tools/index.js";

const event = (details, overrides = {}) => ({
	toolName: "read",
	isError: false,
	content: [{ type: "text", text: "one\ntwo" }],
	details,
	...overrides,
});
const whole = (overrides = {}) => ({
	totalLines: 2,
	fileSize: 8,
	displayContent: { text: "one\ntwo", startLine: 1, lineNumbers: [1, 2] },
	meta: { source: { type: "path", value: "x" } },
	...overrides,
});

test("a whole text file gets the marker", () => {
	const content = wholeFileContent(event(whole()));
	expect(content).toHaveLength(1);
	expect(content[0].text).toBe("one\ntwo\n[whole file: 2 lines]");
});

test("an empty file gets zero lines", () => {
	const content = wholeFileContent(
		event({ totalLines: 1, fileSize: 0, displayContent: { text: "", startLine: 1, lineNumbers: [1] } }, { content: [{ type: "text", text: "" }] }),
	);
	expect(content[0].text).toBe("[whole file: 0 lines]");
	expect(wholeFileContent(event({ totalLines: 1, fileSize: 0, displayContent: { text: "", startLine: 1, lineNumbers: [null] } }))).toBeUndefined();
});

test("a range to EOF, tail and middle range are not covered", () => {
	expect(wholeFileContent(event(whole({ totalLines: 5, fileSize: 24, displayContent: { text: "two\nthree\nfour\nfive", startLine: 2, lineNumbers: [2, 3, 4, 5] } }), { content: [{ type: "text", text: "two\nthree\nfour\nfive" }] }))).toBeUndefined();
	expect(wholeFileContent(event(whole({ totalLines: 5, fileSize: 24, displayContent: { text: "three\nfour\nfive", startLine: 3, lineNumbers: [3, 4, 5] } }), { content: [{ type: "text", text: "three\nfour\nfive" }] }))).toBeUndefined();
	expect(wholeFileContent(event(whole({ totalLines: 5, fileSize: 24, displayContent: { text: "two\nthree", startLine: 2, lineNumbers: [2, 3] } }), { content: [{ type: "text", text: "two\nthree" }] }))).toBeUndefined();
	expect(wholeFileContent(event(whole({ displayContent: undefined })))).toBeUndefined();
});

test("a raw whole file with display metadata gets the marker", () => {
	const content = wholeFileContent(
		event(whole({ totalLines: 5, fileSize: 24, displayContent: { text: "one\ntwo\nthree\nfour\nfive", startLine: 1, lineNumbers: [1, 2, 3, 4, 5] } }), { content: [{ type: "text", text: "one\ntwo\nthree\nfour\nfive" }] }),
	);
	expect(content[0].text).toContain("[whole file: 5 lines]");
});

test("a range whose display covers the whole file is marked", () => {
	const content = wholeFileContent(
		event(whole({ totalLines: 5, fileSize: 24, displayContent: { text: "one\ntwo\nthree\nfour\nfive", startLine: 1, lineNumbers: [1, 2, 3, 4, 5] } }), { content: [{ type: "text", text: "one\ntwo\nthree\nfour\nfive" }] }),
	);
	expect(content[0].text).toContain("[whole file: 5 lines]");
});

test("a file that ends with another count is not mistaken for the marker", () => {
	const content = wholeFileContent(
		event(whole({ totalLines: 2, fileSize: 24, displayContent: { text: "one\n[whole file: 9 lines]", startLine: 1, lineNumbers: [1, 2] } }), { content: [{ type: "text", text: "one\n[whole file: 9 lines]" }] }),
	);
	expect(content[0].text).toBe("one\n[whole file: 9 lines]\n[whole file: 2 lines]");
});

test("a range or cut keeps its native notice", () => {
	expect(wholeFileContent(event({ totalLines: 20, truncation: { truncated: true } }))).toBeUndefined();
});

test("errors, directories, images, URLs, summaries and multi-ranges stay untouched", () => {
	expect(wholeFileContent(event(whole(), { isError: true }))).toBeUndefined();
	expect(wholeFileContent(event({ isDirectory: true }))).toBeUndefined();
	expect(wholeFileContent(event(whole(), { content: [{ type: "image" }] }))).toBeUndefined();
	expect(wholeFileContent(event(whole({ meta: { source: { type: "url" } } })))).toBeUndefined();
	expect(wholeFileContent(event(whole({ summary: { elidedLines: 1 } })))).toBeUndefined();
	expect(wholeFileContent(event({ displayContent: { text: "a\nb", startLine: 1, lineNumbers: [1, 2] } }))).toBeUndefined();
});

test("a second pass on the same result does not duplicate the marker", () => {
	const result = event(whole());
	expect(wholeFileContent(result)[0].text).toBe("one\ntwo\n[whole file: 2 lines]");
	result.content = [{ type: "text", text: "changed" }];
	expect(wholeFileContent(result)).toBeUndefined();
});
