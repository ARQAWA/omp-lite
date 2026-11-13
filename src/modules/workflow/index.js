// Appends the owner's workflow hint to every user message in the request only.
// Main session only: subagents never get it. History and the transcript stay clean.
import text from "./workflow.json";

export const BLOCK = text.block;

function withHint(message) {
	const content = message.content;
	if (typeof content === "string") {
		if (content.includes(BLOCK)) return message;
		return { ...message, content: `${content}\n\n${BLOCK}` };
	}
	if (!Array.isArray(content) || content.length === 0) return message;
	if (content.some(part => part?.type === "text" && part.text.includes(BLOCK))) return message;
	const last = content[content.length - 1];
	if (last?.type === "text") {
		return { ...message, content: [...content.slice(0, -1), { ...last, text: `${last.text}\n\n${BLOCK}` }] };
	}
	return { ...message, content: [...content, { type: "text", text: BLOCK }] };
}

export default function workflow(pi) {
	pi.on("context", (event, ctx) => {
		if (ctx.agent?.kind !== "main") return;
		let changed = false;
		const messages = event.messages.map(message => {
			if (message.role !== "user") return message;
			const next = withHint(message);
			if (next !== message) changed = true;
			return next;
		});
		return changed ? { messages } : undefined;
	});
}
