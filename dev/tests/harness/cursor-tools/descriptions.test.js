import { expect, test } from "bun:test";
import { BASH_DESCRIPTION, GREP_DESCRIPTION, install } from "../../../../src/modules/cursor-tools/index.js";
import texts from "../../../../src/modules/cursor-tools/descriptions.json";

const EXPECTED_GREP = `Search the workspace with ripgrep.

- Use this tool instead of shell rg; respects .gitignore
- Default scope is the workspace root; set path (absolute path) to narrow it
- Supply a regex pattern; escape metacharacters, e.g. "functionCall\\(", "\\{", "\\}"
- Prefer type over broad glob; wildcard globs like * bypass ignore rules and slow searches
- Enable multiline only when a match spans lines—it can degrade performance
- Context flags (-A, -B, -C) only affect content output
- If results show "N+ of M matches shown", the output was truncated; tighten the query or raise head_limit`;

test("grep carries the captured Cursor text under our names", () => {
	expect(GREP_DESCRIPTION).toBe(EXPECTED_GREP);
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

test("grep parameters carry their Cursor description on their own field", () => {
	const tools = [];
	const leaf = () => {
		const node = { optional: () => node, describe: text => ((node.text = text), node) };
		return node;
	};
	const pi = {
		zod: {
			string: leaf,
			number: leaf,
			boolean: leaf,
			object: shape => {
				const node = leaf();
				node.shape = shape;
				return node;
			},
		},
		registerTool: tool => tools.push(tool),
		on: () => {},
	};
	install(pi);
	const grep = tools.find(tool => tool.name === "grep");
	for (const [field, text] of Object.entries(texts.grepParameters)) expect(grep.parameters.shape[field].text).toBe(text);
	expect(grep.parameters.shape.case.text).toBeUndefined();
	expect(grep.parameters.shape.gitignore.text).toBeUndefined();
	expect(grep.parameters.shape.skip.text).toBeUndefined();
});
