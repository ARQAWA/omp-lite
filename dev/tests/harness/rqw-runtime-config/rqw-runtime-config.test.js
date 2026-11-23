import { expect, test } from "bun:test";

const config = Bun.YAML.parse(await Bun.file(new URL("../../../../src/modules/rqw-runtime-config/config.yml", import.meta.url)).text());

test("compaction starts at 400k for 22 models with windows above 500k", () => {
	expect(Object.values(config.compaction.modelThresholds)).toEqual(Array(22).fill("f400000"));
	expect(config.providers.cacheWarmingStrategy).toBe("keepalive");
});

test("streamed text and tool arguments appear without artificial pacing", () => {
	expect(config.display.smoothStreaming).toBe(false);
});

test("the removed scrollback setting stays absent", () => {
	expect(config.tui).not.toHaveProperty("completeScrollback");
});

test("no default model, the same models are enabled and named per spawn", () => {
	expect(config.modelRoles).not.toHaveProperty("default");
	expect(config.modelRoles.perCall.split(", ")).toEqual(config.enabledModels);
	expect(config.enabledModels[0]).toBe("anthropic/claude-sonnet-5-5");
	expect(config.enabledModels).toHaveLength(14);
	for (const name of ["anthropic", "openai-codex", "opencode-go", "openrouter", "zai", "agy"]) expect(config.disabledProviders).not.toContain(name);
	expect(config.disabledProviders).toContain("kiro");
	expect(config.disabledProviders).not.toContain("google-gemini-cli");
	for (const name of ["claude", "claude-md", "claude-plugins"]) expect(config.disabledProviders).toContain(name);
});

test("Z.ai uses only the two requested Coding Plan models", () => {
	const ids = ["zai/glm-5.3", "zai/glm-5.3-flash"];
	expect(config.enabledModels.filter(id => /^zai(-api)?\//.test(id))).toEqual(ids);
	expect(config.disabledProviders).toContain("zai-api");
	for (const id of ids) expect(config.compaction.modelThresholds[id]).toBe("f400000");
});

test("AGY models are the three base ids with the 400k compaction threshold", () => {
	const ids = config.enabledModels.filter(id => id.startsWith("agy/"));
	expect(ids).toEqual(["agy/gemini-4-neon", "agy/gemini-4-hydrogen", "agy/gemini-4-argon"]);
	expect(ids.every(id => config.compaction.modelThresholds[id] === "f400000")).toBe(true);
});

test("AGY Hydrogen falls back to AGY Neon, no role-wide chain", () => {
	expect(config.retry.fallbackChains["agy/gemini-4-hydrogen"]).toEqual(["agy/gemini-4-neon"]);
	expect(config.retry.fallbackChains.default).toBeUndefined();
});
