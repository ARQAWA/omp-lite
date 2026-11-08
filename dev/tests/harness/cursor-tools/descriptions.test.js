import { expect, test } from "bun:test";
import { BASH_DESCRIPTION, GREP_DESCRIPTION } from "../../../../src/modules/cursor-tools/index.js";

test("grep keeps the Cursor guidance under our names", () => {
	expect(GREP_DESCRIPTION).toContain("Search the workspace with ripgrep.");
	expect(GREP_DESCRIPTION).toContain("respects .gitignore");
	expect(GREP_DESCRIPTION).not.toContain(".cursorignore");
	expect(GREP_DESCRIPTION).not.toContain("Use rg");
	expect(GREP_DESCRIPTION).toContain("escape metacharacters");
	expect(GREP_DESCRIPTION).toContain("set path (absolute path) to narrow it");
	expect(GREP_DESCRIPTION).toContain("Context flags (-A, -B, -C) only affect content output");
	expect(GREP_DESCRIPTION).toContain('If results show "N+ of M matches shown"');
});

const EXPECTED_BASH = `Executes a given command in a shell session with optional foreground timeout.

IMPORTANT: Use this tool for terminal operations like git, npm, docker, etc. DO NOT use it for file operations (reading, writing, editing, searching, finding files, sleeping) - use the specialized tools for this instead.

- Use grep, glob and read for file operations when applicable. If shell text search is necessary, use the \`grep\` tool, not shell \`grep\` or \`find\`.
- Do not truncate output with \`head\`, \`tail\`, or \`sed -n\` solely to limit its size.
- Run independent commands as parallel bash calls. Chain dependent commands with \`&&\`.
- Use the \`gh\` command via the bash tool for all GitHub-related tasks, including issues, pull requests, checks, and releases.`;

test("bash carries the captured Cursor text under our names", () => {
	expect(BASH_DESCRIPTION).toBe(EXPECTED_BASH);
});
