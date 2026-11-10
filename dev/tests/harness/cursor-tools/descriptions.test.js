import { expect, test } from "bun:test";
import { BASH_DESCRIPTION, GREP_DESCRIPTION, install } from "../../../../src/modules/cursor-tools/index.js";

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

test("bash puts dedicated file tools first while keeping the captured Cursor text", () => {
	const priority = "Use read, grep and glob for project files and directory listings. Do not attempt cat, head, tail, sed -n, grep, rg, find, ls or tree through bash.";
	expect(BASH_DESCRIPTION).toBe(`${priority}\n\n${EXPECTED_BASH}`);
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
	const expected = {
		pattern: "The regular expression pattern to search for in file contents",
		path: "File or directory to search in. Defaults to the workspace root.",
		glob: 'Glob pattern to filter files (e.g. "*.js", "*.{ts,tsx}")',
		type: "File type to search. Common types: js, py, rust, go, java, etc. More efficient than include for standard file types.",
		output_mode:
			'Output mode: "content" shows matching lines (supports -A/-B/-C context, head_limit), "files_with_matches" shows file paths (supports head_limit), "count" shows match counts (supports head_limit). Defaults to "content".',
		"-A": 'Number of lines to show after each match. Requires output_mode: "content", ignored otherwise.',
		"-B": 'Number of lines to show before each match. Requires output_mode: "content", ignored otherwise.',
		"-C": 'Number of lines to show before and after each match. Requires output_mode: "content", ignored otherwise.',
		"-i": "Case insensitive search. Defaults to false",
		multiline: "Enable multiline mode where . matches newlines and patterns can span lines. Default: false.",
		head_limit:
			'Limit output size. For "content" mode: limits total matches shown. For "files_with_matches" and "count" modes: limits number of files.',
		offset:
			'Skip first N entries. For "content" mode: skips first N matches. For "files_with_matches" and "count" modes: skips first N files. Use with head_limit for pagination.',
	};
	for (const [field, text] of Object.entries(expected)) expect(grep.parameters.shape[field].text).toBe(text);
	expect(Object.keys(grep.parameters.shape).filter(field => grep.parameters.shape[field].text !== undefined)).toEqual(Object.keys(expected));
	expect(grep.parameters.shape.gitignore.text).toBeUndefined();
	const bash = tools.find(tool => tool.name === "bash").parameters.shape;
	expect(bash.command.text).toBe("The command to execute");
	expect(bash.working_directory.text).toBe("The absolute path to the working directory to execute the command in (defaults to current directory)");
	expect(bash.block_until_ms.text).toBe("Set to 0 to immediately run the command in the background.");
	expect(bash.timeout.text).toBeUndefined();
});
