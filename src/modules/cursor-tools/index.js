// Cursor-style arguments over omp's own tools, under omp's own names.
// `grep` runs on the native search engine for plain paths and delegates to the
// native tool for archives, selectors, path lists and URLs; `bash` adds
// Cursor's block_until_ms: 0. The edit tool is switched to the apply-patch
// contract, which is what Cursor speaks.

import { executeBash } from "./bash.js";
import { executeGrep } from "./grep.js";

const GREP_DESCRIPTION = `Search the workspace with ripgrep.

- Use this tool instead of shell search commands; it respects .gitignore
- Default scope is the workspace root; set path to narrow it
- output_mode: "content" shows matching lines, "files_with_matches" shows file paths, "count" shows per-file match counts
- -A/-B/-C add context lines and only work with output_mode "content"
- head_limit caps the page; the reply names the offset for the next page
- Paths with an archive member, a line selector (file.ts:10-20), a semicolon list or an internal URL fall back to the native tool, which rejects the extra arguments`;

const BASH_DESCRIPTION = `Execute a shell command in the session workspace.

- block_until_ms: 0 starts the command in the background right away; any other value is refused
- Do not search or read files with the shell; use grep, glob and read
- Large output is kept whole; do not trim it with head or tail`;

function grepSchema(z) {
	return z.object({
		pattern: z.string(),
		path: z.string().optional(),
		glob: z.string().optional(),
		type: z.string().optional(),
		output_mode: z.string().optional(),
		"-A": z.number().optional(),
		"-B": z.number().optional(),
		"-C": z.number().optional(),
		"-i": z.boolean().optional(),
		case: z.boolean().optional(),
		gitignore: z.boolean().optional(),
		multiline: z.boolean().optional(),
		head_limit: z.number().optional(),
		offset: z.number().optional(),
		skip: z.number().optional(),
	});
}

function bashSchema(z) {
	return z.object({
		command: z.string(),
		timeout: z.number().optional(),
		cwd: z.string().optional(),
		pty: z.boolean().optional(),
		async: z.boolean().optional(),
		name: z.string().optional(),
		ready: z
			.object({ log: z.string().optional(), port: z.number().optional(), host: z.string().optional(), timeout: z.number().optional() })
			.optional(),
		block_until_ms: z.number().optional(),
	});
}

export default function cursorTools(pi) {
	install(pi);
}

export function install(pi, options = {}) {
	const z = pi.zod;
	pi.registerTool({
		name: "grep",
		label: "grep",
		loadMode: "essential",
		concurrency: "shared",
		strict: false,
		description: GREP_DESCRIPTION,
		parameters: grepSchema(z),
		execute: (toolCallId, params, signal, onUpdate, ctx) => executeGrep(toolCallId, params, signal, onUpdate, ctx, options),
	});
	pi.registerTool({
		name: "bash",
		label: "bash",
		loadMode: "essential",
		concurrency: args => (args?.pty === true ? "exclusive" : "shared"),
		approval: "exec",
		strict: false,
		description: BASH_DESCRIPTION,
		parameters: bashSchema(z),
		execute: executeBash,
	});
	const enable = () => enableApplyPatch(pi);
	pi.on?.("session_start", enable);
	enable();
}

/** Runtime-only: the apply-patch contract without touching the saved settings. */
async function enableApplyPatch(pi) {
	try {
		const { lookup } = await import("@oh-my-pi/pi-coding-agent/config/registry");
		lookup("edit.mode")?.override(pi.pi.settings, "apply_patch");
	} catch {
		// Registry unavailable in this runtime: keep the configured edit mode.
	}
}
