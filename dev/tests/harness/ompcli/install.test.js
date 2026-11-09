import { afterEach, expect, test } from "bun:test";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import path from "node:path";
import { applyHarness, isInside, planHarness, recover } from "../../../../src/modules/ompcli/index.js";

const revision = "b".repeat(40);
const dirs = [];

function workspace(entries, config = [], files = {}) {
	const dir = mkdtempSync(join(tmpdir(), "ompcli-install-"));
	dirs.push(dir);
	const source = join(dir, "payload");
	const agent = join(dir, "agent");
	mkdirSync(source, { recursive: true });
	mkdirSync(agent, { recursive: true });
	writeFileSync(join(source, "install.manifest.json"), JSON.stringify({ version: 1, files: entries, config }));
	for (const [name, content] of Object.entries(files)) {
		mkdirSync(dirname(join(source, name)), { recursive: true });
		writeFileSync(join(source, name), content);
	}
	return { dir, source, agent };
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

afterEach(() => {
	for (const dir of dirs.splice(0)) {
		if (existsSync(join(dir, "agent"))) chmodSync(join(dir, "agent"), 0o755);
		rmSync(dir, { recursive: true, force: true });
	}
});

test("a clean install writes only the declared files", async () => {
	const { source, agent } = workspace(
		[{ from: "src/a.js", to: "extensions/a.js" }, { from: "src/nested/b.md", to: "skills/b/SKILL.md" }],
		[{ from: "src/config.yml", to: "config.yml", mode: "merge-missing" }],
		{ "src/a.js": "a", "src/nested/b.md": "b", "src/config.yml": "memory:\n  backend: mnemopi\n" },
	);
	expect(await applyHarness({ sourceDir: source, agentDir: agent, revision })).toEqual({ revision, changed: true });
	expect(tree(agent)).toEqual(["config.yml", "extensions/a.js", "skills/b/SKILL.md"]);
	expect(readFileSync(join(agent, "config.yml"), "utf8")).toBe("memory:\n  backend: mnemopi");
	expect(existsSync(join(agent, ".ompcli-backups"))).toBe(false);
});

test("a second run reports no change and writes nothing", async () => {
	const { source, agent } = workspace([{ from: "src/a.js", to: "extensions/a.js" }], [], { "src/a.js": "a" });
	await applyHarness({ sourceDir: source, agentDir: agent, revision });
	expect(await applyHarness({ sourceDir: source, agentDir: agent, revision })).toEqual({ revision, changed: false });
	expect(tree(agent)).toEqual(["extensions/a.js"]);
});

test("an existing YAML keeps foreign keys and replaces only declared leaves", async () => {
	const { source, agent } = workspace(
		[],
		[
			{ from: "src/base.yml", to: "config.yml", mode: "merge-missing" },
			{ from: "src/thresholds.yml", to: "config.yml", mode: "merge" },
		],
		{
			"src/base.yml": "memory:\n  backend: mnemopi\nmnemopi:\n  embeddingModel: local\n  autoRecall: false\n",
			"src/thresholds.yml": "compaction:\n  modelThresholds:\n    a: f100\n    b: f200\n",
		},
	);
	writeFileSync(join(agent, "config.yml"), "theme:\n  dark: x\nmemory:\n  backend: off\ncompaction:\n  other: true\nmnemopi:\n  autoRecall: true\n");
	await applyHarness({ sourceDir: source, agentDir: agent, revision });
	const text = readFileSync(join(agent, "config.yml"), "utf8");
	expect(text).toContain("theme:");
	expect(text).toContain("dark: x");
	expect(text).toContain("other: true");
	expect(text).toContain('backend: "off"');
	expect(text).toContain("embeddingModel: local");
	expect(text).toContain("modelThresholds:");
	expect(text).toContain("a: f100");
	expect(text).toContain("autoRecall: true");
});

test("an existing config.yaml is reused instead of creating config.yml", async () => {
	const { source, agent } = workspace([], [{ from: "src/c.yml", to: "config.yml", mode: "merge" }], { "src/c.yml": "a: 1\n" });
	writeFileSync(join(agent, "config.yaml"), "b: 2\n");
	await applyHarness({ sourceDir: source, agentDir: agent, revision });
	expect(tree(agent)).toEqual(["config.yaml"]);
	expect(readFileSync(join(agent, "config.yaml"), "utf8")).toContain("b: 2");
});

test("broken YAML and unknown modes block the installation", async () => {
	const broken = workspace([], [{ from: "src/c.yml", to: "config.yml", mode: "merge" }], { "src/c.yml": "a: 1\n" });
	writeFileSync(join(broken.agent, "config.yml"), "a: [unclosed\n");
	await expect(applyHarness({ sourceDir: broken.source, agentDir: broken.agent, revision })).rejects.toThrow();
	expect(readFileSync(join(broken.agent, "config.yml"), "utf8")).toBe("a: [unclosed\n");

	const unknown = workspace([], [{ from: "src/c.yml", to: "config.yml", mode: "override" }], { "src/c.yml": "a: 1\n" });
	await expect(applyHarness({ sourceDir: unknown.source, agentDir: unknown.agent, revision })).rejects.toThrow("Invalid install manifest");
	expect(tree(unknown.agent)).toEqual([]);
});

test("a failed write restores the previous state", async () => {
	const { source, agent } = workspace(
		[{ from: "src/a.js", to: "extensions/a.js" }, { from: "src/b.js", to: "locked/b.js" }],
		[],
		{ "src/a.js": "new a", "src/b.js": "new b" },
	);
	mkdirSync(join(agent, "extensions"));
	writeFileSync(join(agent, "extensions/a.js"), "old a");
	mkdirSync(join(agent, "locked"));
	chmodSync(join(agent, "locked"), 0o555);
	await expect(applyHarness({ sourceDir: source, agentDir: agent, revision })).rejects.toThrow();
	chmodSync(join(agent, "locked"), 0o755);
	expect(readFileSync(join(agent, "extensions/a.js"), "utf8")).toBe("old a");
	expect(existsSync(join(agent, "locked/b.js"))).toBe(false);
	expect(existsSync(join(agent, ".ompcli-backups/journal.json"))).toBe(false);
});

test("unsafe destinations never write outside the agent root", async () => {
	const outside = mkdtempSync(join(tmpdir(), "ompcli-outside-"));
	for (const to of ["../escape.js", "a:b.js", "dir\\file.js", "/abs.js", "a/../../b.js"]) {
		const { source, agent } = workspace([{ from: "src/a.js", to }], [], { "src/a.js": "a" });
		await expect(applyHarness({ sourceDir: source, agentDir: agent, revision })).rejects.toThrow("Unsafe path");
		expect(tree(agent)).toEqual([]);
	}
	const linked = workspace([{ from: "src/a.js", to: "extensions/a.js" }], [], { "src/a.js": "a" });
	symlinkSync(outside, join(linked.agent, "extensions"));
	await expect(applyHarness({ sourceDir: linked.source, agentDir: linked.agent, revision })).rejects.toThrow();
	expect(tree(outside)).toEqual([]);
	rmSync(join(linked.agent, "extensions"), { force: true });
	rmSync(outside, { recursive: true, force: true });
});

test("a damaged journal is rolled back before the next run", async () => {
	const { source, agent } = workspace([{ from: "src/a.js", to: "extensions/a.js" }], [], { "src/a.js": "new" });
	mkdirSync(join(agent, "extensions"));
	writeFileSync(join(agent, "extensions/a.js"), "half written");
	mkdirSync(join(agent, ".ompcli-backups/0f8fad5b-d9cb-469f-a165-70867728950e"), { recursive: true });
	writeFileSync(join(agent, ".ompcli-backups/0f8fad5b-d9cb-469f-a165-70867728950e/0"), "old");
	writeFileSync(join(agent, ".ompcli-backups/journal.json"), JSON.stringify({
		id: "0f8fad5b-d9cb-469f-a165-70867728950e",
		entries: [{ path: join(agent, "extensions/a.js"), existed: true, backup: join(agent, ".ompcli-backups/0f8fad5b-d9cb-469f-a165-70867728950e/0") }],
	}));
	expect(await applyHarness({ sourceDir: source, agentDir: agent, revision })).toEqual({ revision, changed: true });
	expect(readFileSync(join(agent, "extensions/a.js"), "utf8")).toBe("new");
	expect(existsSync(join(agent, ".ompcli-backups"))).toBe(false);
});

test("personal state is never touched", async () => {
	const { source, agent } = workspace([{ from: "src/a.js", to: "extensions/a.js" }], [], { "src/a.js": "a" });
	for (const name of ["auth.json", "sessions/s1.json", "memories/mnemopi.db", "config.yml"]) {
		mkdirSync(dirname(join(agent, name)), { recursive: true });
		writeFileSync(join(agent, name), "keep " + name);
	}
	const before = tree(agent);
	await applyHarness({ sourceDir: source, agentDir: agent, revision });
	expect(tree(agent).filter(name => !name.startsWith("extensions/"))).toEqual(before);
	for (const name of before) expect(readFileSync(join(agent, name), "utf8")).toBe("keep " + name);
});

test("a dry plan reports the same change the install would make", async () => {
	const { source, agent } = workspace([{ from: "src/a.js", to: "extensions/a.js" }], [], { "src/a.js": "a" });
	expect((await planHarness({ sourceDir: source, agentDir: agent })).files.length).toBe(1);
	await applyHarness({ sourceDir: source, agentDir: agent, revision });
	expect(await planHarness({ sourceDir: source, agentDir: agent })).toEqual({ files: [], config: null });
	writeFileSync(join(agent, "extensions/a.js"), "edited by hand");
	expect((await planHarness({ sourceDir: source, agentDir: agent })).files.length).toBe(1);
});

test("the payload pointer is written inside the installation", async () => {
	const { dir, source, agent } = workspace([{ from: "src/a.js", to: "extensions/a.js" }], [], { "src/a.js": "a" });
	const pointer = join(dir, "storage", "current.json");
	expect(await applyHarness({ sourceDir: source, agentDir: agent, revision, pointer: { file: pointer, text: '"x"' } })).toEqual({ revision, changed: true });
	expect(JSON.parse(readFileSync(pointer, "utf8"))).toBe("x");
	expect(readFileSync(join(agent, "extensions/a.js"), "utf8")).toBe("a");
});

test("a failing pointer write restores the installed files", async () => {
	const { dir, source, agent } = workspace([{ from: "src/a.js", to: "extensions/a.js" }], [], { "src/a.js": "new" });
	mkdirSync(join(agent, "extensions"));
	writeFileSync(join(agent, "extensions/a.js"), "old");
	const locked = join(dir, "locked");
	mkdirSync(locked);
	chmodSync(locked, 0o555);
	await expect(applyHarness({ sourceDir: source, agentDir: agent, revision, pointer: { file: join(locked, "current.json"), text: '"x"' } })).rejects.toThrow();
	chmodSync(locked, 0o755);
	expect(readFileSync(join(agent, "extensions/a.js"), "utf8")).toBe("old");
});

test("a pointer path must be an absolute current.json", async () => {
	const { source, agent } = workspace([{ from: "src/a.js", to: "extensions/a.js" }], [], { "src/a.js": "a" });
	await expect(applyHarness({ sourceDir: source, agentDir: agent, revision, pointer: { file: "current.json", text: '"x"' } })).rejects.toThrow("Unsafe path");
	await expect(applyHarness({ sourceDir: source, agentDir: agent, revision, pointer: { file: "/tmp/other.json", text: '"x"' } })).rejects.toThrow("Unsafe path");
	expect(tree(agent)).toEqual([]);
});

test("a restore continues past a target it cannot write", async () => {
	const { source, agent } = workspace([{ from: "src/a.js", to: "extensions/a.js" }], [], { "src/a.js": "new" });
	const id = "0f8fad5b-d9cb-469f-a165-70867728950e";
	mkdirSync(join(agent, "extensions"));
	writeFileSync(join(agent, "extensions/a.js"), "new");
	mkdirSync(join(agent, "locked"));
	chmodSync(join(agent, "locked"), 0o555);
	mkdirSync(join(agent, ".ompcli-backups", id), { recursive: true });
	writeFileSync(join(agent, ".ompcli-backups", id, "0"), "old");
	writeFileSync(join(agent, ".ompcli-backups", id, "1"), "ghost");
	writeFileSync(join(agent, ".ompcli-backups/journal.json"), JSON.stringify({
		id,
		entries: [
			{ path: join(agent, "extensions/a.js"), existed: true, backup: join(agent, ".ompcli-backups", id, "0") },
			{ path: join(agent, "locked/ghost.js"), existed: true, backup: join(agent, ".ompcli-backups", id, "1") },
		],
	}));
	await expect(applyHarness({ sourceDir: source, agentDir: agent, revision })).rejects.toThrow("Cannot restore");
	chmodSync(join(agent, "locked"), 0o755);
	expect(readFileSync(join(agent, "extensions/a.js"), "utf8")).toBe("old");
	expect(existsSync(join(agent, "locked/ghost.js"))).toBe(false);
});

test("a journal pointing outside the install is refused and harmless", async () => {
	const outside = mkdtempSync(join(tmpdir(), "ompcli-victim-"));
	const victim = join(outside, "keep.txt");
	writeFileSync(victim, "keep");
	const { source, agent } = workspace([{ from: "src/a.js", to: "extensions/a.js" }], [], { "src/a.js": "a" });
	mkdirSync(join(agent, ".ompcli-backups/tx"), { recursive: true });
	writeFileSync(join(agent, ".ompcli-backups/journal.json"), JSON.stringify({
		id: "tx",
		entries: [{ path: victim, existed: false, backup: null, pointer: false }],
	}));
	await expect(applyHarness({ sourceDir: source, agentDir: agent, revision })).rejects.toThrow("Cannot restore");
	expect(readFileSync(victim, "utf8")).toBe("keep");
	rmSync(outside, { recursive: true, force: true });
});

test("containment rejects another drive and a parent escape", () => {
	const win = path.win32;
	expect(isInside("C:\\a\\.omp", "C:\\a\\.omp\\extensions\\a.js", win)).toBe(true);
	expect(isInside("C:\\a\\.omp", "D:\\other\\file.js", win)).toBe(false);
	expect(isInside("C:\\a\\.omp", "C:\\a\\.omp2\\file.js", win)).toBe(false);
	expect(isInside("/a", "/a/../b")).toBe(false);
});

test("a crashed pointer inside the payload is restored by the next run", async () => {
	const { source, agent } = workspace([{ from: "src/a.js", to: "extensions/a.js" }], [], { "src/a.js": "a" });
	const payloadRoot = join(agent, "storage", "payload");
	const pointer = join(payloadRoot, "1.0.0", "current.json");
	mkdirSync(join(payloadRoot, "1.0.0"), { recursive: true });
	writeFileSync(pointer, JSON.stringify("new"));
	const id = "0f8fad5b-d9cb-469f-a165-70867728950e";
	mkdirSync(join(agent, ".ompcli-backups", id), { recursive: true });
	writeFileSync(join(agent, ".ompcli-backups", id, "0"), JSON.stringify("old"));
	writeFileSync(join(agent, ".ompcli-backups/journal.json"), JSON.stringify({
		id,
		entries: [{ path: pointer, existed: true, backup: join(agent, ".ompcli-backups", id, "0"), pointer: true }],
	}));
	await applyHarness({ sourceDir: source, agentDir: agent, revision, payloadRoot });
	expect(JSON.parse(readFileSync(pointer, "utf8"))).toBe("old");
});

test("the agent root itself must not be a link", async () => {
	const dir = mkdtempSync(join(tmpdir(), "ompcli-root-"));
	dirs.push(dir);
	const source = join(dir, "source");
	const real = join(dir, "real");
	const link = join(dir, "agent");
	mkdirSync(source);
	mkdirSync(real);
	symlinkSync(real, link);
	writeFileSync(join(source, "install.manifest.json"), JSON.stringify({ revision, files: [] }));
	await expect(applyHarness({ sourceDir: source, agentDir: link, revision })).rejects.toThrow("Unsafe path");
});

test("a pointer that cannot be restored keeps the journal for the next run", async () => {
	const { source, agent } = workspace([{ from: "src/a.js", to: "extensions/a.js" }], [], { "src/a.js": "a" });
	const payloadRoot = join(agent, "storage", "payload");
	const target = join(payloadRoot, "1.0.0", "current.json");
	const id = "0f8fad5b-d9cb-469f-a165-70867728950e";
	mkdirSync(join(payloadRoot, "1.0.0"), { recursive: true });
	mkdirSync(join(agent, ".ompcli-backups", id), { recursive: true });
	writeFileSync(join(agent, ".ompcli-backups", id, "0"), JSON.stringify("old"));
	writeFileSync(join(agent, ".ompcli-backups/journal.json"), JSON.stringify({
		id,
		entries: [{ path: target, existed: true, backup: join(agent, ".ompcli-backups", id, "0"), pointer: true }],
	}));
	chmodSync(join(payloadRoot, "1.0.0"), 0o555);
	await expect(applyHarness({ sourceDir: source, agentDir: agent, revision, payloadRoot })).rejects.toThrow("Cannot restore");
	chmodSync(join(payloadRoot, "1.0.0"), 0o755);
	expect(existsSync(join(agent, ".ompcli-backups/journal.json"))).toBe(true);
	expect(existsSync(join(agent, ".ompcli-backups", id, "0"))).toBe(true);
});

test("recovery refuses a linked agent root and leaves the journal", async () => {
	const dir = mkdtempSync(join(tmpdir(), "ompcli-linked-"));
	dirs.push(dir);
	const real = join(dir, "real");
	const link = join(dir, "agent");
	mkdirSync(real);
	symlinkSync(real, link);
	const id = "0f8fad5b-d9cb-469f-a165-70867728950e";
	const target = join(real, "keep.txt");
	writeFileSync(target, "new");
	mkdirSync(join(real, ".ompcli-backups", id), { recursive: true });
	writeFileSync(join(real, ".ompcli-backups", id, "0"), "old");
	writeFileSync(join(real, ".ompcli-backups/journal.json"), JSON.stringify({
		id,
		entries: [{ path: target, existed: true, backup: join(real, ".ompcli-backups", id, "0") }],
	}));
	await expect(recover(link, join(dir, "payload"))).rejects.toThrow("Unsafe path");
	expect(readFileSync(target, "utf8")).toBe("new");
	expect(existsSync(join(real, ".ompcli-backups/journal.json"))).toBe(true);
});
