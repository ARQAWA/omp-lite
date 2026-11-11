import { expect, test } from "bun:test";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";

const root = join(import.meta.dir, "../../..");
const manifest = JSON.parse(readFileSync(join(root, "install.manifest.json"), "utf8"));
const rootTargets = new Set(["SYSTEM.md"]);

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
	const installed = new Set(manifest.files.map(entry => entry.to));
	for (const target of manifest.remove) expect(installed.has(target)).toBe(false);
});

test("targets stay inside the agent root and are unique", () => {
	const targets = new Set();
	for (const entry of manifest.files) {
		expect(entry.to.startsWith("extensions/") || entry.to.startsWith("skills/") || entry.to.startsWith("agents/") || rootTargets.has(entry.to)).toBe(true);
		expect(entry.to.split("/")).not.toContain("..");
		expect(targets.has(entry.to)).toBe(false);
		targets.add(entry.to);
	}
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
	expect(seen["claudeResets.autoRedeem"]).toBe('"no"');
	expect(Object.keys(seen).filter(key => /token$|secret|password/i.test(key))).toEqual([]);
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
