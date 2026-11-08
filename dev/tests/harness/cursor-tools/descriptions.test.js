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

test("bash keeps the Cursor guidance under our names", () => {
	expect(BASH_DESCRIPTION).toContain("Executes a given command in a shell session");
	expect(BASH_DESCRIPTION).toContain("Use grep, glob and read for file operations");
	expect(BASH_DESCRIPTION).not.toContain("Use rg");
	expect(BASH_DESCRIPTION).not.toContain("Shell");
	expect(BASH_DESCRIPTION).toContain("Run independent commands as parallel bash calls");
	expect(BASH_DESCRIPTION).toContain("Use the gh command");
	expect(BASH_DESCRIPTION).toContain("block_until_ms: 0 starts the command in the background");
	expect(BASH_DESCRIPTION).toContain("cannot be combined with pty or a named service");
});
