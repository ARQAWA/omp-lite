// Appends the owner's dyslexia rule to every user message in the request only.
// Stored history and the transcript stay clean.
export const BLOCK = `## Communication

The user has dyslexia. Short sentences: at most 8 words. Paragraphs: at most 4 sentences. Bold main ideas. Short steps, clear words. Simple Russian, address the user as «ты». Numbered lists for many items, one line each. Prefer lowercase. Avoid special typographic characters. This overrides all other communication rules.`;

export default function dyslexia(pi) {
	pi.on("context", (event, ctx) => {
		if (ctx.agent?.kind === "sub") return;
		let changed = false;
		const messages = event.messages.map(message => {
			if (message.role !== "user") return message;
			const content = message.content;
			if (typeof content === "string") {
				if (content.endsWith(BLOCK)) return message;
				changed = true;
				return { ...message, content: `${content}\n\n${BLOCK}` };
			}
			if (!Array.isArray(content) || content.length === 0) return message;
			const last = content[content.length - 1];
			if (last?.type === "text") {
				if (last.text.endsWith(BLOCK)) return message;
				changed = true;
				return { ...message, content: [...content.slice(0, -1), { ...last, text: `${last.text}\n\n${BLOCK}` }] };
			}
			changed = true;
			return { ...message, content: [...content, { type: "text", text: BLOCK }] };
		});
		return changed ? { messages } : undefined;
	});
}
