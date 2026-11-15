import { expect, test } from "bun:test";
import { existsSync, readFileSync, symlinkSync } from "node:fs";
import { join } from "node:path";
import { installHarness } from "../../../../src/modules/rqw-windows-pack/vscode/index.js";
import { payload, temp, write } from "./helpers.js";

const read = file => readFileSync(file, "utf8");

function fixture(manifest = {}) {
	const root = temp();
	const agentDir = join(root, "agent");
	write(join(agentDir, "extensions/a.js"), "old");
	write(join(agentDir, "extensions/gone/index.js"), "gone");
	write(join(agentDir, "config.yml"), "mine");
	const sourceDir = payload(join(root, "payload"), {
		files: [{ from: "src/a.js", to: "extensions/a.js" }, { from: "src/b.js", to: "extensions/b/index.js" }],
		remove: ["extensions/gone/index.js", "extensions/never.js"],
		config: [{ from: "src/layer.yml", to: "config.yml", mode: "merge" }],
		...manifest,
	}, { "src/a.js": "new", "src/b.js": "b", "src/layer.yml": "x: 1\n" });
	return { root, agentDir, sourceDir };
}

test("the manifest files are copied, the listed ones removed, config.yml is left alone", async () => {
	const { agentDir, sourceDir } = fixture();
	expect(await installHarness({ sourceDir, agentDir })).toEqual({ changed: true, layers: [join(sourceDir, "src/layer.yml")] });
	expect([read(join(agentDir, "extensions/a.js")), read(join(agentDir, "extensions/b/index.js")), read(join(agentDir, "config.yml"))]).toEqual(["new", "b", "mine"]);
	// The emptied directory of a removed extension goes too.
	expect(existsSync(join(agentDir, "extensions/gone"))).toBe(false);
	expect(existsSync(join(agentDir, ".ompcli-backups"))).toBe(false);
	expect((await installHarness({ sourceDir, agentDir })).changed).toBe(false);
});

test("an error puts every file and the pointer back", async () => {
	const { root, agentDir, sourceDir } = fixture();
	const pointer = { target: join(write(join(root, "file"), ""), "current.json"), data: "x" };
	await expect(installHarness({ sourceDir, agentDir, pointer })).rejects.toThrow();
	expect([read(join(agentDir, "extensions/a.js")), read(join(agentDir, "extensions/gone/index.js"))]).toEqual(["old", "gone"]);
	expect(existsSync(join(agentDir, "extensions/b/index.js"))).toBe(false);
	expect(existsSync(join(agentDir, ".ompcli-backups"))).toBe(false);
});

test("an interrupted install is rolled back by its journal before the next one", async () => {
	const { agentDir, sourceDir } = fixture({ files: [], remove: [] });
	write(join(agentDir, "extensions/a.js"), "half-written");
	write(join(agentDir, "extensions/new.js"), "half-written");
	write(join(agentDir, ".ompcli-backups/0"), "old");
	write(join(agentDir, ".ompcli-backups/journal.json"), JSON.stringify([{ path: join(agentDir, "extensions/a.js"), backup: "0" }, { path: join(agentDir, "extensions/new.js"), backup: null }]));
	expect((await installHarness({ sourceDir, agentDir })).changed).toBe(false);
	expect(read(join(agentDir, "extensions/a.js"))).toBe("old");
	expect(existsSync(join(agentDir, "extensions/new.js"))).toBe(false);
	expect(existsSync(join(agentDir, ".ompcli-backups"))).toBe(false);
});

test("unsafe manifest paths and links are refused before anything is written", async () => {
	const bad = [{ files: [{ from: "src/a.js", to: "../out.js" }] }, { files: [{ from: "/etc/hosts", to: "extensions/a.js" }] }, { remove: ["extensions/../../out"] }, { files: [{ from: "src/a.js", to: "linked/a.js" }] }];
	for (const manifest of bad) {
		const { root, agentDir, sourceDir } = fixture(manifest);
		symlinkSync(root, join(agentDir, "linked"));
		await expect(installHarness({ sourceDir, agentDir })).rejects.toThrow("Unsafe path");
		expect(read(join(agentDir, "extensions/a.js"))).toBe("old");
		expect(existsSync(join(root, "out.js")) || existsSync(join(root, "a.js"))).toBe(false);
	}
	const { agentDir, sourceDir } = fixture({ files: [{ from: "src/missing.js", to: "extensions/a.js" }] });
	await expect(installHarness({ sourceDir, agentDir })).rejects.toThrow("Invalid install manifest: src/missing.js");
});
