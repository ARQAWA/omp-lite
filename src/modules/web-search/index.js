// Live Codex web search for OMP: shadows the built-in web_search with a multi-round web.run loop.
import { existsSync, readFileSync } from "node:fs";
import { authOf } from "./codex.js";
import { research } from "./loop.js";

const TOOLS = JSON.parse(readFileSync(new URL("./web-run.schema.json", import.meta.url), "utf8"));

export default function codexWebRun(pi) {
	// Off switch: an empty `disabled` file in this folder restores the built-in web_search.
	if (existsSync(new URL("./disabled", import.meta.url))) return;
	const z = pi.zod;
	pi.registerTool({
		name: "web_search",
		label: "Web Search",
		description: "Search the live web through the ChatGPT Codex backend; returns fetched page text with sources.",
		parameters: z.object({ query: z.string().describe("The search query or question.") }),
		approval: "read",
		async execute(_toolCallId, { query }, signal, _onUpdate, ctx) {
			const access = await ctx.modelRegistry?.authStorage?.oauth?.access("openai-codex", undefined, { signal });
			if (!access?.accessToken) {
				throw new Error("No openai-codex ChatGPT login. Run /login openai-codex (a ChatGPT subscription is required).");
			}
			const found = await research(query, authOf(access), TOOLS, signal);
			if (found.length === 0) throw new Error("Codex web.run returned no evidence.");
			return { content: [{ type: "text", text: found.map((text, index) => `[fetch ${index + 1}]\n${text}`).join("\n\n") }] };
		},
	});
}
