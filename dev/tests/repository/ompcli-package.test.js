import { expect, test } from "bun:test";
import { readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dir, "../../..");
const manifest = JSON.parse(readFileSync(join(root, "install.manifest.json"), "utf8"));
const extension = JSON.parse(readFileSync(join(root, "src/modules/ompcli/package.json"), "utf8"));

test("the packaged extension contains three commands and a scoped Ctrl+Enter", () => {
	expect(extension.activationEvents).toEqual([]);
	expect(extension.main).toBe("./index.js");
	expect(extension.dependencies).toBeUndefined();
	expect(extension.devDependencies).toBeUndefined();
	expect(extension.contributes.commands).toEqual([
		{ command: "ompcli.newTab", title: "New Tab", category: "OMP CLI" },
		{ command: "ompcli.shellTab", title: "New Terminal Tab", category: "OMP CLI" },
		{ command: "ompcli.update", title: "Update", category: "OMP CLI" },
	]);
	expect(extension.contributes.keybindings).toEqual([{
		key: "ctrl+enter",
		command: "workbench.action.terminal.sendSequence",
		when: "terminalFocus && ompcli.terminalActive",
		args: { text: "\u001b[13;5u" },
	}]);
	expect(extension.repository.url).toContain("ARQAWA/omp-lite");
});

test("the staging plan never carries development files or secrets", () => {
	for (const entry of manifest.vscode.files) {
		expect(entry.from.startsWith("src/modules/")).toBe(true);
		expect(entry.from.includes("dev/")).toBe(false);
		expect(entry.from.endsWith("README.md")).toBe(false);
		expect(entry.to.includes("..")).toBe(false);
		expect(entry.to).not.toMatch(/^dev\//);
		expect(entry.to).not.toMatch(/\.env|auth|token|\.pem|\.key/i);
		expect(statSync(join(root, entry.from)).isFile()).toBe(true);
	}
});

test("the harness payload holds only declared product sources", () => {
	for (const entry of [...manifest.files, ...manifest.config]) {
		expect(entry.from.startsWith("src/modules/")).toBe(true);
		expect(entry.from.includes("dev/")).toBe(false);
		expect(statSync(join(root, entry.from)).isFile()).toBe(true);
	}
});

test("the runtime pins cover every shipped Windows component", () => {
	const pins = JSON.parse(readFileSync(join(root, "src/modules/ompcli/runtime.json"), "utf8"));
	expect(pins.version).toBe("18.18.0");
	expect(Object.keys(pins.assets).sort()).toEqual(["bun", "model", "omp"]);
	const files = { ...pins.llama.files, ...pins.vc.files };
	expect(files["llama-server.exe"]).toMatch(/^[a-f0-9]{64}$/);
	expect(files["libomp.dll"]).toMatch(/^[a-f0-9]{64}$/);
	for (const name of ["msvcp140.dll", "vcruntime140.dll", "vcruntime140_1.dll"]) expect(files[name]).toMatch(/^[a-f0-9]{64}$/);
	expect(pins.llama.url).toContain("b12211");
	expect(pins.vc.version).toBe("14.51.36247");
});
