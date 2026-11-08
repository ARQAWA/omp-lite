// The six tools: each keeps a native tool's name and hands its call to the native tool of that name.
import read from "./tools/read/index.js";
import grep from "./tools/grep/index.js";
import glob from "./tools/glob/index.js";
import bash from "./tools/bash/index.js";
import write from "./tools/write/index.js";
import edit from "./tools/edit/index.js";

export const TOOLS = ["read", "grep", "glob", "bash", "edit", "write"];

/** Adds whichever of the six names is not active; every other tool keeps its state. */
export async function ensureTools(pi) {
	if (typeof pi.getActiveTools !== "function") return;
	const active = await pi.getActiveTools();
	const missing = TOOLS.filter((name) => !active.includes(name));
	if (missing.length > 0) await pi.setActiveTools([...active, ...missing]);
}

export default function fileWorkflow(pi) {
	read(pi);
	grep(pi);
	glob(pi);
	bash(pi);
	write(pi);
	edit(pi);
	pi.on("session_start", () => ensureTools(pi));
}
