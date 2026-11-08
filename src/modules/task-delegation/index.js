// Adds the Codex delegation gate to the task tool description at request time.
export const RULE =
	"Do not spawn sub-agents unless the user or applicable AGENTS.md/skill instructions explicitly ask for sub-agents, delegation, or parallel agent work.";

const patch = record => {
	if (record.name !== "task" || typeof record.description !== "string") return false;
	if (record.description.includes(RULE)) return false;
	const breakAt = record.description.indexOf("\n");
	const head = breakAt < 0 ? record.description : record.description.slice(0, breakAt);
	const tail = breakAt < 0 ? "" : record.description.slice(breakAt);
	record.description = `${head}\n${RULE}${tail}`;
	return true;
};

export default function taskDelegation(pi) {
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
