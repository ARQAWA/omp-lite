import { expect, test } from "bun:test";

const read = path => Bun.file(new URL(`../../../../src/modules/${path}`, import.meta.url)).text();
const system = await read("system-prompt/SYSTEM.md");
const rule = async name => {
	const [, head, body] = (await read(`communication/rules/${name}.md`)).match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
	return { meta: Bun.YAML.parse(head), body };
};
const main = await rule("communication-main");
const sub = await rule("communication-subagent");
// OMP 18.18.8 capability/rule.ts ruleAppliesToAgent.
const applies = (pattern, name) => pattern === name || new Bun.Glob(pattern).match(name);

test("user-facing blocks left SYSTEM.md", () => {
	for (const tag of ["<special_user_requests>", "<mixed_requests>", "<working_with_the_user>"]) expect(system).not.toContain(tag);
	expect(system).not.toContain("concise");
	for (const part of ["<general>", "<file_work>", "</engineering_judgment>\n\n<main_goal>"]) expect(system).toContain(part);
});

test("the main rule carries the three blocks in order, always applied", () => {
	expect(main.meta).toEqual({ alwaysApply: true, agents: "main" });
	const at = ["<special_user_requests>", "<mixed_requests>", "<working_with_the_user>"].map(tag => main.body.indexOf(tag));
	expect(at[0]).toBe(0);
	expect(at).toEqual([...at].sort((a, b) => a - b));
	expect(main.body.trimEnd().endsWith("</working_with_the_user>")).toBe(true);
});

test("the subagent rule carries the report note, always applied", () => {
	expect(sub.meta).toEqual({ alwaysApply: true, agents: "!main" });
	expect(sub.body).toStartWith("You are an agent in a team of agents.");
	expect(sub.body).toContain("It has no length limit.");
	expect(sub.body).toContain("Maximize its useful payload");
});

test("scope: main rule only for main, subagent rule for every subagent", () => {
	const subs = ["task", "sonic", "scout", "acceptor", "collector", "sub"];
	expect(applies(main.meta.agents, "main")).toBe(true);
	for (const name of subs) {
		expect(applies(main.meta.agents, name)).toBe(false);
		expect(applies(sub.meta.agents, name)).toBe(true);
	}
	expect(applies(sub.meta.agents, "main")).toBe(false);
});
