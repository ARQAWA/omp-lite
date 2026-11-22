import { join } from "node:path";
import { instrumentedCompleteSimple } from "@oh-my-pi/pi-agent-core";
import { extractTextContent } from "@oh-my-pi/pi-coding-agent/commit/utils";
import { buildSecretObfuscator } from "@oh-my-pi/pi-coding-agent/secrets/index";
import { cfgSecretsEnabled } from "@oh-my-pi/pi-coding-agent/secrets/settings";
import { journalCompletion } from "@oh-my-pi/pi-coding-agent/session/model-usage-journal";
import { buildSessionContext } from "@oh-my-pi/pi-coding-agent/session/session-context";
import { formatSessionHistoryMarkdown } from "@oh-my-pi/pi-coding-agent/session/session-history-format";
import { cfgSessionMaxCost } from "@oh-my-pi/pi-coding-agent/session/settings";
import { writeFileAtomically } from "@oh-my-pi/pi-coding-agent/utils/atomic-file";
import { isKeyRelease, isKeyRepeat, matchesKey } from "@oh-my-pi/pi-tui/keys";
import { getAgentDir } from "@oh-my-pi/pi-utils/dirs";
import data from "./advisor.json";

const NAME = "consult_advisor";
const models = Object.entries(data.models).map(([ref, name]) => {
	const [provider, id] = ref.split("/");
	return { ref, provider, id, name };
});
const defaults = { model: models[0].ref, enabled: false };
const roles = new Set(["user", "assistant", "toolResult", "compactionSummary", "branchSummary"]);
const isShortcut = input => !isKeyRelease(input) && !isKeyRepeat(input) &&
	(matchesKey(input, "ctrl+shift+up") || matchesKey(input, "ctrl+shift+down"));

export default function advisor(pi) {
	const agentDir = getAgentDir();
	const file = join(agentDir, "rqw-advisor.json");
	let state = defaults;
	const syncTools = async () => {
		const active = pi.getActiveTools();
		if (active.includes(NAME) !== state.enabled) {
			await pi.setActiveTools(state.enabled ? [...active, NAME] : active.filter(name => name !== NAME));
		}
	};
	const load = async (_event, ctx) => {
		if (ctx.agent.kind !== "main") return;
		state = defaults;
		try {
			const saved = await Bun.file(file).json();
			if (typeof saved?.model === "string" && Object.hasOwn(data.models, saved.model)) {
				state = { model: saved.model, enabled: saved.enabled === true };
			}
		} catch (error) {
			if (error.code !== "ENOENT") pi.logger.warn("rqw-harness-interface: advisor preferences", { error });
		}
		await syncTools();
	};
	for (const event of ["session_start", "session_switch", "session_branch"]) pi.on(event, load);

	pi.registerTool({
		name: NAME,
		label: data.picker.title,
		description: data.description,
		parameters: pi.zod.object({ question: pi.zod.string().trim().min(1) }),
		approval: "read",
		defaultInactive: true,
		loadMode: "essential",
		async execute(_id, { question }, signal, _onUpdate, ctx) {
			if (!state.enabled || ctx.agent.kind !== "main") throw new Error(data.disabled);
			const settings = pi.pi.settings;
			// Extension contexts cannot charge the live session cost gate.
			if (cfgSessionMaxCost.get(settings) !== undefined) throw new Error(data.capped);
			const ref = state.model;
			const model = ctx.models.list().find(model => `${model.provider}/${model.id}` === ref);
			if (!model?.thinking?.efforts?.includes(data.effort)) throw new Error(data.unavailable);
			const { sessionManager, modelRegistry } = ctx;
			const apiKey = modelRegistry.resolver(model, sessionManager.getSessionId());
			const onAttempt = journalCompletion(sessionManager, { purpose: NAME, usageOnly: true });
			const { messages } = buildSessionContext(sessionManager.getBranch(), sessionManager.getLeafId());
			const visible = messages.filter(message => roles.has(message.role) && !message.excludeFromContext);
			const task = visible.findLast(message => message.role === "user");
			const recent = visible.filter(message => message !== task && message.toolName !== NAME).slice(-20);
			try {
				const mask = cfgSecretsEnabled.get(settings) ? await buildSecretObfuscator(ctx.cwd, agentDir) : undefined;
				const redact = text => mask?.obfuscate(text) ?? text;
				const history = formatSessionHistoryMarkdown(recent, {
					expandToolIO: true, expandEditDiffs: true, transformExpandedToolIO: redact,
				});
				const text = [
					`${data.question}\n${redact(question).slice(0, 2000)}`,
					task && redact(formatSessionHistoryMarkdown([task])).slice(0, 4000),
					`${data.evidence}\n${redact(history).slice(-24000)}`,
				].filter(Boolean).join("\n\n");
				const reply = await instrumentedCompleteSimple(model, {
					systemPrompt: [data.systemPrompt], messages: [{ role: "user", content: text, timestamp: Date.now() }],
				}, {
					apiKey, reasoning: data.effort, hideThinkingSummary: true, onAttempt,
					signal: AbortSignal.any([signal, AbortSignal.timeout(60000)].filter(Boolean)),
					beforeDispatch: () => { if (!state.enabled || state.model !== ref) throw new Error(data.disabled); },
				}, { oneshotKind: NAME });
				const answer = reply.stopReason !== "error" && reply.stopReason !== "aborted" && extractTextContent(reply);
				if (!answer) throw new Error(reply.errorMessage || data.unavailable);
				return { content: [{ type: "text", text: answer }] };
			} catch (error) {
				signal?.throwIfAborted();
				pi.logger.warn("rqw-harness-interface: advisor", { model: ref, error });
				throw new Error(data.unavailable);
			}
		},
	});

	return {
		models, view: data.picker, isShortcut,
		get state() { return state; },
		async save({ model, enabled }) {
			if (model.ref !== state.model || enabled !== state.enabled) {
				const next = { model: model.ref, enabled };
				await writeFileAtomically(file, `${JSON.stringify(next)}\n`);
				state = next;
			}
			await syncTools();
		},
	};
}
