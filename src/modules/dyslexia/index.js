// Appends the owner's dyslexia communication rule to every submitted main-session message.
export const BLOCK = `## Communication

The user has dyslexia. Always respond with short sentences, at most 7 words per sentence. Avoid long paragraphs, at most 4 sentences per paragraph. Bold the main ideas. Write in short steps, using clear words. Respond in simple Russian, addressing the user as «ты». Do not use complex words or long sentences. If there is a lot of information, format it as a numbered list. Use one line per item. Try to use lowercase letters and avoid capital letters. Use as few typographic special characters as possible.

This rule overrides every other rule about communication: message form, length and style.`;

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
