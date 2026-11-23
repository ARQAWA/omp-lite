export const REMINDER = `## Communication

The user has dyslexia. Short sentences: at most 8 words. Paragraphs: at most 4 sentences. Bold main ideas. Short steps, clear words. Simple Russian, address the user as «ты». Numbered lists for many items, one line each. Prefer lowercase. Avoid special typographic characters. This overrides all other communication rules.

Be as brief as the task allows. Brevity is for the answer only: read as much code as \`<file_work>\` orders.

Mixed or unclear message (a change plus a question, research, or report): do only the read-only part, change nothing, then ask one yes/no question about the change.

## Workflow

Do all that was ordered and nothing beyond it. Follow exact instructions exactly. Take the shortest, simplest path: no extras, no overengineering, no guesses. An unordered part seems critical: ask the owner first.`;

// No message threads: every request carries the full history.
process.env.PI_ANTHROPIC_MESSAGE_THREADS = "0";

// OMP 19.1.1 prompts/system/project-prompt.md: the rendered tail block, main and subagent forms.
const CRITICAL = /\s*<critical>\s*- Each response MUST advance the task;[^\n]*\s*- MUST default to informed action;[^\n]*\s*- (?:Before yielding, MUST verify|Changes complete)[^\n]*\s*<\/critical>/;

// A copy: OMP compares its own request with the next one (openai-codex-responses.ts, buildCodexChainedRequestBody).
function withoutCritical(node) {
	if (typeof node === "string") return node.includes("<critical>") ? node.replace(CRITICAL, "") : node;
	if (Array.isArray(node)) return node.map(withoutCritical);
	if (!node || typeof node !== "object") return node;
	return Object.fromEntries(Object.entries(node).map(([key, value]) => [key, withoutCritical(value)]));
}

const withReminder = content =>
	typeof content === "string" ? `${content}\n\n${REMINDER}` : [...content, { type: "text", text: REMINDER }];

export default function rqwSystemCore(pi) {
	pi.on("before_provider_request", event => withoutCritical(event.payload));
	pi.on("context", (event, ctx) => {
		if (ctx.agent.kind !== "main") return;
		const patch = message => ({ ...message, content: withReminder(message.content) });
		return { messages: event.messages.map(message => (message.role === "user" ? patch(message) : message)) };
	});
}
