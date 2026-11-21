import { expect, test } from "bun:test";

const dir = `${import.meta.dir}/../../../../src/modules/rqw-reviewer`;
const front = async file => Bun.YAML.parse((await Bun.file(`${dir}/${file}`).text()).split("---")[1]);

test("the acceptor runs on Terra high with the ordered tools", async () => {
	const p = await front("agents/acceptor.md");
	expect([p.name, p.model, p["thinking-level"]]).toEqual(["acceptor", "openai-codex/gpt-6.1-terra", "high"]);
	expect(p.tools.split(", ").sort()).toEqual(["bash", "eval", "glob", "grep", "read", "task", "web_search"]);
});

test("skills: both entries and the hidden procedure", async () => {
	for (const name of ["blindreview", "highreview", "reviewer"]) {
		const s = await front(`skills/${name}/SKILL.md`);
		expect([s.name, typeof s.description, s.hide]).toEqual([name, "string", name === "reviewer" || undefined]);
	}
});

test("the module holds texts only", async () => {
	expect((await Array.fromAsync(new Bun.Glob("**").scan(dir))).filter(file => !file.endsWith(".md"))).toEqual([]);
});
