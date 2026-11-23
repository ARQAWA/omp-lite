import { expect, mock, test } from "bun:test";

const { default: core, REMINDER } = await import("../../../../src/modules/rqw-system-core/index.js");

const read = path => Bun.file(new URL(`../../../../src/modules/rqw-system-core/${path}`, import.meta.url)).text();
const system = await read("SYSTEM.md");
const rule = async name => {
	const [, head, body] = (await read(`rules/${name}.md`)).match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
	return { meta: Bun.YAML.parse(head), body };
};
const main = await rule("rqw-system-core-main");
const sub = await rule("rqw-system-core-subagent");
// OMP 19.1.1 capability/rule.ts ruleAppliesToAgent.
const applies = (pattern, name) => pattern === name || new Bun.Glob(pattern).match(name);

function run(messages, kind) {
	let handler;
	core({ on: (name, fn) => name === "context" && (handler = fn) });
	return handler({ messages }, { agent: { kind } });
}

test("the reminder is the unchanged text of both blocks", () => {
	expect(REMINDER).toBe(`## Communication

The user has dyslexia. Short sentences: at most 8 words. Paragraphs: at most 4 sentences. Bold main ideas. Short steps, clear words. Simple Russian, address the user as «ты». Numbered lists for many items, one line each. Prefer lowercase. Avoid special typographic characters. This overrides all other communication rules.

Be as brief as the task allows. Brevity is for the answer only: read as much code as \`<file_work>\` orders.

Mixed or unclear message (a change plus a question, research, or report): do only the read-only part, change nothing, then ask one yes/no question about the change.

## Workflow

Do all that was ordered and nothing beyond it. Follow exact instructions exactly. Take the shortest, simplest path: no extras, no overengineering, no guesses. An unordered part seems critical: ask the owner first.`);
});

test("main: the reminder ends every user message, other messages stay", () => {
	const assistant = { role: "assistant", content: "a" };
	const image = { type: "image", data: "x" };
	const { messages } = run([{ role: "user", content: "hi" }, assistant, { role: "user", content: [image] }], "main");
	expect(messages[0].content).toBe(`hi\n\n${REMINDER}`);
	expect(messages[1]).toBe(assistant);
	expect(messages[2].content).toEqual([image, { type: "text", text: REMINDER }]);
});

test("subagents get nothing", () => {
	expect(run([{ role: "user", content: "hi" }], "sub")).toBeUndefined();
});

test("the OMP critical block leaves every request, the payload itself stays", () => {
	let handler;
	core({ on: (name, fn) => name === "before_provider_request" && (handler = fn) });
	const head = "<critical>\n- Each response MUST advance the task; completion only stopping condition.\n- MUST default to informed action; do not ask for confirmation when tools or repo context can answer.\n";
	const main = `${head}- Before yielding, MUST verify significant behavioral changes: run the specific test, command, or scenario covering the change.\n</critical>`;
	const sub = `${head}- Changes complete → yield; verification is main agent's job. NEVER run it yourself unless your assignment explicitly instructs it.\n</critical>`;
	const other = "<critical>\nNEVER repeat successful setup.\n</critical>";
	const payload = { system: [{ text: `</project-context>\n\n${main}\n\nappend` }], input: [{ content: [{ text: `ctx\n\n${sub}` }] }], tools: [{ description: other }], n: 1 };
	expect(handler({ payload })).toEqual({ system: [{ text: "</project-context>\n\nappend" }], input: [{ content: [{ text: "ctx" }] }], tools: [{ description: other }], n: 1 });
	expect(payload.system[0].text).toContain(main);
});

test("threads are off", () => {
	expect(process.env.PI_ANTHROPIC_MESSAGE_THREADS).toBe("0");
});

test("SYSTEM.md has no communication blocks", () => {
	for (const tag of ["<special_user_requests>", "<mixed_requests>", "<working_with_the_user>"]) expect(system).not.toContain(tag);
	for (const part of ["<general>", "<file_work>", "</engineering_judgment>\n\n<main_goal>"]) expect(system).toContain(part);
});

test("rules: always applied, main rule only for main, subagent note for every subagent", () => {
	expect(main.meta).toEqual({ alwaysApply: true, agents: "main" });
	expect(sub.meta).toEqual({ alwaysApply: true, agents: "!main" });
	expect(main.body).toStartWith("<special_user_requests>");
	expect(sub.body).toStartWith("You are an agent in a team of agents.");
	expect(applies(main.meta.agents, "main")).toBe(true);
	expect(applies(sub.meta.agents, "main")).toBe(false);
	for (const name of ["task", "sonic", "scout", "acceptor", "sub"]) {
		expect(applies(main.meta.agents, name)).toBe(false);
		expect(applies(sub.meta.agents, name)).toBe(true);
	}
});
