// Rewrites memory tool descriptions at runtime without forking OMP.
import { writeFileSync } from "node:fs";
import { join } from "node:path";

const OLD = {
	recall: `Search long-term memory; return raw relevance-ranked matching entries.

Use proactively before questions about past conversations, user preferences, project decisions, or topics where prior context improves accuracy. When in doubt, recall first.

\`xd://recall\`: specific facts or entries. \`xd://reflect\`: synthesized answer across many memories.

Results: content preview. Trailing \`…\`: truncation (\`truncated: true\`; \`full_length\`: original size). Before any \`xd://memory_edit update\`, MUST fetch full row: \`read memory://<id>\`.`,
	retain: `Store ≥1 fact in long-term memory for future sessions.

Use: durable, reusable knowledge—user preferences, project decisions, architectural choices; anything improving future responses. No ephemeral task state.

Each item MUST be specific, self-contained: who, what, when, why. Batch related facts per call; deduplicated and consolidated.`,
	reflect: `\`xd://reflect\`: synthesizes a coherent response from relevant long-term memories; unlike \`xd://recall\`, blends them.

Use for open-ended questions spanning many stored facts: "What do you know about this user?", "Summarize project decisions.", "What are my preferences for X?"

\`context\` optional; focuses synthesis on a specific angle or sub-topic.`,
	memory_edit: `Edit Mnemopi long-term memories by id. Only ids returned by \`xd://recall\`.

Operations:
- \`update\`: working memory; replace content and/or importance.
- \`forget\`: permanently delete working memory.
- \`invalidate\`: softly supersede working or episodic memory; optional \`replacement_id\`.

Fact ids — \`xd://recall\` results marked \`[facts]\`: read-only. Inspect with \`read memory://<id>\`; any edit op → \`not_editable\`.

Prefer \`invalidate\` for stale memory whose history may still be useful. Use \`forget\` only for content requiring hard deletion.

MUST read full memory before \`update\`. Recall previews clipped: trailing \`…\` marks truncation; \`full_length\` original size. \`update\` replaces content wholesale → updating a preview deletes its unseen tail. First \`read memory://<id>\`; pass merged content in \`content\`.`,
	learn: `Capture reusable lessons in long-term memory; optionally mint/enhance a managed skill in the same call.

Use after solving insight likely to pay off again: a non-obvious fix, discovered project convention, or workflow that worked.

\`skill\` optional; provide only for a repeatable procedure worth codifying as \`SKILL.md\`, not a fact. Managed skills: isolated \`~/.omp/agent/managed-skills\`; surfaced as normal skills next session; NEVER touch user-authored skills. Frontmatter: generated from \`name\` and \`description\`.

Capture sparingly, specifically: one strong reusable lesson > several vague ones.`,
};

const NEW = {
	recall: `Search Mnemopi long-term memory.
Returns relevance-ranked previews with ids.

Call before answering about:
- earlier sessions, "what did we decide"
- user preferences, style, corrections
- project conventions, architecture, rejected approaches
- a task that resembles past work

Do not call for general knowledge, current files, or every turn.

Query: natural language, 3-10 keywords.
Include names, paths, and technologies.
Use the language of the stored memories when known.

Results: preview, score, id. A trailing "…" means clipped.
Read memory://<id> for the full row before memory_edit update.
If nothing relevant is found, say so; do not invent.`,
	retain: `Store durable facts for future sessions.

Store:
- user preferences, style rules, corrections
- project decisions and the reason behind them
- constraints, conventions, rejected approaches
- stable environment or workflow facts

Do not store:
- task progress, TODOs, temporary state
- secrets, tokens, credentials
- code or file contents already in the repo
- duplicates: recall first, update the existing memory instead

One fact per item. Include who, what, when, why.
Keep each item under 500 characters. Batch related facts.
Context names the source: session, file, or date.`,
	reflect: `Answer a question by synthesizing many memories.

Use when the answer needs several memories combined:
"what do you know about me", "summarize our decisions".
Do not use for one fact; use recall.

Pass a focused query. Optional context narrows the angle.
Cite memory ids. State uncertainty when memories conflict.`,
	memory_edit: `Edit Mnemopi memories by id. Use ids returned by recall.

update: replace content and/or importance in working memory.
forget: permanent delete. Use only for hard deletion.
invalidate: supersede stale memory; keep its history.

Prefer invalidate for outdated decisions.
Prefer update for a corrected fact.

MUST read memory://<id> before update.
A preview with "…" is clipped; updating it deletes the unseen tail.
Pass the full merged content.

Fact ids marked [facts] are read-only.`,
	learn: `Capture one durable lesson, optionally mint a managed skill.

Use for reusable procedure or non-obvious fix.
Do not use for task state or facts already in memory.
Keep the lesson specific: what, when, why.`,
};

const TARGETS = Object.keys(OLD);
export { NEW, OLD };

export default function memoryPrompts(pi) {
	const state = new Map();
	const warned = new Set();
	let ui;

	const matches = (actual, expected) =>
		actual.replace(/\r\n/g, "\n").trimEnd() === expected.replace(/\r\n/g, "\n").trimEnd();

	const writeStatus = () => {
		const file = process.env.OMP_MEMORY_PROMPTS_STATUS ?? join(import.meta.dir, "..", "memory-tool-prompts.status.json");
		const tools = {};
		for (const name of TARGETS) tools[name] = state.get(name) ?? { status: "unchecked" };
		try {
			writeFileSync(file, `${JSON.stringify({ checkedAt: new Date().toISOString(), tools }, null, 2)}\n`);
		} catch {
			// A read-only profile must not break the session.
		}
	};

	const refreshStatusBar = () => {
		if (!ui) return;
		const stale = TARGETS.filter(name => state.get(name)?.status === "stale");
		ui.setStatus("memory-prompts", stale.length > 0 ? `memory patch stale: ${stale.join(", ")}` : undefined);
	};

	const reportStale = (name, source, actual, ctx) => {
		if (ctx?.ui?.setStatus) ui = ctx.ui;
		state.set(name, { status: "stale", actual: String(actual).slice(0, 300) });
		writeStatus();
		refreshStatusBar();
		if (warned.has(name)) return;
		warned.add(name);
		const target = ctx?.ui ?? ui;
		target?.notify?.(
			`Memory prompt patch: "${name}" changed upstream (${source}). Replacement skipped; update the OLD baseline.`,
			"warning",
		);
	};

	const rewriteTool = (record, name, source, ctx) => {
		const oldText = OLD[name];
		const newText = NEW[name];
		if (oldText === undefined || newText === undefined) return false;
		if (typeof record.description !== "string") return false;
		if (matches(record.description, newText)) {
			state.set(name, { status: "patched" });
			return false;
		}
		if (!matches(record.description, oldText)) {
			reportStale(name, source, record.description, ctx);
			return false;
		}
		record.description = newText;
		state.set(name, { status: "patched" });
		writeStatus();
		refreshStatusBar();
		return true;
	};

	pi.on("session_start", (_event, ctx) => {
		if (ctx?.ui?.notify && ctx.ui.setStatus) ui = ctx.ui;
		let tools;
		try {
			tools = pi.getAllTools();
		} catch {
			return;
		}
		if (!Array.isArray(tools)) return;
		let found = 0;
		for (const name of TARGETS) {
			if (state.get(name)?.status === "stale") continue;
			let description;
			for (const tool of tools) {
				if (typeof tool !== "object" || tool === null) continue;
				if (!("name" in tool) || tool.name !== name) continue;
				if ("description" in tool && typeof tool.description === "string") description = tool.description;
				break;
			}
			if (description === undefined) {
				state.set(name, { status: "missing" });
				continue;
			}
			found += 1;
			const oldText = OLD[name];
			const newText = NEW[name];
			if (oldText === undefined || newText === undefined) continue;
			if (matches(description, newText)) state.set(name, { status: "patched" });
			else if (matches(description, oldText)) state.set(name, { status: "ok" });
			else reportStale(name, "registry", description, ctx);
		}
		if (found > 0) {
			writeStatus();
			refreshStatusBar();
		}
	});

	pi.on("before_provider_request", (event, ctx) => {
		if (typeof event !== "object" || event === null || !("payload" in event)) return event;
		const payload = event.payload;
		const seen = new WeakSet();
		const walk = node => {
			if (typeof node !== "object" || node === null || seen.has(node)) return;
			seen.add(node);
			if (Array.isArray(node)) {
				for (const item of node) walk(item);
				return;
			}
			const fn = node.function;
			if (typeof fn === "object" && fn !== null && !Array.isArray(fn)) {
				if (typeof fn.name === "string" && typeof fn.description === "string") rewriteTool(fn, fn.name, "payload", ctx);
			}
			if (
				typeof node.name === "string" &&
				typeof node.description === "string" &&
				("parameters" in node ||
					"input_schema" in node ||
					"inputSchema" in node ||
					"strict" in node ||
					node.type === "function")
			) {
				rewriteTool(node, node.name, "payload", ctx);
			}
			for (const value of Object.values(node)) walk(value);
		};
		walk(payload);
		return payload;
	});

	pi.on("tool_result", (event, ctx) => {
		if (typeof event !== "object" || event === null) return;
		if (event.toolName !== "read" || event.isError === true) return;
		const input = event.input;
		if (typeof input !== "object" || input === null || Array.isArray(input)) return;
		const path = input.path;
		if (typeof path !== "string" || !path.startsWith("xd://")) return;
		const name = path.slice("xd://".length);
		const oldText = OLD[name];
		const newText = NEW[name];
		if (oldText === undefined || newText === undefined) return;
		const content = event.content;
		if (!Array.isArray(content)) return;
		const parts = [];
		for (const chunk of content) {
			if (typeof chunk !== "object" || chunk === null) continue;
			if (chunk.type !== "text" || typeof chunk.text !== "string") continue;
			parts.push(chunk.text);
		}
		const original = parts.join("\n");
		if (original === "") return;
		const firstBreak = original.indexOf("\n\n");
		const firstLine = firstBreak > 0 ? original.slice(0, firstBreak) : "";
		const hasHeading = firstLine.startsWith("# ") && firstLine.includes(" — ");
		const doc = hasHeading ? original.slice(firstBreak + 2) : original;
		const schemaAt = doc.indexOf("\n## Schema");
		const body = schemaAt >= 0 ? doc.slice(0, schemaAt) : doc;
		const schema = schemaAt >= 0 ? doc.slice(schemaAt) : "";
		if (matches(body, newText)) {
			state.set(name, { status: "patched" });
			return;
		}
		if (!matches(body, oldText)) {
			reportStale(name, path, body, ctx);
			return;
		}
		state.set(name, { status: "patched" });
		writeStatus();
		refreshStatusBar();
		return { content: [{ type: "text", text: `${newText}${schema}` }] };
	});
}
