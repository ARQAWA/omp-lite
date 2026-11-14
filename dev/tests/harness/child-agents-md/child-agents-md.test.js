import { expect, test } from "bun:test";
import { basename } from "node:path";
import "../../../../src/modules/child-agents-md/index.js";

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
	expect([1, 2, 3].filter(function (n) { return n > this.min; }, { min: 2 })).toEqual([3]);
});

test("a worker thread gets the patch before its own code runs", async () => {
	const script = 'import path from "node:path"; postMessage([{ path: "/repo/AGENTS.md", content: "rules" }].filter(file => path.basename(file.path).toLowerCase() !== "agents.md").length);';
	const worker = new Worker(`data:text/javascript,${encodeURIComponent(script)}`, { type: "module" });
	const kept = await new Promise((resolve, reject) => {
		worker.onmessage = event => resolve(event.data);
		worker.onerror = reject;
	});
	worker.terminate();
	expect(kept).toBe(1);
});
