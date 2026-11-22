import { expect, test } from "bun:test";

const config = Bun.YAML.parse(await Bun.file(new URL("../../../../src/modules/rqw-runtime-config/config.yml", import.meta.url)).text());

test("compaction starts at 400k for 20 models", () => {
	expect(Object.values(config.compaction.modelThresholds)).toEqual(Array(20).fill("f400000"));
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
	expect(config.enabledModels).toHaveLength(12);
	for (const name of ["anthropic", "openai-codex", "opencode-go", "openrouter", "zai"]) expect(config.disabledProviders).not.toContain(name);
	expect(config.disabledProviders).toContain("kiro");
	expect(config.disabledProviders).not.toContain("google-gemini-cli");
	for (const name of ["claude", "claude-md", "claude-plugins"]) expect(config.disabledProviders).toContain(name);
});

test("only the three requested GLMs are enabled; FlashX uses the metered API", async () => {
	const ids = ["zai/glm-5.3", "zai/glm-5.3-flash", "zai/glm-5.3-flashx"];
	expect(config.enabledModels.filter(id => id.startsWith("zai/"))).toEqual(ids);
	for (const id of ids) expect(config.compaction.modelThresholds[id]).toBe("f400000");
	const { providers: { zai } } = Bun.YAML.parse(await Bun.file(new URL("../../../../src/modules/rqw-runtime-config/zai-models.yml", import.meta.url)).text());
	expect(zai).toEqual({
		auth: "oauth", api: "openai-completions", baseUrl: "https://api.z.ai/api/coding/paas/v4",
		models: [{ id: "glm-5.3-flash" }, { id: "glm-5.3-flashx", baseUrl: "https://api.z.ai/api/paas/v4" }],
	});
});
