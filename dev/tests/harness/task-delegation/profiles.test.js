import { expect, test } from "bun:test";

const profile = async name => {
	const text = await Bun.file(new URL(`../../../../src/modules/task-delegation/agents/${name}.md`, import.meta.url)).text();
	const [, head, body] = text.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
	return { meta: Bun.YAML.parse(head), body };
};

test("task and sonic keep stock frontmatter and have an empty role", async () => {
	expect(await profile("task")).toEqual({
		meta: { name: "task", description: "General-purpose subagent with full capabilities for delegated multi-step tasks", spawns: "*", model: ["@task"], thinkingLevel: "auto" },
		body: "",
	});
	expect(await profile("sonic")).toEqual({
		meta: { name: "sonic", description: "Low-reasoning agent for strictly mechanical updates or data collection only", model: ["@smol"], thinkingLevel: "medium" },
		body: "",
	});
});
