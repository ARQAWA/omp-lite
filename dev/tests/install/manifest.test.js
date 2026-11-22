import { expect, test } from "bun:test";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";

const root = join(import.meta.dir, "../../..");
const manifest = JSON.parse(readFileSync(join(root, "install.manifest.json"), "utf8"));

test("the manifest covers every product module", () => {
	const modules = readdirSync(join(root, "src/modules")).filter(name => statSync(join(root, "src/modules", name)).isDirectory()).sort();
	const listed = [...manifest.files, ...manifest.config, ...manifest.vscode.files].map(entry => entry.from.split("/")[2]);
	expect([...new Set(listed)].sort()).toEqual(modules);
});

test("every source exists and no development file is installed", () => {
	for (const entry of [...manifest.files, ...manifest.config, ...manifest.vscode.files]) {
		expect(statSync(join(root, entry.from)).isFile()).toBe(true);
		expect(entry.from.startsWith("dev/")).toBe(false);
		expect(entry.from.endsWith("README.md")).toBe(false);
	}
});

test("the removed background counter is not installed", () => {
	expect(manifest.files.some(entry => entry.to === "extensions/background-jobs.js")).toBe(false);
});

test("the removed memory description patch is not installed", () => {
	expect(manifest.files.some(entry => entry.to.includes("memory-tool-prompts"))).toBe(false);
	expect(manifest.remove).toContain("extensions/memory-tool-prompts.js");
});

test("the removed Luna patch is removed from installations", () => expect(manifest.remove).toContain("extensions/codex-luna-search.js"));

test("interface files replace the old installed extensions", () => {
	for (const name of ["index.js", "advisor.js", "advisor.json", "model-picker.js", "model-picker.json", "subscriptions.js", "compactions.js", "tool-summary.js", "tool-summary.json", "turn-duration.js"])
		expect(manifest.files).toContainEqual({ from: `src/modules/rqw-harness-interface/${name}`, to: `extensions/rqw-harness-interface/${name}` });
	for (const name of ["model-picker.js", "model-picker.json", "subscriptions.js", "compactions.js", "tool-summary.js", "tool-summary.json", "turn-duration.js", "turn-duration.LICENSE", "rqw-harness-interface/LICENSE"])
		expect(manifest.remove).toContain(`extensions/${name}`);
	expect(manifest.config).toContainEqual({ from: "src/modules/rqw-harness-interface/status-line.yml", to: "config.yml", mode: "merge" });
});

test("rqw-base-tools replaces the old installed base-tools", () => {
	for (const name of ["index.js", "rqw-base-tools.texts.json", "rqw-base-tools.reference.json"])
		expect(manifest.files).toContainEqual({ from: `src/modules/rqw-base-tools/${name}`, to: `extensions/rqw-base-tools/${name}` });
	for (const name of ["js", "descriptions.json", "texts.json", "reference.json"]) expect(manifest.remove).toContain(`extensions/base-tools.${name}`);
	expect(manifest.config).toContainEqual({ from: "src/modules/rqw-base-tools/rqw-base-tools.yml", to: "config.yml", mode: "merge" });
});

test("the retired paid Z.ai fragment is removed from installations", () => expect(manifest.remove).toContain("zai-models.yml"));

test("targets stay inside the agent root and are unique", () => {
	const targets = new Set();
	for (const entry of manifest.files) {
		expect(["extensions/", "skills/", "agents/", "rules/"].some(dir => entry.to.startsWith(dir)) || entry.to === "SYSTEM.md").toBe(true);
		expect(entry.to.split("/")).not.toContain("..");
		expect(targets.has(entry.to)).toBe(false);
		targets.add(entry.to);
	}
	for (const target of manifest.remove) expect(targets.has(target)).toBe(false);
	for (const entry of manifest.config) {
		expect(entry.to).toBe("config.yml");
		expect(entry.mode).toBe("merge");
	}
	expect(manifest.configFallback).toBe("config.yaml");
});

test("every setting lives in one config fragment", () => {
	const flat = (node, prefix = "", out = {}) => {
		for (const [key, value] of Object.entries(node ?? {})) {
			const id = prefix ? prefix + "." + key : key;
			if (value && typeof value === "object" && !Array.isArray(value)) flat(value, id, out);
			else out[id] = JSON.stringify(value);
		}
		return out;
	};
	const seen = {};
	for (const entry of manifest.config) {
		for (const [key, value] of Object.entries(flat(Bun.YAML.parse(readFileSync(join(root, entry.from), "utf8"))))) {
			expect(Object.keys(seen)).not.toContain(key);
			seen[key] = value;
		}
	}
	expect(seen["claudeResets.autoRedeem5h"]).toBe('"no"');
	expect(seen["claudeResets.autoRedeemWeekly"]).toBe('"no"');
	expect(seen["read.summarize.enabled"]).toBe("false");
	expect(Object.keys(seen).filter(key => /token$|secret|password/i.test(key))).toEqual([]);
});

test("the VS Code section ships the four extension files and no license", () => {
	expect(manifest.vscode.target).toBe("win32-x64");
	const targets = new Set();
	for (const entry of manifest.vscode.files) {
		expect(entry.to.includes("..")).toBe(false);
		expect(targets.has(entry.to)).toBe(false);
		targets.add(entry.to);
	}
	expect([...targets].sort()).toEqual(["index.js", "messages.json", "package.json", "runtime.json"]);
});
