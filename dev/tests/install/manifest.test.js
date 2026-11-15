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
	for (const name of ["index.js", "model-picker.js", "model-picker.json", "subscriptions.js", "compactions.js", "tool-summary.js", "tool-summary.json", "turn-duration.js", "LICENSE"])
		expect(manifest.files).toContainEqual({ from: `src/modules/rqw-harness-interface/${name}`, to: `extensions/rqw-harness-interface/${name}` });
	for (const name of ["model-picker.js", "model-picker.json", "subscriptions.js", "compactions.js", "tool-summary.js", "tool-summary.json", "turn-duration.js", "turn-duration.LICENSE"])
		expect(manifest.remove).toContain(`extensions/${name}`);
	expect(manifest.config).toContainEqual({ from: "src/modules/rqw-harness-interface/status-line.yml", to: "config.yml", mode: "merge" });
});

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
});

test("config fragments form one snapshot without contradictions", () => {
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
			if (key in seen) expect([key, value]).toEqual([key, seen[key]]);
			seen[key] = value;
		}
	}
	expect(seen["claudeResets.autoRedeem5h"]).toBe('"no"');
	expect(seen["claudeResets.autoRedeemWeekly"]).toBe('"no"');
	expect(seen["read.summarize.enabled"]).toBe("true");
	expect(Object.keys(seen).filter(key => /token$|secret|password/i.test(key))).toEqual([]);
});

test("compaction threshold maps match", () => {
	const load = path => Bun.YAML.parse(readFileSync(join(root, path), "utf8")).compaction.modelThresholds;
	expect(load("src/modules/runtime-config/config.yml")).toEqual(load("src/modules/compaction-400k/thresholds.yml"));
});

test("mnemopi settings and the local embedding model are part of the contract", () => {
	expect(manifest.mnemopi.settings).toEqual({
		"memory.backend": "mnemopi",
		"mnemopi.embeddingModel": "embeddinggemma-2:270m",
		"mnemopi.embeddingApiUrl": "http://127.0.0.1:11434/v1",
		"mnemopi.embeddingApiKey": "ollama",
	});
	expect(manifest.mnemopi.install).toContain("ollama pull embeddinggemma-2:270m");
	expect(manifest.config.some(entry => entry.from === "src/modules/runtime-config/mnemopi.yml" && entry.mode === "merge")).toBe(true);
	expect(manifest.configFallback).toBe("config.yaml");
});

test("the VS Code section ships the extension files and their licenses", () => {
	expect(manifest.vscode.target).toBe("win32-x64");
	const targets = new Set();
	for (const entry of manifest.vscode.files) {
		expect(entry.to.includes("..")).toBe(false);
		expect(targets.has(entry.to)).toBe(false);
		targets.add(entry.to);
	}
	for (const name of ["index.js", "package.json", "runtime.json", "messages.json"]) expect(targets.has(name)).toBe(true);
	expect([...targets].filter(name => name.startsWith("licenses/")).length).toBeGreaterThanOrEqual(6);
});
