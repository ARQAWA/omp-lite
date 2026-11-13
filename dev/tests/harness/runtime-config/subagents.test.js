import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const config = Bun.YAML.parse(readFileSync(join(import.meta.dir, "../../../../src/modules/runtime-config/config.yml"), "utf8"));

test("any model can be named per spawn; the level rides in the model string", () => {
	expect(config.task.perCallModel).toBe("on");
	expect(config.task.enableEffort).toBe(false);
	expect(config.modelRoles.sonnet).toBeUndefined();
});

test("one chat role grants every enabled chat model by exact id", () => {
	const ids = config.modelRoles.perCall.split(", ");
	expect(new Set(ids).size).toBe(ids.length);
	const providers = [...new Set(config.enabledModels.map(pattern => pattern.split("/")[0]))];
	for (const id of ids) {
		expect(id).toMatch(/^[^/\s,*?]+\/[^\s,*?]+$/);
		expect(providers).toContain(id.split("/")[0]);
	}
	for (const provider of providers) expect(ids.some(id => id.startsWith(`${provider}/`))).toBe(true);
	expect(ids).toContain("anthropic/claude-sonnet-5-5");
});

test("scout and sonic run on Terra and the reviewers are disabled", () => {
	expect(config.task.agentModelOverrides).toEqual({
		scout: "openai-codex/gpt-6.1-terra:xhigh",
		sonic: "openai-codex/gpt-6.1-terra:medium",
	});
	expect(config.task.disabledAgents).toEqual(["reviewer", "security-reviewer"]);
});
