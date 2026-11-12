// Gives task subagents the AGENTS.md files that the OMP executor strips from them.
import { basename } from "node:path";
import { loadCapability } from "@oh-my-pi/pi-coding-agent/capability";
import { expandAtImports } from "@oh-my-pi/pi-coding-agent/discovery/at-imports";
import text from "./child-agents-md.json";

const file = f => `<file path="${f.path}">\n${f.content}\n</file>`;

export default function childAgentsMd(pi) {
	pi.on("before_agent_start", async (event, ctx) => {
		// --no-context-files: the main agent has no AGENTS.md either. OMP exposes the flag to extensions only as argv.
		if (ctx.agent.kind !== "sub" || process.argv.includes("--no-context-files")) return;
		const prompt = event.systemPrompt.join("\n");
		// The main agent also reads the additional workspace roots.
		const roots = [ctx.cwd, ...(ctx.sessionManager.getHeader()?.additionalDirectories ?? [])];
		const found = await Promise.all(roots.map(cwd => loadCapability("context-files", { cwd })));
		const files = [];
		// Farther from cwd first, as OMP orders them: the nearest file comes last.
		for (const f of found.flatMap(result => result.items).sort((a, b) => (b.depth ?? 1e9) - (a.depth ?? 1e9))) {
			if (basename(f.path).toLowerCase() !== "agents.md" || prompt.includes(`<file path="${f.path}">`) || files.some(seen => seen.path === f.path)) continue;
			files.push({ path: f.path, content: await expandAtImports(f.content, f.path) });
		}
		if (files.length) return { systemPrompt: [...event.systemPrompt, `<repo-rules>\n${text.head}\n${files.map(file).join("\n")}\n</repo-rules>`] };
	});
}
