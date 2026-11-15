import { afterEach, expect, mock, test } from "bun:test";
import { basename } from "node:path";

// OMP stand-ins: accounts are tried in order, the next one only after an auth error.
mock.module("@oh-my-pi/pi-ai", () => ({
	withOAuthAccess: async (storage, _provider, attempt, options) => {
		let last = new Error(options.missingAccessMessage);
		for (const access of storage) {
			try {
				return await attempt(access);
			} catch (error) {
				if (!options.isAuthError(error)) throw error;
				last = error;
			}
		}
		throw last;
	},
}));
mock.module("@oh-my-pi/pi-coding-agent/config/registry", () => ({ lookup: id => ({ get: settings => settings[id] }) }));
const { default: adapter } = await import("../../../../src/modules/rqw-codex-adapter/index.js");

const originalFetch = globalThis.fetch;
afterEach(() => {
	globalThis.fetch = originalFetch;
	mock.restore();
});

function load(settings = {}) {
	const hooks = {};
	let tool;
	adapter({
		pi: { settings },
		zod: { string: () => ({ describe: () => ({}) }), object: shape => shape },
		on: (name, handler) => (hooks[name] = handler),
		registerTool: definition => (tool = definition),
	});
	return { hooks, tool };
}

const request = (tools, model = {}) => load().hooks.before_provider_request({ payload: { tools } }, { model });
const RULE = "Do not spawn sub-agents unless the user or applicable AGENTS.md/skill instructions explicitly ask for sub-agents, delegation, or parallel agent work.";

test("task: the rule goes under the first line once, scout pushes go, both names and shapes work", () => {
	const description = "Spawn `tasks[]` concurrently.\n\n# Delegation\nUse most specific agent. Read-only research MUST use `scout` only when files unknown. Prefer one agent.\n- `scout`: MUST be used for exploratory codebase research, rapid code analysis, and broad pattern searches. Read-only scout.";
	const flat = { name: "_task", description };
	const nested = { type: "function", function: { name: "_task", description } };
	const other = { name: "read", description: "Use most specific agent." };
	request([flat, nested, other]);
	request([flat, nested]);
	request([flat, nested]);
	for (const text of [flat.description, nested.function.description]) {
		expect(text).toBe(`Spawn \`tasks[]\` concurrently.\n${RULE}\n\n# Delegation\nOmit \`agent\` by default: a general worker equal to you. \`scout\` only for read-only search over unknown files; \`sonic\` only for mechanical edits with exact instructions. The user names an agent type: pass it in \`agent\`. The user names a model or effort: set \`model\` to \`provider/id:level\` (your own model if none named), no \`agent\`. Levels: \`low\`, \`medium\`, \`high\`, \`xhigh\` (extra high), \`max\`; pass exactly the level the user says. In every task say how thorough to be and exactly what to return. Prefer one agent.\n- \`scout\`: Read-only scout.`);
	}
	expect(other.description).toBe("Use most specific agent.");
});

test("eval: Bun by default, no agent and workpool hints, direct calls blocked", () => {
	const tool = {
		name: "eval",
		description: [
			"One cell per call. Subagents have separate kernels.",
			"For 2+ independent items, use a named `workpool()`; results auto-deliver. If blocked, leave `eval` and call `wait`.",
			"- `agent`, `workpool`: background subagents, DAG waves \u2192 `xd://eval/agents`",
			'eval(language="py", code="%load \\"scripts/my setup.py\\"")',
		].join("\n"),
	};
	request([tool]);
	expect(tool.description).toBe('One cell per call.\nUse JavaScript (Bun) by default. Use Python only for rare tasks requiring Python-specific libraries, such as pandas, NumPy or Matplotlib.\nFor project file reading and searching, use the read, grep and glob tools. Use eval for computation, not as a substitute for those tools.\neval(language="js", code="%load \\"scripts/my setup.js\\"")');
	const guard = load().hooks.tool_call;
	for (const code of ['await agent("read")', "workpool ()"]) {
		expect(guard({ toolName: "_eval", input: { code } })).toEqual({ block: true, reason: "Direct agent() and workpool() calls are blocked in eval. Use the task tool for explicitly requested delegation." });
	}
	expect(guard({ toolName: "eval", input: { code: "print(2 + 2)" } })).toBeUndefined();
	expect(guard({ toolName: "read", input: { code: "agent()" } })).toBeUndefined();
});

test("task result: only the last stock tip becomes ours", () => {
	const tip = "\n\nTip: this call spawned 2 generic `task` workers. Check the agent list for a closer specialist type.";
	const content = [{ type: "text", text: `Quoted:${tip}` }, { type: "text", text: `The child reported:${tip}\n\nEnd.${tip}\n\nTail.` }, { type: "image", data: "x" }];
	const { hooks } = load();
	expect(hooks.tool_result({ toolName: "_task", content }).content).toEqual([
		content[0],
		{ type: "text", text: `The child reported:${tip}\n\nEnd.\n\nTip: omit \`agent\` by default; \`scout\` only for read-only search over unknown files; \`sonic\` only for mechanical edits with exact instructions.\n\nTail.` },
		content[2],
	]);
	expect(hooks.tool_result({ toolName: "read", content })).toBeUndefined();
});

test("subagents keep AGENTS.md, in a worker thread too; other filters work as before", async () => {
	const files = [{ path: "/repo/AGENTS.md", content: "rules" }, { path: "/repo/CLAUDE.md", content: "claude" }];
	// The exact shape of OMP's withoutAgentsMd() callback.
	expect(files.filter(file => basename(file.path).toLowerCase() !== "agents.md")).toEqual(files);
	expect(files.filter(file => file.path.endsWith("CLAUDE.md"))).toEqual([files[1]]);
	expect(["AGENTS.md", "a"].filter(name => name.toLowerCase() !== "agents.md")).toEqual(["a"]);
	const script = 'import path from "node:path"; postMessage([{ path: "/repo/AGENTS.md", content: "rules" }].filter(file => path.basename(file.path).toLowerCase() !== "agents.md").length);';
	const worker = new Worker(`data:text/javascript,${encodeURIComponent(script)}`, { type: "module" });
	const kept = await new Promise((resolve, reject) => {
		worker.onmessage = event => resolve(event.data);
		worker.onerror = reject;
	});
	worker.terminate();
	expect(kept).toBe(1);
});

const sse = event => new Response(`data: ${JSON.stringify(event)}\n\n`);
const plan = args => sse({ type: "response.completed", response: { output: [{ type: "function_call", namespace: "web", name: "run", call_id: "call", arguments: JSON.stringify(args) }] } });
const search = (fetch, accounts = [{ accessToken: "a" }]) => {
	globalThis.fetch = fetch;
	return load().tool.execute("id", { query: "q" }, undefined, undefined, { modelRegistry: { authStorage: accounts }, sessionManager: { getSessionId: () => "s" } });
};

test("web search: a 401 moves to the next account; only text commands are sent on", async () => {
	const kept = { search_query: [{ q: "a" }], open: [{ ref_id: "r" }], click: [{ ref_id: "r", id: 1 }], find: [{ ref_id: "r", pattern: "p" }], response_length: "long" };
	let planned = false;
	let sent;
	const result = await search(
		(url, options) => {
			if (options.headers.Authorization === "Bearer a") return new Response("no", { status: 401 });
			if (url.endsWith("/alpha/search")) {
				sent = JSON.parse(options.body).commands;
				return Response.json({ output: "source" });
			}
			if (planned) return sse({ type: "response.completed", response: { output: [] } });
			planned = true;
			return plan({ ...kept, weather: [{}] });
		},
		[{ accessToken: "a" }, { accessToken: "b" }],
	);
	expect(result.content[0].text).toBe("[fetch 1]\nsource");
	expect(sent).toEqual(kept);
	await expect(search(() => new Response("no", { status: 401 }), [{ accessToken: "a" }, { accessToken: "b" }])).rejects.toThrow("Codex /responses failed: 401 no");
	await expect(search(() => new Response("no", { status: 500 }), [{ accessToken: "a" }, { accessToken: "b" }])).rejects.toThrow("500");
});

test("web search: a timeout after the first fetch keeps the evidence; a cancel rejects", async () => {
	let planned = false;
	const fetch = url => {
		if (url.endsWith("/alpha/search")) return Response.json({ output: "source" });
		if (planned) throw new DOMException("timed out", "TimeoutError");
		planned = true;
		return plan({ open: [{ ref_id: "turn0search0" }] });
	};
	expect((await search(fetch)).content[0].text).toBe("[fetch 1]\nsource\n\n[fetch 2]\n[incomplete] timed out");
	const controller = new AbortController();
	planned = false;
	globalThis.fetch = url => {
		if (planned && !url.endsWith("/alpha/search")) controller.abort();
		return fetch(url);
	};
	await expect(load().tool.execute("id", { query: "q" }, controller.signal, undefined, { modelRegistry: { authStorage: [{ accessToken: "a" }] }, sessionManager: { getSessionId: () => "s" } })).rejects.toThrow("timed out");
});

test("web search off: by the setting", () => {
	expect(load({ "web_search.enabled": false }).tool).toBeUndefined();
	expect(load().tool.name).toBe("web_search");
});

test("profiles: task and sonic have an empty role at medium; scout lists only enabled tools", async () => {
	const profile = async name => {
		const text = await Bun.file(new URL(`../../../../src/modules/rqw-codex-adapter/agents/${name}.md`, import.meta.url)).text();
		const [, head, body] = text.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
		return { ...Bun.YAML.parse(head), body };
	};
	expect(await profile("task")).toEqual({ name: "task", description: "General-purpose subagent with full capabilities for delegated multi-step tasks", spawns: "*", model: ["@task"], thinkingLevel: "medium", body: "" });
	expect(await profile("sonic")).toEqual({ name: "sonic", description: "Low-reasoning agent for strictly mechanical updates or data collection only", model: ["@smol"], thinkingLevel: "medium", body: "" });
	const scout = await profile("scout");
	expect(scout.tools).toEqual(["read", "grep", "glob", "web_search"]);
	expect(scout.readSummarize).toBe(false);
	expect(scout.body).toContain("Your report is the complete deliverable at the requested depth");
});

test("settings: any model per spawn, scout and sonic on Terra, the native reviewers off", async () => {
	const { task } = Bun.YAML.parse(await Bun.file(new URL("../../../../src/modules/rqw-codex-adapter/rqw-codex-adapter.yml", import.meta.url)).text());
	expect(task).toEqual({
		showResolvedModelBadge: true,
		maxConcurrency: 100,
		perCallModel: "on",
		enableEffort: false,
		agentModelOverrides: { scout: "openai-codex/gpt-6.1-terra:xhigh", sonic: "openai-codex/gpt-6.1-terra:medium" },
		disabledAgents: ["reviewer", "security-reviewer"],
	});
});
