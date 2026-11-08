import { classifyRipgrepMessage, searchWorkspace } from "../../shared/search/engine.js";
import { GLOB_CHAR_BUDGET } from "../../shared/search/format.js";
import { sortedSchema } from "../../shared/data.js";
import { toolText, truncateOutput } from "../../shared/tool-text.js";
import description from "./description.md" with { type: "text" };
import { buildGlobRequest, formatGlob, mapToGlob, parseGlobArgs } from "./glob.js";

const PARAMETERS = {
	type: "object",
	properties: {
		glob_pattern: {
			type: "string",
			description:
				'The glob pattern to match files against.\nPatterns not starting with "**/" are automatically prepended with "**/" to enable recursive searching.\n\nExamples:\n\t- "*.js" (becomes "**/*.js") - find all .js files\n\t- "**/node_modules/**" - find all node_modules directories\n\t- "**/test/**/test_*.ts" - find all test_*.ts files in any test directory',
		},
		target_directory: {
			type: "string",
			description: "Absolute path to directory to search for files in. If not provided, defaults to the workspace root.",
		},
	},
	required: ["glob_pattern"],
};

export default function glob(pi) {
	pi.registerTool({
		name: "glob",
		label: "glob",
		loadMode: "essential",
		concurrency: "shared",
		strict: false,
		description: description.trim(),
		parameters: sortedSchema(PARAMETERS),
		execute: (_toolCallId, params, signal, _onUpdate, ctx) => executeGlob(params, signal, ctx),
	});
}

async function executeGlob(params, signal, ctx) {
	const parsed = parseGlobArgs(params);
	if ("error" in parsed) return toolText(truncateOutput(parsed.error, GLOB_CHAR_BUDGET), true);
	try {
		const success = await searchWorkspace(buildGlobRequest(parsed.args), ctx.cwd, signal);
		const result = mapToGlob(success);
		if (result === undefined) return toolText("glob_file_search didn't return the result");
		return toolText(formatGlob(result, result.path || "."));
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		return toolText(truncateOutput(classifyRipgrepMessage(message), GLOB_CHAR_BUDGET), true);
	}
}
