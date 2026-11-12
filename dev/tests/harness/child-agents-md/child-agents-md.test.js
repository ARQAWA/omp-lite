import { expect, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import childAgentsMd from "../../../../src/modules/child-agents-md/index.js";

const files = [
	{ path: "/repo/AGENTS.md", content: "rules", depth: 0 },
	{ path: "/repo/CLAUDE.md", content: "claude", depth: 0 },
];
// The exact shape of OMP's withoutAgentsMd() callback.
const withoutAgentsMd = list => list.filter(file => basename(file.path).toLowerCase() !== "agents.md");

test("OMP's name filter keeps AGENTS.md and returns a copy", () => {
	const kept = withoutAgentsMd(files);
	expect(kept).toEqual(files);
	expect(kept).not.toBe(files);
});

test("every other filter works as before", () => {
	expect([1, 2, 3].filter(n => n > 1)).toEqual([2, 3]);
	expect(files.filter(file => file.path.endsWith("CLAUDE.md"))).toEqual([files[1]]);
	expect(["AGENTS.md", "a"].filter(name => name.toLowerCase() !== "agents.md")).toEqual(["a"]);
	expect([].filter(file => file !== "agents.md")).toEqual([]);
	expect([1, 2, 3].filter(function (n) { return n > this.min; }, { min: 2 })).toEqual([3]);
});

test("a worker thread gets the patch before its own code runs", async () => {
	const script = join(mkdtempSync(join(tmpdir(), "agents-md-")), "worker.js");
	writeFileSync(script, 'postMessage([{ path: "/repo/AGENTS.md", content: "rules" }].filter(file => file.path.toLowerCase() !== "agents.md").length);');
	const worker = new Worker(script, { type: "module" });
	const kept = await new Promise((resolve, reject) => {
		worker.onmessage = event => resolve(event.data);
		worker.onerror = reject;
	});
	worker.terminate();
	expect(kept).toBe(1);
});

test("the extension registers no hooks", () => {
	const calls = [];
	childAgentsMd({ on: (...args) => calls.push(args) });
	expect(calls).toEqual([]);
});
