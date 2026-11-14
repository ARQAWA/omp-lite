import text from "./workflow.json";

export const BLOCK = text.block;

export default function workflow(pi) {
	pi.on("before_agent_start", (_event, ctx) => {
		if (ctx.agent.kind !== "main") return;
		return { message: { customType: "workflow", content: BLOCK, display: false } };
	});
}
