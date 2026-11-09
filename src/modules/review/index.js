import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";

const read = path => readFileSync(new URL(path, import.meta.url), "utf8");
const config = JSON.parse(read("./review.json"));
const systemPrompt = [read("./skills/reviewer/REVIEWER.md"), read("./skills/reviewer/WORKFLOW.md")];

export default function review(pi, complete) {
	const z = pi.zod;
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
				const run = complete ?? (await import("@oh-my-pi/pi-ai")).completeSimple;
				const result = await run(model, {
					systemPrompt: [...systemPrompt],
					messages: [{ role: "user", content: packet }],
					tools: [],
				}, { apiKey, sessionId, signal, reasoning: spec.reasoning });
				if (result.stopReason !== "stop" || result.content.some(block => block.type === "toolCall")) {
					throw new Error(result.errorMessage || config.errors.incomplete);
				}
				const text = result.content.filter(block => block.type === "text").map(block => block.text).join("\n").trim();
				if (!text) throw new Error(config.errors.incomplete);
				return { content: [{ type: "text", text }] };
			} catch (error) {
				return { content: [{ type: "text", text: String(error) }], isError: true };
			}
		},
	});
}
