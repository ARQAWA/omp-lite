import { expect, test } from "bun:test";
import fs from "node:fs";
import path from "node:path";

const mod = path.join(import.meta.dir, "../../../../src/modules/review");
const text = file => fs.readFileSync(path.join(mod, file), "utf8");
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

test("the module is instructions only: no code block", () => {
	for (const f of ["agents/acceptor.md", "agents/collector.md", "skills/reviewer/SKILL.md"]) expect(text(f)).not.toContain("```js");
});
