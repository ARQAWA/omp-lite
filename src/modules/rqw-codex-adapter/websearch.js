// Live web search through the ChatGPT Codex backend: a gpt-6-luna planner calls web.run, /alpha/search fetches the text.
import { getCodexClientVersion } from "@oh-my-pi/pi-catalog/wire/codex-version";
import tools from "./web-run.schema.json";

const BASE = "https://chatgpt.com/backend-api/codex";
const MODEL = "gpt-6-luna";
const ROUNDS = 4;
const CALLS = 8;
const BYTES = 2 * 1024 * 1024;

class PlannerError extends Error {}

const message = (role, text) => ({ type: "message", role, content: [{ type: "input_text", text }] });

function accountOf(token) {
	try {
		return JSON.parse(Buffer.from(token.split(".")[1], "base64url"))["https://api.openai.com/auth"].chatgpt_account_id;
	} catch {}
}

async function post(path, body, access, signal) {
	const stream = path === "/responses";
	const accountId = access.accountId ?? accountOf(access.accessToken);
	const response = await fetch(BASE + path, {
		method: "POST",
		headers: {
			"content-type": "application/json",
			accept: stream ? "text/event-stream" : "application/json",
			originator: "omp",
			version: getCodexClientVersion(),
			Authorization: `Bearer ${access.accessToken}`,
			...(accountId && { "chatgpt-account-id": accountId }),
		},
		body: JSON.stringify(body),
		signal: AbortSignal.any([signal, AbortSignal.timeout(180000)].filter(Boolean)),
	});
	// `status` lets the caller tell a 401 from the rest.
	if (!response.ok) throw Object.assign(new Error(`Codex ${path} failed: ${response.status} ${(await response.text()).slice(0, 400)}`), { status: response.status });
	return stream ? response.text() : response.json();
}

/** Output items of one planner stream in order; a completed response wins over its increments. */
function items(stream) {
	const out = new Map();
	for (const line of stream.split("\n")) {
		if (!line.startsWith("data: ")) continue;
		let event;
		try {
			event = JSON.parse(line.slice(6));
		} catch {
			continue;
		}
		if (event?.type === "response.failed" || event?.type === "error") throw new PlannerError(event.message || event.error?.message || event.response?.error?.message || "Codex request failed");
		if (event?.type === "response.output_item.done") out.set(event.output_index ?? out.size, event.item);
		if (event?.type === "response.completed" && Array.isArray(event.response?.output)) return event.response.output;
	}
	return [...out].sort(([a], [b]) => a - b).map(([, item]) => item);
}

/** Only the four text commands are sent on; anything else becomes a plain search of the query. */
function commands(raw, query) {
	let args;
	try {
		args = JSON.parse(raw);
	} catch {}
	const out = {};
	for (const key of ["search_query", "open", "click", "find"]) if (Object.hasOwn(args ?? {}, key)) out[key] = args[key];
	if (!Object.keys(out).length) return { search_query: [{ q: query }] };
	if (args.response_length !== undefined) out.response_length = args.response_length;
	return out;
}

export async function research(query, instructions, access, signal) {
	const id = crypto.randomUUID();
	const input = [{ type: "additional_tools", role: "developer", tools }, message("developer", instructions), message("user", query)];
	const full = () => Buffer.byteLength(JSON.stringify(input)) > BYTES;
	const found = [];
	let calls = 0;
	try {
		for (let round = 0; round < ROUNDS && !full(); round++) {
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
			const produced = items(await post("/responses", body, access, signal));
			const pending = produced.filter(item => item?.type === "function_call" && item.namespace === "web" && item.name === "run");
			if (!pending.length) break;
			input.push(...produced);
			for (const call of pending) {
				if (++calls > CALLS) return found;
				const search = { id, model: MODEL, input: [message("user", query)], commands: commands(call.arguments, query), settings: { external_web_access: true } };
				const text = (await post("/alpha/search", search, access, signal))?.output;
				if (typeof text !== "string" || !text.trim()) throw new Error("Codex alpha/search returned no text.");
				found.push(text);
				input.push({ type: "function_call_output", call_id: call.call_id, output: [{ type: "input_text", text }] });
				if (full()) return found;
			}
		}
	} catch (error) {
		if (signal?.aborted || !found.length || !(error instanceof PlannerError || error?.name === "TimeoutError")) throw error;
		found.push(`[incomplete] ${error.message}`);
	}
	return found;
}
