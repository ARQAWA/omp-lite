import { afterAll, afterEach, expect, test } from "bun:test";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import subagentReuse from "../../../../src/modules/subagent-reuse/index.js";

const COOP =
	"\n§ Coop\nYou are operating on a piece of work assigned to you by the main agent.\n§ Completion\nNo TODO tracking, no progress updates. Execute; your final message is your result.";
const TAIL = "\nWhile work remains.";
const root = join(tmpdir(), `omp-reuse-tests-${process.pid}`);
rmSync(root, { recursive: true, force: true });
mkdirSync(root, { recursive: true });
let fileSeq = 0;
const files = [];

afterEach(() => {
	for (const file of files.splice(0)) rmSync(`${file}.reuse`, { force: true });
});
afterAll(() => rmSync(root, { recursive: true, force: true }));

function fixture({
	state = "idle",
	text = "done",
	reset = true,
	id = "Probe",
	displayName = id,
	messages = [],
	stopReason = "stop",
} = {}) {
	const calls = [];
	const statuses = [];
	const file = join(root, `session-${++fileSeq}.jsonl`);
	files.push(file);
	const marker = { atPrompt: false };
	let tools = ["read"];
	const session = {
		isStreaming: false,
		messages,
		sessionManager: { getSessionFile: () => file },
		getEnabledToolNames: () => [...tools],
		async setActiveToolsByName(names) {
			tools = [...names];
			calls.push(["tools", names]);
		},
		setTools: names => {
			tools = [...names];
		},
		async newSession() {
			calls.push("newSession");
			return reset;
		},
		async prompt(task) {
			calls.push(["prompt", task]);
			marker.atPrompt = existsSync(`${file}.reuse`);
		},
		async waitForIdle() {
			calls.push("wait");
		},
		getLastAssistantMessage: () => ({ role: "assistant", content: [], stopReason }),
		getLastAssistantText: () => text,
	};
	const ref = { id, displayName, kind: "sub", status: state };
	const registry = {
		list: () => [ref],
		setStatus: (_id, value) => {
			statuses.push(value);
			ref.status = value;
			return true;
		},
		attachSession: (_id, _session, file) => {
			calls.push(["attach", file]);
			return true;
		},
	};
	const lifecycle = {
		async ensureLive(name) {
			calls.push(["ensure", name]);
			return session;
		},
	};
	return { calls, statuses, ref, session, registry, lifecycle, file, marker };
}

function mount(options) {
	const f = fixture(options);
	let tool;
	const handlers = {};
	const active = ["reuse", "read"];
	const sets = [];
	const pi = {
		zod: {
			string: () => ({ describe: () => undefined }),
			object: shape => shape,
		},
		registerTool: definition => {
			tool = definition;
		},
		on: (event, handler) => {
			handlers[event] = handler;
		},
		getActiveTools: () => [...active],
		setActiveTools: async names => {
			active.length = 0;
			active.push(...names);
			sets.push(names);
		},
	};
	subagentReuse(pi, f);
	return { ...f, tool, handlers, active, sets };
}

const run = (tool, params) => tool.execute("call", params);
const text = result => result.content[0].text;

test("resets the session before the new task through the tool entry", async () => {
	const m = mount();
	const result = await run(m.tool, { name: "Probe", task: "new task" });
	expect(result.isError).toBeUndefined();
	expect(text(result)).toBe("done");
	expect(m.calls).toEqual([["ensure", "Probe"], "newSession", ["attach", m.file], ["prompt", "new task"], "wait"]);
	expect(m.statuses).toEqual(["running", "idle"]);
});

test("writes the marker before prompting", async () => {
	const m = mount();
	await run(m.tool, { name: "Probe", task: "x" });
	expect(m.marker.atPrompt).toBe(true);
});

test("does not strip a marked main session", async () => {
	const m = mount();
	await run(m.tool, { name: "Probe", task: "x" });
	const result = m.handlers.before_agent_start(
		{ systemPrompt: ["§ Context\nold"] },
		{ agent: { kind: "main" }, sessionManager: { getSessionFile: () => m.file } },
	);
	expect(result).toBeUndefined();
});

test("drops context and keeps later sections", async () => {
	const m = mount();
	await run(m.tool, { name: "Probe", task: "x" });
	const result = m.handlers.before_agent_start(
		{ systemPrompt: [`§ Role\nrole\n\n§ Context\nold task${COOP}${TAIL}`] },
		{ agent: { kind: "sub" }, sessionManager: { getSessionFile: () => m.file } },
	);
	expect(result.systemPrompt).toEqual([`§ Role\nrole${COOP}${TAIL}`]);
});

test("removes a context that contains its own heading", async () => {
	const m = mount();
	await run(m.tool, { name: "Probe", task: "x" });
	const result = m.handlers.before_agent_start(
		{ systemPrompt: [`§ Role\nrole\n\n§ Context\nold\n\n§ Context\nmore${COOP}${TAIL}`] },
		{ agent: { kind: "sub" }, sessionManager: { getSessionFile: () => m.file } },
	);
	expect(result.systemPrompt).toEqual([`§ Role\nrole${COOP}${TAIL}`]);
});

test("removes context that contains a section-like line", async () => {
	const m = mount();
	await run(m.tool, { name: "Probe", task: "x" });
	const result = m.handlers.before_agent_start(
		{ systemPrompt: [`§ Role\nrole\n\n§ Context\nold\n§ Coop\nfake${COOP}${TAIL}`] },
		{ agent: { kind: "sub" }, sessionManager: { getSessionFile: () => m.file } },
	);
	expect(result.systemPrompt).toEqual([`§ Role\nrole${COOP}${TAIL}`]);
});

test("drops a separate context block with a fake boundary", async () => {
	const m = mount();
	await run(m.tool, { name: "Probe", task: "x" });
	const result = m.handlers.before_agent_start(
		{ systemPrompt: ["§ Role\nrole", "§ Context\nold\n§ Coop\nfake"] },
		{ agent: { kind: "sub" }, sessionManager: { getSessionFile: () => m.file } },
	);
	expect(result.systemPrompt).toEqual(["§ Role\nrole"]);
});

test("removes a separate context block quoting the template", async () => {
	const m = mount();
	await run(m.tool, { name: "Probe", task: "x" });
	const result = m.handlers.before_agent_start(
		{ systemPrompt: ["§ Role\nrole", `§ Context\nold${COOP}${TAIL}`] },
		{ agent: { kind: "sub" }, sessionManager: { getSessionFile: () => m.file } },
	);
	expect(result.systemPrompt).toEqual(["§ Role\nrole"]);
});

test("drops a separate context block and keeps the rest", async () => {
	const m = mount();
	await run(m.tool, { name: "Probe", task: "x" });
	const result = m.handlers.before_agent_start(
		{ systemPrompt: ["§ Role\nrole", "§ Context\nold task"] },
		{ agent: { kind: "sub" }, sessionManager: { getSessionFile: () => m.file } },
	);
	expect(result.systemPrompt).toEqual(["§ Role\nrole"]);
});

test("keeps context before the first reuse", async () => {
	const m = mount();
	const result = m.handlers.before_agent_start(
		{ systemPrompt: ["§ Role\nrole\n\n§ Context\nfirst task"] },
		{ agent: { kind: "sub" }, sessionManager: { getSessionFile: () => m.file } },
	);
	expect(result).toBeUndefined();
});

test("removes the previous session's marker", async () => {
	const m = mount();
	const oldFile = join(root, "old-session.jsonl");
	const nextFile = join(root, "next-session.jsonl");
	files.push(oldFile, nextFile);
	writeFileSync(`${oldFile}.reuse`, "");
	let current = oldFile;
	m.session.sessionManager.getSessionFile = () => current;
	m.session.newSession = async () => {
		current = nextFile;
		return true;
	};
	await run(m.tool, { name: "Probe", task: "x" });
	expect(existsSync(`${oldFile}.reuse`)).toBe(false);
	expect(existsSync(`${nextFile}.reuse`)).toBe(true);
});

test("removes reuse from the reused subagent's tools", async () => {
	const m = mount();
	m.session.setTools(["reuse", "read"]);
	await run(m.tool, { name: "Probe", task: "x" });
	expect(m.session.getEnabledToolNames()).toEqual(["read"]);
	expect(m.calls).toContainEqual(["tools", ["read"]]);
});

test("is limited to the main agent", async () => {
	const m = mount();
	const result = await m.tool.execute("call", { name: "Probe", task: "x" }, undefined, undefined, { agent: { kind: "sub" } });
	expect(result.isError).toBe(true);
	expect(text(result)).toContain("main agent");
});

test("removes reuse from subagent tools on session start", async () => {
	const m = mount();
	await m.handlers.session_start({}, { agent: { kind: "sub" } });
	expect(m.active).toEqual(["read"]);
	expect(m.sets).toEqual([["read"]]);
});

test("matches the display name", async () => {
	const m = mount({ id: "Probe-1", displayName: "Probe" });
	expect(text(await run(m.tool, { name: "Probe", task: "x" }))).toBe("done");
	expect(m.calls[0]).toEqual(["ensure", "Probe-1"]);
});

test("unknown, running and aborted subagents return errors", async () => {
	expect(text(await run(mount().tool, { name: "missing", task: "x" }))).toContain('Unknown subagent "missing"');
	expect((await run(mount({ state: "running" }).tool, { name: "Probe", task: "x" })).isError).toBe(true);
	expect(text(await run(mount({ state: "aborted" }).tool, { name: "Probe", task: "x" }))).toContain("is aborted");
});

test("does not prompt when the session reset is cancelled", async () => {
	const m = mount({ reset: false });
	const result = await run(m.tool, { name: "Probe", task: "x" });
	expect(result.isError).toBe(true);
	expect(text(result)).toContain("did not start a new session");
	expect(m.calls).toEqual([["ensure", "Probe"], "newSession"]);
	expect(m.statuses).toEqual(["running", "idle"]);
});

test("returns the yield payload before assistant text", async () => {
	const messages = [
		{ role: "toolResult", toolName: "yield", details: { status: "success", data: { answer: "42" } } },
		{ role: "assistant", content: [{ type: "text", text: "ignored" }] },
	];
	const m = mount({ messages, text: "ignored" });
	expect(text(await run(m.tool, { name: "Probe", task: "x" }))).toBe('{\n  "answer": "42"\n}');
});

test("a string yield payload stays as written", async () => {
	const m = mount({ messages: [{ role: "toolResult", toolName: "yield", details: { status: "success", data: "42" } }] });
	expect(text(await run(m.tool, { name: "Probe", task: "x" }))).toBe("42");
});

test("an empty yield payload stays empty", async () => {
	const m = mount({ messages: [{ role: "toolResult", toolName: "yield", details: { status: "success", data: "" } }] });
	expect(text(await run(m.tool, { name: "Probe", task: "x" }))).toBe("");
});

test("failed and aborted turns return errors", async () => {
	const failed = await run(mount({ text: "", stopReason: "error" }).tool, { name: "Probe", task: "x" });
	expect(failed.isError).toBe(true);
	expect(text(failed)).toContain("failed");
	const aborted = await run(mount({ text: "", stopReason: "aborted" }).tool, { name: "Probe", task: "x" });
	expect(aborted.isError).toBe(true);
	expect(text(aborted)).toContain("aborted");
});

test("falls back when the subagent returns no text", async () => {
	const m = mount({ text: "  " });
	expect(text(await run(m.tool, { name: "Probe", task: "x" }))).toBe("(the subagent returned no text)");
});

test("reserves the agent while its revival is pending", async () => {
	let release;
	const gate = new Promise(resolve => (release = resolve));
	let started;
	const firstSeen = new Promise(resolve => (started = resolve));
	const m = mount();
	m.lifecycle.ensureLive = async () => {
		started();
		await gate;
		return m.session;
	};
	const first = run(m.tool, { name: "Probe", task: "first" });
	await firstSeen;
	const second = await run(m.tool, { name: "Probe", task: "second" });
	expect(second.isError).toBe(true);
	expect(text(second)).toContain("already being reused");
	release();
	expect(text(await first)).toBe("done");
	expect(m.statuses).toEqual(["running", "idle"]);
});

test("a failed revival releases the agent for the next call", async () => {
	const m = mount();
	let attempts = 0;
	m.lifecycle.ensureLive = async () => {
		attempts++;
		if (attempts === 1) throw new Error("revival failed");
		return m.session;
	};
	expect(text(await run(m.tool, { name: "Probe", task: "x" }))).toBe("revival failed");
	expect(text(await run(m.tool, { name: "Probe", task: "x" }))).toBe("done");
});
