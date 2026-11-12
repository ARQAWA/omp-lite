// Runtime patch for OMP 18.18.8: task subagents keep the AGENTS.md files that OMP filters out by name.
import { isMainThread } from "node:worker_threads";

if (!globalThis.ompKeepsAgentsMd) {
	globalThis.ompKeepsAgentsMd = true;
	const filter = Array.prototype.filter;
	// Matches only OMP's withoutAgentsMd(): contextFiles.filter(file => path.basename(file.path).toLowerCase() !== "agents.md").
	Array.prototype.filter = function (test, ...rest) {
		const first = this[0];
		const isNameFilter = typeof first?.path === "string" && typeof first.content === "string" && String(test).includes('"agents.md"');
		return isNameFilter ? this.slice() : filter.call(this, test, ...rest);
	};
	// A subagent worker thread filters before it loads extensions: preload this file there.
	if (isMainThread) {
		const Native = globalThis.Worker;
		globalThis.Worker = class extends Native {
			constructor(url, options) {
				super(url, { ...options, preload: [import.meta.path] });
			}
		};
	}
}

export default function childAgentsMd() {}
