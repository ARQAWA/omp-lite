// RQW Codex Adapter, OMP 19.1.1: opt-in delegation, AGENTS.md for subagents, live Codex web search, Codex transport.
import { existsSync } from "node:fs";
import { withOAuthAccess } from "@oh-my-pi/pi-ai";
import { lookup } from "@oh-my-pi/pi-coding-agent/config/registry";
import "./agentsmd.js";
import { research } from "./websearch.js";

const PICK = "omit `agent` by default; `scout` only for read-only search over unknown files; `sonic` only for mechanical edits with exact instructions.";
const BLOCKED = "Direct agent() and workpool() calls are blocked in eval. Use the task tool for explicitly requested delegation.";
const PLANNER =
	"You gather web evidence. Call web.run to search or to open pages, read what it returns, and refine the queries until the evidence answers the question. Never answer from memory and never use another tool. When the evidence is sufficient, reply with one short line and no tool call.";
const NO_LOGIN = "No openai-codex ChatGPT login. Run /login openai-codex (a ChatGPT subscription is required).";
// Greedy head: only the last stock tip is replaced, a tip quoted inside a report stays.
const TIP = /([\s\S]*)\n\nTip: this call spawned \d+ generic workers \([^\n]+\)\. Check the agent list for a closer specialist type[^\n]*/;
// Per tool: fragments to cut, lines to put under the first line, one replacement.
const EDITS = {
	__proto__: null,
	task: {
		cut: [
			"most specific, ",
			"MUST be used for exploratory codebase research, rapid code analysis, and broad pattern searches. ",
			"; run once afterward",
		],
		add: "Do not spawn sub-agents unless the user or applicable AGENTS.md/skill instructions explicitly ask for sub-agents, delegation, or parallel agent work.",
		swap: [
			"Read-only research MUST use `scout` only when files unknown.",
			"Omit `agent` by default: a general worker equal to you. `scout` only for read-only search over unknown files; `sonic` only for mechanical edits with exact instructions. The user names an agent type: pass it in `agent`. The user names a model or effort: set `model` to `provider/id:level` (your own model if none named), no `agent`. Levels: `low`, `medium`, `high`, `xhigh` (extra high), `max`; pass exactly the level the user says. In every task say how thorough to be and exactly what to return.",
		],
	},
	eval: {
		cut: [
			" Subagents have separate kernels.",
			"If blocked, leave `eval` and call `wait`.\n",
			"For 2+ independent items, use a named `workpool()`; results auto-deliver.\n",
			"- `agent`, `workpool`: background subagents, DAG waves \u2192 help://eval/agents\n",
		],
	},
};

// Anthropic OAuth sends tool names with a leading underscore.
const bare = name => (typeof name === "string" ? name.replace(/^_/, "") : "");

function patch(tool) {
	const edit = EDITS[bare(tool.name)];
	if (!edit || typeof tool.description !== "string") return;
	let text = edit.cut.reduce((kept, cut) => kept.replaceAll(cut, ""), tool.description);
	if (edit === EDITS.task) {
		text = text.replace(/^(- `agent`:) most specific\./m, "$1");
		if (!text.includes(edit.add)) text = text.replace(/\n|$/, `\n${edit.add}$&`);
		text = text.replaceAll(...edit.swap);
	}
	tool.description = text;
}

// Every `tools` array of the request, in the nested `function` shape or the flat one.
function patchTools(node) {
	if (!node || typeof node !== "object") return;
	if (Array.isArray(node.tools)) for (const tool of node.tools) if (tool && typeof tool === "object") patch(tool.function && typeof tool.function === "object" ? tool.function : tool);
	for (const value of Object.values(node)) patchTools(value);
}

export default function rqwCodexAdapter(pi) {
	pi.on("before_provider_request", (event, ctx) => {
		const body = event.payload;
		patchTools(body);
		if (ctx.model?.api !== "openai-codex-responses" || !Array.isArray(body?.tools)) return body;
		return {
			...body,
			parallel_tool_calls: true,
			reasoning: { ...body.reasoning, context: "all_turns" },
			...(/luna/i.test(ctx.model.id) && { service_tier: "priority" }),
		};
	});

	// A textual guard, not a sandbox: aliases and file-loaded code pass.
	pi.on("tool_call", event => {
		if (bare(event.toolName) === "eval" && /\b(?:agent|workpool)\s*\(/.test(event.input?.code)) return { block: true, reason: BLOCKED };
	});

	pi.on("tool_result", event => {
		if (bare(event.toolName) !== "task") return;
		const last = event.content.findLastIndex(part => part.type === "text" && TIP.test(part.text));
		return { content: event.content.map((part, index) => (index === last ? { ...part, text: part.text.replace(TIP, `$1\n\nTip: ${PICK}`) } : part)) };
	});

	// An empty `disabled` file here brings the built-in web_search back; `web_search.enabled: false` turns search off.
	// `omp usage` loads extensions before the settings: `pi.pi.settings` throws there, and that process needs no tool.
	let off;
	try { off = lookup("web_search.enabled")?.get(pi.pi.settings) === false; } catch { return; }
	if (off || existsSync(new URL("./disabled", import.meta.url))) return;
	pi.registerTool({
		name: "web_search",
		label: "Web Search",
		description: "Search the live web through the ChatGPT Codex backend; returns fetched page text with sources.",
		parameters: pi.zod.object({ query: pi.zod.string().describe("The search query or question.") }),
		approval: "read",
		async execute(_id, { query }, signal, _onUpdate, ctx) {
			// OMP's own retry: the session's account first; a 401 moves to the next account until none is left.
			const found = await withOAuthAccess(ctx.modelRegistry.authStorage, "openai-codex", access => research(query, PLANNER, access, signal), {
				sessionId: ctx.sessionManager.getSessionId(),
				signal,
				isAuthError: error => error?.status === 401,
				missingAccessMessage: NO_LOGIN,
			});
			if (!found.length) throw new Error("Codex web.run returned no evidence.");
			return { content: [{ type: "text", text: found.map((text, index) => `[fetch ${index + 1}]\n${text}`).join("\n\n") }] };
		},
	});
}
