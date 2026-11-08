import { lookup } from "@oh-my-pi/pi-coding-agent/config/registry";
import { editDescription, editGrammar } from "@oh-my-pi/pi-natives";
import { toolText } from "../../shared/tool-text.js";
import { chooseEditMode, cleanParams, replaceItems } from "./args.js";
import description from "./description.md" with { type: "text" };
import { parsePatch, patchResult, runPatch } from "./patch.js";
import { replaceResult, runReplaceItems } from "./replace.js";

// Replace mode (description.md) for every model except GPT, which gets omp's apply_patch text and grammar.
const REPLACE_DESCRIPTION = description.trim();

export default function edit(pi) {
	const z = pi.zod;
	let gpt = false;
	const sync = (ctx) => {
		gpt = chooseEditMode(ctx?.models?.current?.() ?? ctx?.model) === "apply_patch";
	};

	const replaceParameters = z.object({
		path: z.string().optional(),
		old_string: z.string().optional(),
		new_string: z.string().optional(),
		replace_all: z.boolean().optional(),
		edits: z.array(z.object({ path: z.string(), old_string: z.string(), new_string: z.string(), replace_all: z.boolean().optional() })).optional(),
	});
	// The freeform patch mode has no fields, so its parameters are a single patch string.
	const patchParameters = z.object({ input: z.string() });

	pi.on("session_start", (_event, ctx) => {
		sync(ctx);
		try {
			lookup("edit.mode")?.override(pi.pi.settings, "replace");
			lookup("edit.modelVariants")?.override(pi.pi.settings, { gpt: "apply_patch" });
		} catch {}
	});
	pi.on("before_agent_start", (_event, ctx) => sync(ctx));
	pi.on("turn_start", (_event, ctx) => sync(ctx));

	pi.registerTool({
		name: "edit",
		label: "edit",
		loadMode: "essential",
		approval: "write",
		get description() {
			return gpt ? editDescription("apply_patch") : REPLACE_DESCRIPTION;
		},
		get parameters() {
			return gpt ? patchParameters : replaceParameters;
		},
		get customFormat() {
			return gpt ? { syntax: "lark", definition: editGrammar("apply_patch") } : undefined;
		},
		get customWireName() {
			return gpt ? "apply_patch" : undefined;
		},
		// Both modes lock each file they change and refuse a busy one, so edits of different files run in parallel.
		concurrency: "shared",
		async execute(_toolCallId, rawParams, signal, onUpdate, ctx) {
			const params = cleanParams(rawParams);
			if (!ctx.invokeTool) return toolText("edit is not available to this agent.", true);
			const invoke = (args) => ctx.invokeTool(args, { signal, onUpdate });
			if (typeof params.input === "string") {
				const sections = parsePatch(params.input);
				if (!sections) return invoke({ input: params.input });
				return patchResult(await runPatch(sections, invoke, ctx.cwd));
			}
			const selected = replaceItems(params);
			if (selected.error !== undefined) return toolText(selected.error, true);
			return replaceResult(await runReplaceItems(selected.items, invoke, ctx.cwd), selected.single);
		},
	});
}
