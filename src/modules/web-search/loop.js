// One tool call, several planner rounds: each round replays its native items and the fetched text.
import { MODEL, events, post } from "./codex.js";
import { commands } from "./commands.js";

const ROUNDS = 4;
const CALLS = 8;
const BYTES = 2 * 1024 * 1024;
const INSTRUCTIONS =
	"You gather web evidence. Call web.run to search or to open pages, read what it returns, and refine the queries until the evidence answers the question. Never answer from memory and never use another tool. When the evidence is sufficient, reply with one short line and no tool call.";

const isRun = item => item?.type === "function_call" && item.namespace === "web" && item.name === "run";

/** Native output items in stream order; a completed response wins over its incremental deltas. */
function items(stream) {
	const out = new Map();
	for (const event of events(stream)) {
		if (event?.type === "response.output_item.done") out.set(event.output_index ?? out.size, event.item);
		if (event?.type === "response.completed" && Array.isArray(event.response?.output)) {
			out.clear();
			event.response.output.forEach((item, index) => out.set(index, item));
		}
	}
	return [...out].sort(([a], [b]) => a - b).map(([, item]) => item);
}

async function search(id, query, raw, auth, signal) {
	const body = {
		id,
		model: MODEL,
		input: [{ type: "message", role: "user", content: [{ type: "input_text", text: query }] }],
		commands: commands(raw) ?? { search_query: [{ q: query }] },
		settings: { external_web_access: true },
	};
	const result = await post("/alpha/search", body, auth, false, signal);
	if (typeof result?.output !== "string" || !result.output.trim()) throw new Error("Codex alpha/search returned no text.");
	return result.output;
}

export async function research(query, auth, tools, signal) {
	const threadId = crypto.randomUUID();
	const input = [
		{ type: "additional_tools", role: "developer", tools },
		{ type: "message", role: "developer", content: [{ type: "input_text", text: INSTRUCTIONS }] },
		{ type: "message", role: "user", content: [{ type: "input_text", text: query }] },
	];
	const found = [];
	let bytes = JSON.stringify(input).length;
	let calls = 0;
	for (let round = 0; round < ROUNDS; round++) {
		const body = {
			model: MODEL,
			stream: true,
			store: false,
			tool_choice: "auto",
			parallel_tool_calls: false,
			include: ["reasoning.encrypted_content"],
			reasoning: { effort: "xhigh", context: "all_turns" },
			service_tier: "priority",
			prompt_cache_key: crypto.randomUUID(),
			input,
		};
		const produced = items(await post("/responses", body, auth, true, signal));
		const pending = produced.filter(isRun);
		if (pending.length === 0) break;
		input.push(...produced);
		for (const call of pending) {
			if (++calls > CALLS) return found;
			const text = await search(threadId, query, call.arguments, auth, signal);
			found.push(text);
			input.push({ type: "function_call_output", call_id: call.call_id, output: [{ type: "input_text", text }] });
			bytes += text.length;
			if (bytes > BYTES) return found;
		}
	}
	return found;
}
