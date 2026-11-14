import { expect, test } from "bun:test";
import workflow, { BLOCK } from "../../../../src/modules/workflow/index.js";

const TEXT = `## Workflow

Do all that was ordered and nothing beyond it. Follow exact instructions exactly. Take the shortest, simplest path: no extras, no overengineering, no guesses. An unordered part seems critical: ask the owner first.`;
let name, handler;
workflow({ on: (event, fn) => { name = event; handler = fn; } });

test("delivers the exact hidden hint to the main agent", () => {
	expect(name).toBe("before_agent_start");
	expect(BLOCK).toBe(TEXT);
	expect(handler({ reason: "prompt" }, { agent: { kind: "main" } })).toEqual({
		message: { customType: "workflow", content: TEXT, display: false },
	});
});

test("skips agents other than main", () => {
	for (const kind of ["sub", "other"]) expect(handler({ reason: "prompt" }, { agent: { kind } })).toBeUndefined();
});
