import { expect, test } from "bun:test";
import runtimeConfig from "../../../../src/modules/rqw-runtime-config/index.js";

const config = Bun.YAML.parse(await Bun.file(new URL("../../../../src/modules/rqw-runtime-config/config.yml", import.meta.url)).text());

test("cache warming does not force compaction", () => {
	expect(config.providers.cacheWarmingStrategy).toBe("keepalive");
});

test("streamed text and tool arguments appear without artificial pacing", () => {
	expect(config.display.smoothStreaming).toBe(false);
});

test("the removed scrollback setting stays absent", () => {
	expect(config.tui).not.toHaveProperty("completeScrollback");
});

test("Sonnet is the startup preference and unrelated roles and providers stay configured", () => {
	expect(config.modelRoles).not.toHaveProperty("default");
	expect(config.enabledModels[0]).toBe("anthropic/claude-sonnet-5-5");
	for (const name of ["anthropic", "openai-codex", "opencode-go", "openrouter", "zai", "agy"]) expect(config.disabledProviders).not.toContain(name);
	expect(config.disabledProviders).toContain("kiro");
	expect(config.disabledProviders).not.toContain("google-gemini-cli");
	for (const name of ["claude", "claude-md", "claude-plugins"]) expect(config.disabledProviders).toContain(name);
	expect(config.disabledProviders).toContain("zai-api");
});

const model = (provider, id, contextWindow = 200000) => ({ provider, id, contextWindow });

async function session(models, operator = [], live = []) {
	const hooks = {};
	const layer = perCallModelAllow => ({ task: { perCallModelAllow } });
	let settingsChanged, runtime;
	const scope = {
		roles: { web: config.modelRoles.web },
		mirrorState: () => ({ global: layer(operator), project: layer(live), configOverlay: {}, overrides: layer(runtime) }),
		onLayersChange: listener => { settingsChanged = listener; return () => { settingsChanged = undefined; }; },
		overrideModelRoles: roles => Object.assign(scope.roles, roles),
	};
	const setting = key => ({ override: (scope, value) => { scope[key] = value; } });
	const modules = [
		{ cfgEnabledModels: setting("enabled") },
		{ cfgCompactionModelThresholds: setting("thresholds") },
		{ cfgTaskPerCallModelAllow: { override: (scope, value) => { scope.allow = runtime = value; } } },
	];
	let listener;
	const registry = {
		getAvailableForProviders: providers => models.filter(model => providers.has(model.provider)),
		subscribeMirror: fn => { listener = fn; return { unsubscribe: () => { listener = undefined; } }; },
	};
	await runtimeConfig({ on: (name, fn) => { hooks[name] = fn; }, pi: { settings: scope } }, modules);
	hooks.session_start({}, { agent: { kind: "main" }, modelRegistry: registry });
	return { scope, discover: () => listener(), shutdown: () => { hooks.session_shutdown(); return listener; },
		restrict: async (ids, overridden = false) => {
			if (overridden) scope.allow = runtime = ids;
			else live = ids;
			settingsChanged();
		} };
}

test("the live catalog updates both model lists and compaction thresholds", async () => {
	const sonnet = "anthropic/claude-sonnet-5-5", deepseek = "openrouter/deepseek/deepseek-v4.1-flash-1017";
	const models = [
		model("zai", "glm-5.3", 500000), model("openrouter", "deepseek/deepseek-v4.1-flash-1017"),
		model("anthropic", "claude-sonnet-5-5"), model("anthropic", "claude-sonnet-4-6", 900000),
		model("zai", "glm-5.3-flashx-legal", 900000), model("openrouter", "z-ai/glm-5.3-flashx-legal", 900000),
		model("zai-api", "glm-5.4", 900000),
	];
	const { scope, discover, shutdown } = await session(models);
	expect(scope.enabled).toEqual([sonnet, deepseek, "zai/glm-5.3"]);
	expect(scope.roles.perCall.split(", ")).toEqual(scope.enabled);
	expect(scope.allow).toEqual(scope.enabled);
	expect(scope.thresholds).toEqual({});
	models.push(model("zai", "glm-5.4", 500001), model("openai-codex", "gpt-6.3", 500000), model("openrouter", "deepseek/deepseek-v4.2-flash", 900000));
	discover();
	expect(scope.enabled).toEqual([sonnet, "openai-codex/gpt-6.3", deepseek, "zai/glm-5.3", "zai/glm-5.4"]);
	expect(scope.roles.perCall.split(", ")).toEqual(scope.enabled);
	expect(scope.allow).toEqual(scope.enabled);
	expect(scope.thresholds).toEqual({ "zai/glm-5.4": "f400000" });
	expect(scope.roles.web).toBe(config.modelRoles.web);
	expect(shutdown()).toBeUndefined();
});

test("operator and project per-call allowlists both narrow the catalog", async () => {
	const models = [model("anthropic", "claude-sonnet-5-5"), model("zai", "glm-5.3"), model("zai", "glm-5.4")];
	const { scope, restrict } = await session(models, ["anthropic/claude-sonnet-5-5", " zai/glm-5.3 "], ["zai/glm-5.3 ", "zai/glm-5.4"]);
	expect(scope.allow).toEqual(["zai/glm-5.3"]);
	await restrict(["zai/glm-5.4"]);
	expect(scope.allow).toEqual(["rqw/no-model"]);
	await restrict(["zai/glm-5.4"], true);
	expect(scope.allow).toEqual(["rqw/no-model"]);
});
