import { expect, test } from "bun:test";

const dir = `${import.meta.dir}/../../../../src/modules/rqw-reviewer`;
const front = async file => Bun.YAML.parse((await Bun.file(`${dir}/${file}`).text()).split("---")[1]);

test("profiles run on Terra xhigh; the acceptor cannot write or edit", async () => {
	for (const name of ["acceptor", "collector"]) {
		const p = await front(`agents/${name}.md`);
		expect([p.name, p.model, p["thinking-level"]]).toEqual([name, "openai-codex/gpt-6.1-terra", "xhigh"]);
		if (name === "acceptor") expect(p.tools).not.toMatch(/write|edit/);
	}
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
