// Rewrites a leading /skill-name into the native /skill:name form.
export default function skillAlias(pi) {
	pi.on("input", event => {
		const text = (event.text ?? "").trim();
		const match = /^\/([a-z0-9][a-z0-9_-]*)(?:\s+([\s\S]*))?$/.exec(text);
		if (!match) return;
		const [, name, rest] = match;
		const commands = pi.getCommands();
		if (!commands.some(command => command.name === `skill:${name}`)) return;
		if (commands.some(command => command.name === name)) return;
		return { text: `/skill:${name}${rest === undefined ? "" : ` ${rest}`}` };
	});
}
