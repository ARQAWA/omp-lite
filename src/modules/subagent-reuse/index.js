// Gives an existing subagent a new independent task on a fresh session.
// The agent keeps its system prompt, tools and model; its conversation starts at zero.
const busy = new Set();

function pick(registry, name) {
	const ref = registry
		.list()
		.find(item => item.kind === "sub" && (item.id === name || item.displayName === name));
	if (!ref) throw new Error(`Unknown subagent "${name}". Spawn it once with task first.`);
	if (busy.has(ref.id)) throw new Error(`Subagent "${ref.id}" is already being reused.`);
	if (ref.status === "running") throw new Error(`Subagent "${ref.id}" is running. Wait for it, or steer it with write.`);
	if (ref.status === "aborted") throw new Error(`Subagent "${ref.id}" is aborted and cannot be reused.`);
	return ref;
}

function yielded(messages) {
	for (let i = messages.length - 1; i >= 0; i--) {
		const message = messages[i];
		if (message?.role !== "toolResult" || message.toolName !== "yield" || message.isError) continue;
		const details = message.details;
		if (details?.status !== "success" || details.data === undefined) continue;
		const data = details.data;
		if (typeof data === "string") return data;
		try {
			return JSON.stringify(data, null, 2) ?? String(data);
		} catch {
			return String(data);
		}
	}
	return undefined;
}

async function runReuse({ name, task }, { registry, lifecycle }) {
	const ref = pick(registry, name);
	busy.add(ref.id);
	try {
		const session = await lifecycle.ensureLive(ref.id);
		registry.setStatus(ref.id, "running", ref);
		if (await session.newSession() === false) throw new Error(`Subagent "${ref.id}" did not start a new session.`);
		registry.attachSession(ref.id, session, session.sessionManager?.getSessionFile?.(), ref);
		await session.prompt(task);
		await session.waitForIdle();
		const last = session.getLastAssistantMessage();
		if (last?.stopReason === "aborted") throw new Error(`Subagent "${ref.id}" was aborted.`);
		if (last?.stopReason === "error") throw new Error(`Subagent "${ref.id}" failed.`);
		const output = yielded(session.messages);
		if (output !== undefined) return output;
		return session.getLastAssistantText()?.trim() || "(the subagent returned no text)";
	} finally {
		busy.delete(ref.id);
		registry.setStatus(ref.id, "idle", ref);
	}
}

async function defaults() {
	const [{ AgentRegistry }, { AgentLifecycleManager }] = await Promise.all([
		import("@oh-my-pi/pi-coding-agent/registry/agent-registry"),
		import("@oh-my-pi/pi-coding-agent/registry/agent-lifecycle"),
	]);
	return { registry: AgentRegistry.global(), lifecycle: AgentLifecycleManager.global() };
}

export default function subagentReuse(pi, deps) {
	const z = pi.zod;
	pi.registerTool({
		name: "reuse",
		label: "reuse",
		loadMode: "essential",
		concurrency: "shared",
		description:
			"Give a new independent task to an existing subagent. Before the task its conversation is reset to zero on a fresh session; its system prompt, tools and model stay. Create the subagent once with task, then call reuse for every later independent task instead of spawning a new one. Do not use it to steer a running subagent; use write for that.",
		parameters: z.object({
			name: z.string().describe("Existing subagent id or display name."),
			task: z.string().describe("Complete, self-contained new task."),
		}),
		async execute(_id, params) {
			try {
				const resolved = deps ?? (await defaults());
				const text = await runReuse(params, resolved);
				return { content: [{ type: "text", text }] };
			} catch (error) {
				return { content: [{ type: "text", text: error instanceof Error ? error.message : String(error) }], isError: true };
			}
		},
	});
}
