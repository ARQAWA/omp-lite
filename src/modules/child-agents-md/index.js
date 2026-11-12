// Gives task subagents the AGENTS.md files that the OMP executor strips from them.
import { basename } from "node:path";
import { loadCapability } from "@oh-my-pi/pi-coding-agent/capability";
import { expandAtImports } from "@oh-my-pi/pi-coding-agent/discovery/at-imports";
import text from "./child-agents-md.json";

const file = f => `<file path="${f.path}">\n${f.content}\n</file>`;

export default function childAgentsMd(pi) {
	pi.on("before_agent_start", async (event, ctx) => {
		if (ctx.agent.kind !== "sub") return;
		const prompt = event.systemPrompt.join("\n");
		const { items } = await loadCapability("context-files", { cwd: ctx.cwd });
		const files = [];
		for (const f of items) {
			if (basename(f.path).toLowerCase() !== "agents.md" || prompt.includes(`<file path="${f.path}">`)) continue;
			files.push({ path: f.path, content: await expandAtImports(f.content, f.path) });
		}
		if (files.length) return { systemPrompt: [...event.systemPrompt, `<repo-rules>\n${text.head}\n${files.map(file).join("\n")}\n</repo-rules>`] };
	});
}
