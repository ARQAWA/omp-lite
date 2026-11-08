import { expect, test } from "bun:test";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";

const root = join(import.meta.dir, "../../..");
const manifest = JSON.parse(readFileSync(join(root, "install.manifest.json"), "utf8"));

test("the manifest covers every product module", () => {
	const modules = readdirSync(join(root, "src/modules")).filter(name => statSync(join(root, "src/modules", name)).isDirectory()).sort();
	const listed = [...manifest.files, ...manifest.config].map(entry => entry.from.split("/")[2]);
	expect([...new Set(listed)].sort()).toEqual(modules);
});

test("every source exists and no development file is installed", () => {
	for (const entry of [...manifest.files, ...manifest.config]) {
		expect(statSync(join(root, entry.from)).isFile()).toBe(true);
		expect(entry.from.startsWith("dev/")).toBe(false);
		expect(entry.from.endsWith("README.md")).toBe(false);
	}
});

test("targets stay inside the agent root and are unique", () => {
	const targets = new Set();
	for (const entry of manifest.files) {
		expect(entry.to.startsWith("extensions/") || entry.to.startsWith("skills/") || entry.to.startsWith("agents/")).toBe(true);
		expect(entry.to.split("/")).not.toContain("..");
		expect(targets.has(entry.to)).toBe(false);
		targets.add(entry.to);
	}
	for (const entry of manifest.config) {
		expect(entry.to).toBe("config.yml");
		expect(["merge", "merge-missing"]).toContain(entry.mode);
	}
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
