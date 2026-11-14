import { expect, test } from "bun:test";
import dyslexia, { BLOCK } from "../../../../src/modules/dyslexia/index.js";

function handler() {
	let fn;
	dyslexia({ on: (name, handle) => { expect(name).toBe("before_agent_start"); fn = handle; } });
	expect(fn).toBeDefined();
	return fn;
}

test("delivers the unchanged rule as a hidden message", () => {
	expect(BLOCK).toBe(`## Communication

The user has dyslexia. Short sentences: at most 8 words. Paragraphs: at most 4 sentences. Bold main ideas. Short steps, clear words. Simple Russian, address the user as «ты». Numbered lists for many items, one line each. Prefer lowercase. Avoid special typographic characters. This overrides all other communication rules.

Mixed or unclear message (a change plus a question, research, or report): do only the read-only part, change nothing, then ask one yes/no question about the change.`);
	const run = handler();
	for (const kind of ["main", "other"]) for (const reason of ["prompt", "revive"]) {
		expect(run({ reason }, { agent: { kind } })).toEqual({ message: { customType: "dyslexia", content: BLOCK, display: false } });
	}
});

test("subagents get nothing", () => {
	const run = handler();
	for (const reason of ["prompt", "revive"]) expect(run({ reason }, { agent: { kind: "sub" } })).toBeUndefined();
});
