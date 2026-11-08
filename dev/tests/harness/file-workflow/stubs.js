// The native pieces the tools call, faked for the tests: the search engine, block boundaries, the edit prompt and the
// settings registry. A test steers them through `native` and reads the overrides from `registry`.
import { mock } from "bun:test";

export const native = {
	bounds: () => [],
	grep: async () => ({ matches: [] }),
	glob: async () => ({ matches: [] }),
};

const natives = {
	enclosingBlockBoundaries: (...args) => native.bounds(...args),
	grep: (...args) => native.grep(...args),
	glob: (...args) => native.glob(...args),
	FileType: { File: "file" },
	GrepOutputMode: { Content: "content", FilesWithMatches: "files_with_matches", Count: "count" },
	editDescription: (mode) => `edit description ${mode}`,
	editGrammar: (mode) => `edit grammar ${mode}`,
};
mock.module("@oh-my-pi/pi-natives", () => natives);

export const registry = [];
mock.module("@oh-my-pi/pi-coding-agent/config/registry", () => ({
	lookup: (name) => ({ override: (settings, value) => registry.push([name, value]) }),
}));
