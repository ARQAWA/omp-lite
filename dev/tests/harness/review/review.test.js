import { expect, test } from "bun:test";
import fs from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";

const mod = path.join(import.meta.dir, "../../../../src/modules/review");
const text = file => fs.readFileSync(path.join(mod, file), "utf8");
const snippet = [...text("skills/reviewer/SKILL.md").matchAll(/```js\n([\s\S]*?)```/g)].map(m => m[1]).find(c => c.includes("output("));
const AsyncFunction = (async () => {}).constructor;

const facts = `# Facts
## Requirements
R1. one (id a1)
> R2. quoted owner words
R4. a set (id a2)
R4.1. element (doc.md:3)
R10. ten (id a3)
## Limits
L2. limit (id a4)
## Cancelled
C1. old (id a5)
## Deferred
D1. later (id a6)
## Work
repo: /r
W1 doc.md
W3 action: push, id a7
## Replies
a1b2c3d4 -> R1
`;

// Runs the completeness snippet of the skill against a fake reviewer answer.
async function missing(answer, factsText = facts, updates = "## Round 1\nJ1 src/x.js\n") {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "review-test-"));
	fs.writeFileSync(dir + "/facts.md", factsText);
	if (updates) fs.writeFileSync(dir + "/updates.md", updates);
	const code = snippet.replace('"<dir>"', JSON.stringify(dir)).replace('"<name>"', '"AcceptorRound1"');
	try {
		return await new AsyncFunction("output", "require", code)(async name => name === "AcceptorRound1" && answer, createRequire(import.meta.url));
	} finally {
		fs.rmSync(dir, { recursive: true, force: true });
	}
}

const full = ["R1 done", "R4 done", "R4.1 done", "R10 done", "L2 kept", "W1 doc", "W1 / part: R1", "W3 push", "J1 file"].join("\n");

test("a full answer is complete", async () => {
	expect(await missing("CLEAN\nordered 4\n" + full)).toEqual([]);
});

test("a missing requirement line is returned", async () => {
	expect(await missing(full.replace("R4 done\n", ""))).toEqual(["R4"]);
});

test("R1 is not satisfied by R10 or R1.1", async () => {
	expect(await missing("R10 done\nR1.1 done", "R1. one (id a1)\nR10. ten (id a2)\n", "")).toEqual(["R1"]);
});

test("set elements, limits, files, actions and J rows are required; D, C, Replies and quotes are not", async () => {
	expect(await missing("CLEAN")).toEqual(["R1", "R4", "R4.1", "R10", "L2", "W1", "W3", "J1"]);
});

const front = file => Bun.YAML.parse(text(file).split("---")[1]);

test("profiles and skills have their frontmatter", () => {
	const acceptor = front("agents/acceptor.md"), collector = front("agents/collector.md");
	for (const p of [acceptor, collector]) expect(p.name && p.model).toBeTruthy();
	const tools = acceptor.tools.split(",").map(t => t.trim());
	expect(tools.length).toBeGreaterThan(0);
	expect(tools).not.toContain("write");
	expect(tools).not.toContain("edit");
	expect(collector.tools).toBeUndefined();
	for (const s of ["reviewer", "blindreview", "highreview"]) {
		const f = front(`skills/${s}/SKILL.md`);
		expect(f.name && f.description).toBeTruthy();
	}
});
