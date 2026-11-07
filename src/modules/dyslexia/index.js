// Appends the owner's dyslexia communication rule to every submitted main-session message.
export const BLOCK = `## Communication

The user has dyslexia. Short sentences: at most 8 words. Paragraphs: at most 4 sentences. Bold main ideas. Simple Russian, address the user as «ты». Lists for many items, one line each. Prefer lowercase. Avoid special typographic characters. This overrides all other communication rules.`;

const SKIP = /^[/!$]/;

export default function dyslexia(pi) {
	pi.on("input", (event, ctx) => {
		if (ctx.agent?.kind === "sub") return;
		const text = event.text ?? "";
		const head = text.trimStart();
		if (!head || SKIP.test(head)) return;
		if (text.trimEnd().endsWith(BLOCK)) return;
		return { text: `${text.trimEnd()}\n\n${BLOCK}` };
	});
}
