import { sortedSchema } from "../../shared/data.js";
import { toolText } from "../../shared/tool-text.js";
import description from "./description.md" with { type: "text" };
import { parseWriteItems, runWriteItems, writeResult } from "./items.js";

const PARAMETERS = {
	type: "object",
	properties: {
		path: { type: "string", description: "Path of the file to write." },
		content: { type: "string", description: "The whole content of the file." },
		files: {
			type: "array",
			description: "Several files to write at once.",
			items: {
				type: "object",
				properties: { path: { type: "string" }, content: { type: "string" } },
				required: ["path", "content"],
			},
		},
	},
};

export default function write(pi) {
	pi.registerTool({
		name: "write",
		label: "write",
		loadMode: "essential",
		concurrency: "shared",
		approval: "write",
		strict: false,
		description: description.trim(),
		parameters: sortedSchema(PARAMETERS),
		async execute(_toolCallId, params, signal, onUpdate, ctx) {
			if (!ctx.invokeTool) return toolText("write is not available to this agent.", true);
			const selected = parseWriteItems(params ?? {});
			if (selected.error !== undefined) return toolText(selected.error, true);
			if (selected.native !== undefined) return ctx.invokeTool(selected.native, { signal, onUpdate });
			const invoke = (args) => ctx.invokeTool(args, { signal, onUpdate });
			return writeResult(await runWriteItems(selected.items, invoke, ctx.cwd), selected.single);
		},
	});
}
