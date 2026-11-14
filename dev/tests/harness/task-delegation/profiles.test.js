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

test("scout keeps stock frontmatter without output and has the role of Cursor's explore", async () => {
	const { meta, body } = await profile("scout");
	expect(meta).toEqual({ name: "scout", description: "MUST be used for exploratory codebase research, rapid code analysis, and broad pattern searches. Fast read-only scout returning compressed context for handoff.", tools: ["read", "find", "grep", "glob", "ast_grep", "web_search"], model: ["@smol"], thinkingLevel: "medium", readSummarize: false });
	expect(body).toContain("You excel at thoroughly navigating and exploring codebases.");
	expect(body).toContain("Adapt your search approach based on the thoroughness level specified by the caller");
	expect(body).not.toMatch(/brief|few seconds|NEVER read full files|Cursor|UpdateCurrentStep/);
});
