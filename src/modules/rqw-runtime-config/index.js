import blockedModels from "./blocked-models.json";

const providers = new Set(["anthropic", "openai-codex", "zai", "opencode-go", "openrouter"]);
const blocked = new Set(blockedModels);
const sonnet = "anthropic/claude-sonnet-5-5";
const deepseek = "openrouter/deepseek/deepseek-v4.1-flash-1017";

export default async function runtimeConfig(pi, modules) {
	const [{ cfgEnabledModels }, { cfgCompactionModelThresholds }, { cfgTaskPerCallModelAllow }] = modules ?? await Promise.all([
		import("@oh-my-pi/pi-coding-agent/config/model-settings"),
		import("@oh-my-pi/pi-coding-agent/session/context-settings"),
		import("@oh-my-pi/pi-coding-agent/task/settings"),
	]);
	let unsubscribe;
	pi.on("session_start", (_event, ctx) => {
		if (ctx.agent.kind !== "main") return;
		const scope = pi.pi.settings;
		const allow = layer => layer.task?.perCallModelAllow;
		let runtimeAllow, applied, previous;
		const registry = ctx.modelRegistry;
		const update = () => {
			const entries = new Map();
			for (const model of registry.getAvailableForProviders(providers)) {
				const id = `${model.provider}/${model.id}`;
				if (/[,\s*?]/.test(id) || blocked.has(id) || (model.provider === "openrouter" && id !== deepseek)) continue;
				entries.set(id, model.contextWindow);
			}
			const ids = [...entries.keys()].sort((a, b) => a === sonnet ? -1 : b === sonnet ? 1 : a.localeCompare(b));
			const thresholds = Object.fromEntries(ids.filter(id => entries.get(id) > 500000).map(id => [id, "f400000"]));
			const { global, project, configOverlay, overrides } = scope.mirrorState();
			const current = allow(overrides);
			if (!Bun.deepEquals(current, applied)) runtimeAllow = current;
			const operator = allow(configOverlay) ?? allow(global);
			const live = allow(configOverlay) ?? allow(project) ?? operator;
			const perCall = ids.filter(id => [operator, live, runtimeAllow].every(list => !list?.length || list.some(entry => entry.trim() === id)));
			applied = perCall.length ? perCall : ["rqw/no-model"];
			if (Bun.deepEquals(previous, [ids, thresholds]) && Bun.deepEquals(current, applied)) return;
			previous = [ids, thresholds];
			// Empty arrays mean unrestricted in OMP.
			cfgEnabledModels.override(scope, ids.length ? ids : ["rqw/no-model"]);
			cfgTaskPerCallModelAllow.override(scope, applied);
			scope.overrideModelRoles({ perCall: (ids.length ? ids : ["rqw/no-model"]).join(", ") });
			cfgCompactionModelThresholds.override(scope, thresholds);
		};
		unsubscribe?.();
		const catalog = registry.subscribeMirror(update);
		const stopSettings = scope.onLayersChange(() => queueMicrotask(update));
		unsubscribe = () => { catalog.unsubscribe(); stopSettings(); };
		update();
	});
	pi.on("session_shutdown", () => unsubscribe?.());
}
