import { expect, test } from "bun:test";

const config = Bun.YAML.parse(await Bun.file(new URL("../../../../src/modules/rqw-runtime-config/config.yml", import.meta.url)).text());

test("compaction starts at 400k for 18 models", () => {
	expect(Object.values(config.compaction.modelThresholds)).toEqual(Array(18).fill("f400000"));
});

test("the same ten models are enabled and named per spawn, the default chain uses them, five providers stay open", () => {
	expect(config.modelRoles.perCall.split(", ")).toEqual(config.enabledModels);
	expect(config.enabledModels).toHaveLength(10);
	for (const item of config.modelRoles.default.split(", ")) expect(config.enabledModels).toContain(item.replace(/:\w+$/, ""));
	for (const name of ["anthropic", "openai-codex", "opencode-go", "openrouter", "antigravity-cli"]) expect(config.disabledProviders).not.toContain(name);
});
