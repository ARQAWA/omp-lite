import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dir, "../../../..");
const yaml = path => Bun.YAML.parse(readFileSync(join(root, path), "utf8"));
const base = yaml("src/modules/base-tools/base-tools.yml");
const runtime = yaml("src/modules/runtime-config/config.yml");
const manifest = JSON.parse(readFileSync(join(root, "install.manifest.json"), "utf8"));

test("base-tools.yml has exactly the four settings", () => {
	expect(base).toEqual({
		edit: { mode: "apply_patch" },
		grep: { contextBefore: 3, contextAfter: 3 },
		tools: { artifactSpillThreshold: 100 },
	});
});

test("runtime config carries the same values", () => {
	expect(runtime.edit.mode).toBe("apply_patch");
	expect(runtime.grep.contextBefore).toBe(3);
	expect(runtime.grep.contextAfter).toBe(3);
	expect(runtime.tools.artifactSpillThreshold).toBe(100);
});

test("manifest merges base-tools.yml and has no cursor-tools", () => {
	const entry = manifest.config.find(item => item.from === "src/modules/base-tools/base-tools.yml");
	expect(entry).toEqual({ from: "src/modules/base-tools/base-tools.yml", to: "config.yml", mode: "merge" });
	expect(JSON.stringify([manifest.files, manifest.config, manifest.vscode])).not.toContain("cursor-tools");
	expect(manifest.remove).toContain("extensions/cursor-tools/index.js");
});

test("sed -n message names a path range, not offset and limit", () => {
	const rule = runtime.bashInterceptor.patterns.find(item => item.tool === "read" && item.pattern.includes("sed") && item.pattern.includes("-n"));
	expect(rule.message).toContain("`path`");
	expect(rule.message).not.toContain("offset");
	expect(rule.message).not.toContain("limit");
});
