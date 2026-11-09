// Keeps delegation opt-in and makes Bun the default eval runtime.
import texts from "./task-delegation.json";

export const RULE = texts.rule;
const toolName = name => (typeof name === "string" ? name.replace(/^_/, "") : "");

const patch = record => {
	const name = toolName(record.name);
	if ((name !== "task" && name !== "eval") || typeof record.description !== "string") return;
	let description = record.description;
	for (const fragment of name === "task" ? texts.taskRemove : texts.evalRemove) {
		description = description.replaceAll(fragment, "");
	}
	const addition = name === "task" ? RULE : `${texts.evalDefault}\n${texts.evalFiles}`;
	if (!description.includes(addition)) {
		const breakAt = description.indexOf("\n");
		const head = breakAt < 0 ? description : description.slice(0, breakAt);
		const tail = breakAt < 0 ? "" : description.slice(breakAt);
		description = `${head}\n${addition}${tail}`;
	}
	if (name === "eval") description = description.replaceAll(texts.exampleOld, texts.exampleNew);
	record.description = description;
};

export default function taskDelegation(pi) {
	pi.on("tool_call", event => {
		if (toolName(event.toolName) !== "eval" || typeof event.input?.code !== "string") return;
		// A textual guard, not a sandbox: aliases and file-loaded code remain outside it.
		if (/\b(?:agent|workpool)\s*\(/.test(event.input.code)) return { block: true, reason: texts.blocked };
	});

	pi.on("before_provider_request", event => {
		if (typeof event !== "object" || event === null || !("payload" in event)) return event;
		const seen = new WeakSet();
		const patchTools = tools => {
			for (const entry of tools) {
				if (typeof entry !== "object" || entry === null) continue;
				const fn = entry.function;
				if (typeof fn === "object" && fn !== null) patch(fn);
				else patch(entry);
			}
		};
		const walk = node => {
			if (typeof node !== "object" || node === null || seen.has(node)) return;
			seen.add(node);
			if (Array.isArray(node)) {
				for (const item of node) walk(item);
				return;
			}
			for (const [key, value] of Object.entries(node)) {
				if (key === "tools" && Array.isArray(value)) patchTools(value);
				walk(value);
			}
		};
		walk(event.payload);
		return event.payload;
	});
}
