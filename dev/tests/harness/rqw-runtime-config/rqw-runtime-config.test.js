import { expect, test } from "bun:test";

const config = Bun.YAML.parse(await Bun.file(new URL("../../../../src/modules/rqw-runtime-config/config.yml", import.meta.url)).text());

test("compaction starts at 400k for 17 models", () => {
	expect(Object.values(config.compaction.modelThresholds)).toEqual(Array(17).fill("f400000"));
});

test("streamed text and tool arguments appear without artificial pacing", () => {
	expect(config.display.smoothStreaming).toBe(false);
});

test("the same nine models are enabled and named per spawn, the default chain uses them, four providers stay open", () => {
	expect(config.modelRoles.perCall.split(", ")).toEqual(config.enabledModels);
	expect(config.enabledModels).toHaveLength(9);
	for (const item of config.modelRoles.default.split(", ")) expect(config.enabledModels).toContain(item.replace(/:\w+$/, ""));
	for (const name of ["anthropic", "openai-codex", "opencode-go", "openrouter"]) expect(config.disabledProviders).not.toContain(name);
	expect(config.disabledProviders).toContain("kiro");
});
