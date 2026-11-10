import { afterEach, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { applyHarness, createUpdater, extractArchive } from "../../../../src/modules/ompcli/index.js";

const oldSha = "1".repeat(40);
const newSha = "2".repeat(40);
const version = "0.0.1";
const dirs = [];

function temporary(prefix = "ompcli-update-") {
	const dir = mkdtempSync(join(tmpdir(), prefix));
	dirs.push(dir);
	return dir;
}

function write(file, content) {
	mkdirSync(dirname(file), { recursive: true });
	writeFileSync(file, content);
}

function manifest(bootstrap) {
	return {
		version: 1,
		files: [{ from: "src/modules/a/index.js", to: "extensions/a.js" }],
		config: [{ from: "src/modules/a/memory.yml", to: "config.yml", mode: "merge" }],
		vscode: { target: "win32-x64", files: [{ from: "src/modules/ompcli/index.js", to: "index.js" }] },
		bootstrap,
	};
}

// Real GitHub archive shape: one root directory holding the repository files.
function archive(entries) {
	const dir = temporary("ompcli-archive-");
	const root = join(dir, "repo-" + newSha);
	for (const [name, content] of Object.entries(entries)) write(join(root, name), content);
	const file = join(dir, "repo.tar.gz");
	const result = Bun.spawnSync(["tar", "-czf", file, "-C", dir, "repo-" + newSha]);
	if (result.exitCode !== 0) throw new Error(result.stderr.toString());
	return file;
}

function upstream({ bootstrap = "bootstrap", payload = "new" } = {}) {
	return {
		"install.manifest.json": JSON.stringify(manifest(bootstrap)),
		"src/modules/a/index.js": payload,
		"src/modules/a/memory.yml": "memory:\n  backend: mnemopi\n",
		"src/modules/ompcli/index.js": bootstrap,
	};
}

function environment({ bootstrap = "bootstrap", pointer = null, tarball } = {}) {
	const root = temporary();
	const storageDir = join(root, "storage");
	const extensionPath = join(root, "extension");
	const agentDir = join(root, "agent");
	write(join(extensionPath, "index.js"), bootstrap);
	write(join(extensionPath, "payload/install.manifest.json"), JSON.stringify(manifest(bootstrap)));
	write(join(extensionPath, "payload/src/modules/a/index.js"), "old");
	write(join(extensionPath, "payload/.revision"), oldSha + "\n");
	write(join(agentDir, "extensions/a.js"), "old");
	write(join(agentDir, "config.yml"), "theme:\n  dark: keep\n");
	write(join(agentDir, "auth.json"), "auth");
	write(join(agentDir, "sessions/s.json"), "session");
	write(join(agentDir, "memories/m.db"), "memory");
	if (pointer !== null) {
		write(join(storageDir, "payload", version, "current.json"), JSON.stringify(pointer));
		write(join(storageDir, "payload", version, pointer, ".revision"), pointer + "\n");
		write(join(storageDir, "payload", version, pointer, "install.manifest.json"), JSON.stringify(manifest(bootstrap)));
		write(join(storageDir, "payload", version, pointer, "src/modules/a/index.js"), "previous");
	}
	const file = tarball ?? archive(upstream({ bootstrap }));
	const calls = { apply: [] };
	const deps = {
		request: async url => {
			if (url.endsWith("/commits/main")) return Response.json({ sha: newSha });
			return new Response(readFileSync(file));
		},
		storageDir,
		version,
		extensionPath,
		builtIn: join(extensionPath, "payload"),
		agentDir,
		bun: process.execPath,
		tabs: async () => [],
		extract: args => extractArchive({ ...args, bun: process.execPath, script: join(storageDir, "extract.js") }),
		apply: async args => {
			calls.apply.push({ ...args, pointerBefore: existsSync(join(storageDir, "payload", version, "current.json")) });
			return applyHarness(args);
		},
	};
	return { deps, calls, storageDir, extensionPath, agentDir, pointer: join(storageDir, "payload", version, "current.json") };
}

afterEach(() => {
	for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

test("an unchanged upstream revision does nothing", async () => {
	const env = environment();
	env.deps.request = async () => Response.json({ sha: oldSha });
	expect(await createUpdater(env.deps).run()).toEqual({ revision: oldSha, changed: false });
	expect(existsSync(env.pointer)).toBe(false);
});

test("main back at the built-in revision replaces a newer installed payload", async () => {
	const env = environment({ pointer: newSha });
	env.deps.request = async url => (url.endsWith("/commits/main") ? Response.json({ sha: oldSha }) : new Response(readFileSync(archive(upstream()))));
	expect(await createUpdater(env.deps).run()).toEqual({ revision: oldSha, changed: true, applied: true });
	expect(JSON.parse(readFileSync(env.pointer, "utf8"))).toBe(oldSha);
	expect(readFileSync(join(env.agentDir, "extensions/a.js"), "utf8")).toBe("new");
});

test("a new revision installs the harness and keeps personal state", async () => {
	const env = environment();
	const result = await createUpdater(env.deps).run();
	expect(result).toEqual({ revision: newSha, changed: true, applied: true });
	expect(JSON.parse(readFileSync(env.pointer, "utf8"))).toBe(newSha);
	expect(readFileSync(join(env.agentDir, "extensions/a.js"), "utf8")).toBe("new");
	expect(readFileSync(join(env.agentDir, "config.yml"), "utf8")).toContain("dark: keep");
	for (const [name, content] of [["auth.json", "auth"], ["sessions/s.json", "session"], ["memories/m.db", "memory"]]) {
		expect(readFileSync(join(env.agentDir, name), "utf8")).toBe(content);
	}
	expect(readFileSync(join(env.agentDir, "config.yml"), "utf8")).not.toContain("backend");
	expect(env.calls.apply[0].revision).toBe(newSha);
	expect(env.calls.apply[0].lease).toBe(false);
	expect(env.calls.apply[0].pointerBefore).toBe(false);
	expect(env.calls.apply[0].sourceDir).toBe(join(env.storageDir, "payload", version, newSha));
	expect(existsSync(join(env.calls.apply[0].sourceDir, ".bootstrap"))).toBe(false);
});

test("a bootstrap change asks for a new VSIX and keeps everything", async () => {
	const env = environment({ bootstrap: "current", tarball: archive(upstream({ bootstrap: "next" })) });
	await expect(createUpdater(env.deps).run()).rejects.toThrow("Update OMP CLI in Marketplace.");
	expect(readFileSync(join(env.agentDir, "extensions/a.js"), "utf8")).toBe("old");
	expect(existsSync(env.pointer)).toBe(false);
});

test("a broken archive keeps the old pointer", async () => {
	const broken = join(temporary("ompcli-broken-"), "broken.tar.gz");
	writeFileSync(broken, "not an archive");
	const env = environment({ pointer: oldSha, tarball: broken });
	await expect(createUpdater(env.deps).run()).rejects.toThrow();
	expect(JSON.parse(readFileSync(env.pointer, "utf8"))).toBe(oldSha);
	expect(readFileSync(join(env.agentDir, "extensions/a.js"), "utf8")).toBe("old");
	expect(env.calls.apply.length).toBe(0);
});

test("an archive without a declared file is refused", async () => {
	const entries = upstream();
	delete entries["src/modules/a/index.js"];
	const env = environment({ tarball: archive(entries) });
	await expect(createUpdater(env.deps).run()).rejects.toThrow("missing src/modules/a/index.js");
	expect(existsSync(env.pointer)).toBe(false);
});

test("open tabs block the payload write", async () => {
	const env = environment();
	env.deps.tabs = async () => [{ pid: process.pid, revision: oldSha }];
	await expect(createUpdater(env.deps).run()).rejects.toThrow("Close OMP CLI tabs before updating.");
	expect(existsSync(env.pointer)).toBe(false);
	expect(readFileSync(join(env.agentDir, "extensions/a.js"), "utf8")).toBe("old");
	expect(env.calls.apply.length).toBe(0);
});

test("a failed install restores the previous pointer", async () => {
	const env = environment({ pointer: oldSha });
	env.deps.apply = async () => {
		throw new Error("OMP CLI install failed: disk");
	};
	await expect(createUpdater(env.deps).run()).rejects.toThrow("disk");
	expect(JSON.parse(readFileSync(env.pointer, "utf8"))).toBe(oldSha);
});

test("a failed first install removes the new pointer", async () => {
	const env = environment();
	env.deps.apply = async () => {
		throw new Error("OMP CLI install failed: disk");
	};
	await expect(createUpdater(env.deps).run()).rejects.toThrow("disk");
	expect(existsSync(env.pointer)).toBe(false);
});

test("an invalid pointer is reported without rewriting it", async () => {
	const env = environment();
	write(join(env.storageDir, "payload", version, "current.json"), "not json");
	await expect(createUpdater(env.deps).run()).rejects.toThrow("Invalid payload pointer");
	expect(readFileSync(join(env.storageDir, "payload", version, "current.json"), "utf8")).toBe("not json");
});

test("a bad upstream revision is refused", async () => {
	const env = environment();
	env.deps.request = async () => Response.json({ sha: "main" });
	await expect(createUpdater(env.deps).run()).rejects.toThrow("OMP archive has no revision.");
	expect(env.calls.apply.length).toBe(0);
});
