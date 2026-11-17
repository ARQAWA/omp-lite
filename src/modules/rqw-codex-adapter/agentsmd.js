// OMP 18.22.1 drops AGENTS.md from task subagents with one filter by file name. This patch keeps the files.
import { isMainThread } from "node:worker_threads";

const { filter } = Array.prototype;
if (!filter.keepsAgentsMd) {
	// Only OMP's withoutAgentsMd() matches: a list of context files and a callback that names "agents.md".
	Array.prototype.filter = function (test) {
		const file = this[0];
		const byName = typeof file?.path === "string" && typeof file.content === "string" && `${test}`.includes('"agents.md"');
		return filter.apply(this, byName ? [() => true] : arguments);
	};
	Array.prototype.filter.keepsAgentsMd = true;
	// A subagent worker thread filters before it loads extensions, so every new worker preloads this file.
	if (isMainThread) {
		globalThis.Worker = class extends Worker {
			constructor(url, options) {
				super(url, { ...options, preload: [import.meta.path] });
			}
		};
	}
}
