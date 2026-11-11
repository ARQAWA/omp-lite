import { afterEach, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { applyHarness, createUpdater, extractArchive } from "../../../../src/modules/ompcli/index.js";

// The test machine starts Bun itself; the product starts it through the terminal chain.
const direct = async (file, args) => {
	const result = Bun.spawnSync([file, ...args]);
	return { code: result.exitCode, output: result.stderr.toString() };
};

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
	write(join(extensionPath, "payload/src/modules/a/memory.yml"), "{}\n");
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
		write(join(storageDir, "payload", version, pointer, "src/modules/a/memory.yml"), "{}\n");
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
		extract: args => extractArchive({ ...args, bun: process.execPath, script: join(storageDir, "extract.js"), run: direct }),
		apply: async args => {
			calls.apply.push({ ...args, pointerBefore: existsSync(join(storageDir, "payload", version, "current.json")) });
			return applyHarness(args);
		},
	};
	return { deps, calls, storageDir, extensionPath, agentDir, pointer: join(storageDir, "payload", version, "current.json") };
}

test("an interrupted download leaves no archive and does not block the next update", async () => {
	const env = environment();
	const request = env.deps.request;
	let broken = true;
	env.deps.request = async url => {
		if (url.endsWith("/commits/main") || !broken) return request(url);
		broken = false;
		let sent = false;
		return new Response(
			new ReadableStream({
				pull(controller) {
					if (sent) return controller.error(new Error("network down"));
					sent = true;
					controller.enqueue(new Uint8Array(8));
				},
			}),
		);
	};
	const archives = () => readdirSync(env.storageDir).filter(name => name.endsWith(".tar.gz"));
	await expect(createUpdater(env.deps).run()).rejects.toThrow("network down");
	expect(archives()).toEqual([]);
	expect((await createUpdater(env.deps).run()).changed).toBe(true);
	expect(archives()).toEqual([]);
});

test("two updates at once: the second is refused as busy and the first one finishes", async () => {
	const env = environment();
	const extract = env.deps.extract;
	let entered;
	let release;
	const inside = new Promise(resolve => (entered = resolve));
	const gate = new Promise(resolve => (release = resolve));
	env.deps.extract = async args => {
		entered();
		await gate;
		return extract(args);
	};
	const first = createUpdater(env.deps).run();
	await inside;
	await expect(createUpdater({ ...env.deps, extract }).run()).rejects.toThrow("OMP CLI installation is busy.");
	release();
	expect((await first).changed).toBe(true);
	expect(readFileSync(join(env.agentDir, "extensions/a.js"), "utf8")).toBe("new");
});

test("an update that lost the race leaves the finished revision alone", async () => {
	const env = environment();
	const request = env.deps.request;
	let reached;
	let release;
	const atGate = new Promise(resolve => (reached = resolve));
	const gate = new Promise(resolve => (release = resolve));
	let extracted = 0;
	const late = createUpdater({
		...env.deps,
		request: async url => {
			if (url.endsWith("/commits/main")) return request(url);
			reached();
			await gate;
			return request(url);
		},
		extract: async args => (extracted++, env.deps.extract(args)),
	});
	const second = late.run();
	await atGate;
	expect((await createUpdater(env.deps).run()).changed).toBe(true);
	release();
	expect(await second).toEqual({ revision: newSha, changed: false });
	expect(extracted).toBe(0);
	expect(readFileSync(join(env.storageDir, "payload", version, newSha, "src/modules/a/index.js"), "utf8")).toBe("new");
});

// A crashed run: half of the harness and the pointer are written, the journal is left.
function crash(env) {
	const id = "0".repeat(8) + "-0000-0000-0000-" + "0".repeat(12);
	const backups = join(env.agentDir, ".ompcli-backups");
	write(join(backups, id, "0"), "old");
	write(join(env.agentDir, "extensions/a.js"), "half");
	write(env.pointer, JSON.stringify(newSha));
	write(
		join(backups, "journal.json"),
		JSON.stringify({
			id,
			entries: [
				{ path: join(env.agentDir, "extensions/a.js"), existed: true, backup: join(backups, id, "0"), pointer: false },
				{ path: env.pointer, existed: false, backup: null, pointer: true },
			],
		}),
	);
	return join(backups, "journal.json");
}

test("an update after a crashed one undoes the crash first and then updates", async () => {
	const env = environment();
	const journal = crash(env);
	const result = await createUpdater(env.deps).run();
	expect(result).toEqual({ revision: newSha, changed: true, applied: true });
	expect(readFileSync(join(env.agentDir, "extensions/a.js"), "utf8")).toBe("new");
	expect(readFileSync(env.pointer, "utf8")).toBe(JSON.stringify(newSha));
	expect(existsSync(journal)).toBe(false);
});

test("another update crashing during the download is undone, not taken for a finished one", async () => {
	const env = environment();
	const request = env.deps.request;
	const updater = createUpdater({
		...env.deps,
		request: async url => {
			if (!url.endsWith("/commits/main")) crash(env);
			return request(url);
		},
	});
	expect(await updater.run()).toEqual({ revision: newSha, changed: true, applied: true });
	expect(readFileSync(join(env.agentDir, "extensions/a.js"), "utf8")).toBe("new");
	expect(existsSync(join(env.agentDir, ".ompcli-backups", "journal.json"))).toBe(false);
});

afterEach(() => {
	for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

test("an unchanged upstream revision changes nothing once its harness is installed", async () => {
	const env = environment();
	env.deps.request = async () => Response.json({ sha: oldSha });
	await createUpdater(env.deps).run();
	expect(await createUpdater(env.deps).run()).toEqual({ revision: oldSha, changed: false });
	expect(existsSync(env.pointer)).toBe(false);
});

test("the first update installs the harness the extension carries", async () => {
	const env = environment();
	env.deps.request = async () => Response.json({ sha: oldSha });
	rmSync(join(env.agentDir, "extensions/a.js"));
	expect(await createUpdater(env.deps).run()).toEqual({ revision: oldSha, changed: true });
	expect(readFileSync(join(env.agentDir, "extensions/a.js"), "utf8")).toBe("old");
	expect(env.calls.apply[0].sourceDir).toBe(join(env.extensionPath, "payload"));
	expect(existsSync(env.pointer)).toBe(false);
	// A tab of another revision still blocks the write.
	rmSync(join(env.agentDir, "extensions/a.js"));
	env.deps.tabs = async () => [{ pid: process.pid, revision: newSha }];
	await expect(createUpdater(env.deps).run()).rejects.toThrow("Close OMP CLI tabs before updating.");
});

test("a pointer to another revision is replaced when upstream returns to the built-in one", async () => {
	const env = environment({ pointer: "3".repeat(40) });
	const request = env.deps.request;
	env.deps.request = async url => (url.endsWith("/commits/main") ? Response.json({ sha: oldSha }) : request(url));
	const result = await createUpdater(env.deps).run();
	expect(result).toEqual({ revision: oldSha, changed: true, applied: true });
	expect(JSON.parse(readFileSync(env.pointer, "utf8"))).toBe(oldSha);
	expect(readFileSync(join(env.agentDir, "extensions/a.js"), "utf8")).toBe("new");
});

test("an update of the same revision restores a lost harness file", async () => {
	const env = environment({ pointer: newSha });
	await createUpdater(env.deps).run();
	rmSync(join(env.agentDir, "extensions/a.js"));
	expect(await createUpdater(env.deps).run()).toEqual({ revision: newSha, changed: true });
	expect(readFileSync(join(env.agentDir, "extensions/a.js"), "utf8")).toBe("previous");
	expect(env.calls.apply.at(-1).sourceDir).toBe(join(env.storageDir, "payload", version, newSha));
	expect(await createUpdater(env.deps).run()).toEqual({ revision: newSha, changed: false });
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

test("an extraction that leaves nothing behind reports what the terminal showed", async () => {
	const storageDir = temporary();
	const stage = join(storageDir, "stage");
	const run = async () => ({ code: 126, output: "hello\nbash: bun.exe: Permission denied" });
	await expect(extractArchive({ bun: "bun.exe", archive: "a.tar.gz", stage, revision: "d".repeat(40), script: join(storageDir, "extract.js"), run })).rejects.toThrow("OMP extraction failed: hello | bash: bun.exe: Permission denied");
});
