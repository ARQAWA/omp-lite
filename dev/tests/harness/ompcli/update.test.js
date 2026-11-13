import { afterEach, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { applyHarness, createUpdater,
	sameBootstrap, extractArchive } from "../../../../src/modules/ompcli/index.js";

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
		vscode: { target: "win32-x64", files: [{ from: "src/modules/ompcli/index.js", to: "index.js" }, { from: "src/modules/ompcli/runtime.json", to: "runtime.json" }] },
		bootstrap,
	};
}

// Real GitHub archive shape: one root directory holding the repository files.
function archive(entries) {
	const dir = temporary("ompcli-archive-");
	const root = join(dir, "repo-" + newSha);
	for (const [name, content] of Object.entries(entries)) write(join(root, name), content);
	const file = join(dir, "repo.tar.gz");
	// macOS tar would add its own "._" entries; GitHub archives have none.
	const result = Bun.spawnSync(["tar", "-czf", file, "-C", dir, "repo-" + newSha], { env: { ...process.env, COPYFILE_DISABLE: "1" } });
	if (result.exitCode !== 0) throw new Error(result.stderr.toString());
	return file;
}

function upstream({ bootstrap = "bootstrap", payload = "new", runtime = "pins" } = {}) {
	return {
		"install.manifest.json": JSON.stringify(manifest(bootstrap)),
		"src/modules/a/index.js": payload,
		"src/modules/a/memory.yml": "memory:\n  backend: mnemopi\n",
		"src/modules/ompcli/index.js": bootstrap,
		"src/modules/ompcli/runtime.json": runtime,
	};
}

function environment({ bootstrap = "bootstrap", runtime = "pins", pointer = null, tarball } = {}) {
	const root = temporary();
	const storageDir = join(root, "storage");
	const extensionPath = join(root, "extension");
	const agentDir = join(root, "agent");
	write(join(extensionPath, "index.js"), bootstrap);
	write(join(extensionPath, "runtime.json"), runtime);
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
		tabs: async () => [],
		extract: extractArchive,
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
	expect(readFileSync(join(env.agentDir, "config.yml"), "utf8")).toBe("theme:\n  dark: keep\n");
	for (const [name, content] of [["auth.json", "auth"], ["sessions/s.json", "session"], ["memories/m.db", "memory"]]) {
		expect(readFileSync(join(env.agentDir, name), "utf8")).toBe(content);
	}
	// The fragment arrives as it is: OMP reads it as an overlay, the window's memory overlay comes after it.
	expect(readFileSync(join(env.calls.apply[0].sourceDir, "src/modules/a/memory.yml"), "utf8")).toBe("memory:\n  backend: mnemopi\n");
	expect(env.calls.apply[0].revision).toBe(newSha);
	expect(env.calls.apply[0].pointerBefore).toBe(false);
	expect(env.calls.apply[0].sourceDir).toBe(join(env.storageDir, "payload", version, newSha));
	expect(existsSync(join(env.calls.apply[0].sourceDir, ".bootstrap"))).toBe(false);
});

test("a runtime.json change asks for a new VSIX and keeps everything", async () => {
	const env = environment({ runtime: "current", tarball: archive(upstream({ runtime: "next" })) });
	await expect(createUpdater(env.deps).run()).rejects.toThrow("Update OMP CLI in Marketplace.");
	expect(readFileSync(join(env.agentDir, "extensions/a.js"), "utf8")).toBe("old");
	expect(existsSync(env.pointer)).toBe(false);
});

test("an index.js change installs the harness and reports a newer Marketplace version", async () => {
	const env = environment({ bootstrap: "current", tarball: archive(upstream({ bootstrap: "next" })) });
	expect(await createUpdater(env.deps).run()).toEqual({ revision: newSha, changed: true, applied: true, stale: true });
	expect(readFileSync(join(env.agentDir, "extensions/a.js"), "utf8")).toBe("new");
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

test("a real git archive with a long path and a global header is unpacked in process", async () => {
	const repo = temporary("ompcli-git-");
	const long = "src/modules/" + "deep-directory-name/".repeat(9) + "a-file-with-a-very-long-name-that-needs-a-pax-record.js";
	const files = { "install.manifest.json": JSON.stringify({ version: 1, files: [{ from: long, to: "extensions/long.js" }], config: [], vscode: { files: [{ from: "boot.js", to: "index.js" }] } }), [long]: "long content", "boot.js": "boot", "not-listed.txt": "skip" };
	for (const [name, content] of Object.entries(files)) write(join(repo, name), content);
	const git = (...args) => Bun.spawnSync(["git", "-c", "user.name=t", "-c", "user.email=t@t", ...args], { cwd: repo });
	git("init", "-q");
	git("add", "-A");
	git("commit", "-q", "-m", "x");
	const tarball = join(temporary(), "a.tar.gz");
	expect(git("archive", "--format=tar.gz", "--prefix=omp-lite-abc/", "-o", tarball, "HEAD").exitCode).toBe(0);
	const stage = join(temporary(), "stage");
	expect(await extractArchive({ archive: tarball, stage, revision: newSha })).toBe(newSha);
	expect(readFileSync(join(stage, long), "utf8")).toBe("long content");
	expect(readFileSync(join(stage, ".bootstrap/index.js"), "utf8")).toBe("boot");
	expect(readFileSync(join(stage, ".revision"), "utf8")).toBe(newSha + "\n");
	expect(existsSync(join(stage, "not-listed.txt"))).toBe(false);
});

test("a manifest path that leaves the stage is refused", async () => {
	const entries = upstream();
	entries["install.manifest.json"] = JSON.stringify({ ...manifest("bootstrap"), files: [{ from: "../outside.js", to: "extensions/a.js" }] });
	const stage = join(temporary(), "stage");
	await expect(extractArchive({ archive: archive(entries), stage, revision: newSha })).rejects.toThrow("Unsafe path");
	expect(existsSync(join(stage, ".revision"))).toBe(false);
});

test("the metadata VS Code adds to an installed package.json is not a bootstrap change", () => {
	const source = Buffer.from('{\n\t"name": "ompcli",\n\t"version": "0.0.7"\n}\n');
	const installed = Buffer.from('{"name":"ompcli","version":"0.0.7","__metadata":{"installedTimestamp":1,"size":2}}');
	expect(sameBootstrap("package.json", source, installed)).toBe(true);
	expect(sameBootstrap("package.json", source, Buffer.from('{"name":"ompcli","version":"0.0.8","__metadata":{}}'))).toBe(false);
	expect(sameBootstrap("package.json", source, Buffer.from("not json"))).toBe(false);
	expect(sameBootstrap("index.js", source, installed)).toBe(false);
	expect(sameBootstrap("index.js", source, Buffer.from(source))).toBe(true);
});
