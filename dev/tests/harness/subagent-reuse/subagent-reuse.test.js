import { expect, test } from "bun:test";
import subagentReuse from "../../../../src/modules/subagent-reuse/index.js";

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
	const session = {
		isStreaming: false,
		messages,
		sessionManager: { getSessionFile: () => "/tmp/new.jsonl" },
		async newSession() {
			calls.push("newSession");
			return reset;
		},
		async prompt(task) {
			calls.push(["prompt", task]);
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
	return { calls, statuses, ref, session, registry, lifecycle };
}

function mount(options) {
	const f = fixture(options);
	let tool;
	const pi = {
		zod: {
			string: () => ({ describe: () => undefined }),
			object: shape => shape,
		},
		registerTool: definition => {
			tool = definition;
		},
	};
	subagentReuse(pi, f);
	return { ...f, tool };
}

const run = (tool, params) => tool.execute("call", params);
const text = result => result.content[0].text;

test("resets the session before the new task through the tool entry", async () => {
	const m = mount();
	const result = await run(m.tool, { name: "Probe", task: "new task" });
	expect(result.isError).toBeUndefined();
	expect(text(result)).toBe("done");
	expect(m.calls).toEqual([["ensure", "Probe"], "newSession", ["attach", "/tmp/new.jsonl"], ["prompt", "new task"], "wait"]);
	expect(m.statuses).toEqual(["running", "idle"]);
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
