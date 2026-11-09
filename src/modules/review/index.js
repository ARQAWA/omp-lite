import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";

const read = path => readFileSync(new URL(path, import.meta.url), "utf8");
const config = JSON.parse(read("./review.json"));
const systemPrompt = [read("./skills/reviewer/REVIEWER.md"), read("./skills/reviewer/WORKFLOW.md")];

export default function review(pi, complete, load = () => import("@oh-my-pi/pi-ai")) {
	const z = pi.zod;
	const run = complete ?? load()
		.then(module => module.completeSimple)
		.catch(error => () => { throw error; });
	pi.registerTool({
		name: "review",
		label: "review",
		loadMode: "essential",
		description: config.description,
		parameters: z.object({
			level: z.enum(["blind", "high"]).describe(config.level),
			packet: z.string().min(1).describe(config.packet),
		}),
		async execute(_id, { level, packet }, signal, _onUpdate, ctx) {
			try {
				signal?.throwIfAborted();
				const spec = config.models[level];
				const model = ctx.modelRegistry.getAvailable().find(item =>
					item.provider === spec.provider && item.id === spec.id);
				if (!model) throw new Error(config.errors.model);
				const sessionId = randomUUID();
				const apiKey = await ctx.modelRegistry.getApiKey(model, sessionId);
				if (!apiKey) throw new Error(config.errors.auth);
				const result = await (await run)(model, {
					systemPrompt: [...systemPrompt],
					messages: [{ role: "user", content: packet }],
					tools: [],
				}, { apiKey, sessionId, signal, reasoning: spec.reasoning });
				if (result.stopReason !== "stop" || result.content.some(block => block.type === "toolCall")) {
					throw new Error(result.errorMessage || config.errors.incomplete);
				}
				const text = result.content.filter(block => block.type === "text").map(block => block.text).join("\n").trim();
				const label = /^ {0,3}(?:(?:#{1,6}|[-*+]|\d+[.)])\s+)?(?:\*\*)?(CHECKED:|UNCHECKED\b)/;
				const labels = text.split("\n")
					.filter(line => !/^\s*>/.test(line))
					.map(line => label.exec(line)?.[1]);
				if (!text || (/^CLEAN\b/.test(text) && (!labels.includes("CHECKED:") || labels.includes("UNCHECKED")))) {
					throw new Error(config.errors.incomplete);
				}
				return { content: [{ type: "text", text }] };
			} catch (error) {
				return { content: [{ type: "text", text: String(error) }], isError: true };
			}
		},
	});
}
