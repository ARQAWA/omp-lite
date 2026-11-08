import { lookup } from "@oh-my-pi/pi-coding-agent/config/registry";
import { sortedSchema } from "../../shared/data.js";
import { toolText } from "../../shared/tool-text.js";
import { chooseConcurrency, cleanBashParams, mapBashArgs } from "./args.js";
import description from "./description.md" with { type: "text" };

const PARAMETERS = {
	type: "object",
	properties: {
		command: { type: "string" },
		timeout: { type: "number", description: "seconds; omitted = no deadline" },
		block_until_ms: { type: "number", minimum: 0 },
		cwd: { type: "string" },
		pty: { type: "boolean" },
		async: { type: "boolean" },
		name: { type: "string" },
		ready: {
			type: "object",
			properties: { log: { type: "string" }, port: { type: "number" }, host: { type: "string" }, timeout: { type: "number" } },
		},
	},
	required: ["command"],
};

// The threshold is a host setting, so a call changes it before the native command starts. Two changes closer than
// 50 ms apart would restart the shell for nothing, hence the gate.
let current;
let lastStart = 0;
let gate = Promise.resolve();

function setThreshold(pi, value) {
	const step = gate.then(async () => {
		if (current !== value) {
			const wait = 50 - (Date.now() - lastStart);
			if (wait > 0) await new Promise((done) => setTimeout(done, wait));
			try {
				lookup("bash.autoBackground.thresholdMs")?.override(pi.pi.settings, value);
			} catch {}
			current = value;
		}
		lastStart = Date.now();
	});
	gate = step.then(
		() => undefined,
		() => undefined,
	);
	return step;
}

export default function bash(pi) {
	pi.registerTool({
		name: "bash",
		label: "bash",
		loadMode: "essential",
		approval: "exec",
		concurrency: (args) => chooseConcurrency(args),
		description: description.trim(),
		parameters: sortedSchema(PARAMETERS),
		async execute(_toolCallId, rawParams, signal, onUpdate, ctx) {
			if (!ctx.invokeTool) return toolText("bash is not available to this agent.", true);
			const { args, threshold } = mapBashArgs(cleanBashParams(rawParams ?? {}));
			if (threshold === undefined) return ctx.invokeTool(args, { signal, onUpdate });
			await setThreshold(pi, threshold);
			return ctx.invokeTool(args, { signal, onUpdate });
		},
	});
}
