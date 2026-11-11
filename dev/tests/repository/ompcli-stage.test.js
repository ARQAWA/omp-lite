import { afterEach, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { stage } from "../../scripts/ompcli-build/stage.js";

const dirs = [];

function temporary(prefix = "ompcli-stage-") {
	const dir = mkdtempSync(join(tmpdir(), prefix));
	dirs.push(dir);
	return dir;
}

function write(file, content) {
	mkdirSync(dirname(file), { recursive: true });
	writeFileSync(file, content);
}

function tree(root, prefix = "") {
	const names = [];
	for (const entry of readdirSync(join(root, prefix), { withFileTypes: true })) {
		const full = prefix ? prefix + "/" + entry.name : entry.name;
		if (entry.isDirectory()) names.push(...tree(root, full));
		else names.push(full);
	}
	return names.sort();
}

function fixture() {
	const root = temporary();
	write(join(root, "install.manifest.json"), JSON.stringify({
		version: 1,
		files: [{ from: "src/modules/a/index.js", to: "extensions/a.js" }],
		config: [{ from: "src/modules/a/config.yml", to: "config.yml", mode: "merge-missing" }],
		vscode: {
			target: "win32-x64",
			files: [
				{ from: "src/modules/ompcli/index.js", to: "index.js" },
				{ from: "src/modules/ompcli/package.json", to: "package.json" },
				{ from: "src/modules/ompcli/licenses/LICENSE-omp.txt", to: "licenses/LICENSE-omp.txt" },
			],
		},
	}));
	write(join(root, "src/modules/a/index.js"), "harness");
	write(join(root, "src/modules/a/config.yml"), "theme:\n  dark: x\nmemory:\n  backend: mnemopi\nmnemopi:\n  embeddingModel: ollama\n");
	write(join(root, "src/modules/ompcli/index.js"), "extension");
	write(join(root, "src/modules/ompcli/package.json"), JSON.stringify({
		name: "ompcli",
		main: "./index.js",
		contributes: { commands: [{ command: "ompcli.newTab" }, { command: "ompcli.shellTab" }, { command: "ompcli.update" }] },
	}));
	write(join(root, "src/modules/ompcli/licenses/LICENSE-omp.txt"), "MIT");
	write(join(root, "dev/scripts/secret.js"), "console.log('secret')");
	return root;
}

afterEach(() => {
	for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

test("staging copies only the manifest entries", async () => {
	const root = fixture();
	const dist = join(temporary(), "dist");
	const manifest = JSON.parse(readFileSync(join(root, "install.manifest.json"), "utf8"));
	await stage(root, dist, manifest, "f".repeat(40));
	expect(tree(dist)).toEqual([
		"index.js",
		"licenses/LICENSE-omp.txt",
		"package.json",
		"payload/.revision",
		"payload/install.manifest.json",
		"payload/src/modules/a/config.yml",
		"payload/src/modules/a/index.js",
	]);
	expect(tree(dist).some(name => name.startsWith("dev/"))).toBe(false);
	expect(tree(dist).some(name => name.includes("secret"))).toBe(false);
	expect(readFileSync(join(dist, "payload/.revision"), "utf8").trim()).toBe("f".repeat(40));
});

test("the staged payload keeps config fragments byte for byte", async () => {
	const root = fixture();
	const dist = join(temporary(), "dist");
	const manifest = JSON.parse(readFileSync(join(root, "install.manifest.json"), "utf8"));
	await stage(root, dist, manifest, "a".repeat(40));
	expect(readFileSync(join(dist, "payload/src/modules/a/config.yml"), "utf8")).toBe(readFileSync(join(root, "src/modules/a/config.yml"), "utf8"));
});

test("the staged extension manifest keeps the three commands", async () => {
	const root = fixture();
	const dist = join(temporary(), "dist");
	const manifest = JSON.parse(readFileSync(join(root, "install.manifest.json"), "utf8"));
	await stage(root, dist, manifest, "b".repeat(40));
	const packaged = JSON.parse(readFileSync(join(dist, "package.json"), "utf8"));
	expect(packaged.contributes.commands.map(entry => entry.command)).toEqual(["ompcli.newTab", "ompcli.shellTab", "ompcli.update"]);
	expect(statSync(join(dist, "index.js")).isFile()).toBe(true);
});

test("a development file in the manifest is refused", async () => {
	const root = fixture();
	const dist = join(temporary(), "dist");
	const manifest = {
		version: 1,
		files: [],
		config: [],
		vscode: { target: "win32-x64", files: [{ from: "dev/scripts/secret.js", to: "secret.js" }] },
	};
	await expect(stage(root, dist, manifest, "c".repeat(40))).rejects.toThrow("Development file installed");
	expect(existsSync(join(dist, "secret.js"))).toBe(false);
});
