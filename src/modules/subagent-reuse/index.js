// A `[task <id>#<n>]` IRC message from Main starts a new task in a reused subagent,
// so everything before it is hidden from the model. Only the request is cut;
// the session file and the in-memory session stay untouched.
export const MARKER = /^\[task [^\]\s]+#\d+\]/;

export function reused(messages) {
	for (let i = messages.length - 1; i >= 0; i--) {
		const message = messages[i];
		if (message?.role !== "custom" || message.customType !== "irc:incoming") continue;
		const details = message.details;
		if (details?.fromParent !== true || typeof details.message !== "string") continue;
		if (!MARKER.test(details.message)) continue;
		return messages.slice(i);
	}
	return undefined;
}

export default function subagentReuse(pi) {
	pi.on("context", (event, ctx) => {
		if (ctx.agent?.kind !== "sub") return undefined;
		const messages = reused(event.messages);
		return messages ? { messages } : undefined;
	});
}
