import { expect, mock, test } from "bun:test";

let items;
mock.module("@oh-my-pi/pi-coding-agent/capability", () => ({
	loadCapability: async (id, options) => ({ items: id === "context-files" && options.cwd === "/repo" ? items : [] }),
}));
mock.module("@oh-my-pi/pi-coding-agent/discovery/at-imports", () => ({
	expandAtImports: async (content, path) => content.replace("@extra.md", `[expanded for ${path}]`),
}));
const { default: childAgentsMd } = await import("../../../../src/modules/child-agents-md/index.js");
const text = (await import("../../../../src/modules/child-agents-md/child-agents-md.json")).default;

function run(kind, systemPrompt = ["base"]) {
	let handler;
	childAgentsMd({ on: (name, fn) => name === "before_agent_start" && (handler = fn) });
	return handler({ systemPrompt }, { agent: { kind }, cwd: "/repo" });
}

const agents = { path: "/repo/AGENTS.md", content: "marker ZEBRA" };
const claude = { path: "/repo/CLAUDE.md", content: "claude rules" };

test("a subagent gets only the AGENTS.md files, after the base prompt", async () => {
	items = [agents, claude, { path: "/home/u/.omp/agent/agents.md", content: "user rules" }];
	expect(await run("sub")).toEqual({
		systemPrompt: [
			"base",
			`<repo-rules>\n${text.head}\n<file path="/repo/AGENTS.md">\nmarker ZEBRA\n</file>\n<file path="/home/u/.omp/agent/agents.md">\nuser rules\n</file>\n</repo-rules>`,
		],
	});
});

test("@imports are expanded as for the main agent", async () => {
	items = [{ path: "/repo/AGENTS.md", content: "see @extra.md" }];
	const result = await run("sub");
	expect(result.systemPrompt[1]).toContain("see [expanded for /repo/AGENTS.md]");
});

test("the main agent already has AGENTS.md and gets nothing", async () => {
	items = [agents];
	expect(await run("main")).toBeUndefined();
});

test("a subagent whose prompt already holds the file gets no second copy", async () => {
	items = [agents];
	expect(await run("sub", ["base", `<file path="/repo/AGENTS.md">\n${agents.content}\n</file>`])).toBeUndefined();
});

test("the same text elsewhere in the prompt does not hide the file", async () => {
	items = [agents];
	expect((await run("sub", ["base", agents.content]))?.systemPrompt).toHaveLength(3);
});

test("no AGENTS.md means no change", async () => {
	items = [claude];
	expect(await run("sub")).toBeUndefined();
});
