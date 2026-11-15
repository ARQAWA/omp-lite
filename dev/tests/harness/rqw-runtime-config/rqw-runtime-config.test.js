import { expect, test } from "bun:test";

const config = Bun.YAML.parse(await Bun.file(new URL("../../../../src/modules/rqw-runtime-config/config.yml", import.meta.url)).text());

test("compaction starts at 400k for 18 models", () => {
	expect(Object.values(config.compaction.modelThresholds)).toEqual(Array(18).fill("f400000"));
});

test("every enabled model can be named per spawn and the four providers stay open", () => {
	const perCall = config.modelRoles.perCall.split(", ");
	for (const id of config.enabledModels) expect(perCall).toContain(id);
	for (const name of ["anthropic", "openai-codex", "opencode-go", "openrouter"]) expect(config.disabledProviders).not.toContain(name);
});
