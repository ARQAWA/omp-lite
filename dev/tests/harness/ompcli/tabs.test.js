import { afterEach, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createCli, makePty } from "../../../../src/modules/ompcli/index.js";

const dirs = [];
const revision = "c".repeat(40);

function temporary() {
	const dir = mkdtempSync(join(tmpdir(), "ompcli-tab-"));
	dirs.push(dir);
	return dir;
}

function emitter() {
	const listeners = [];
	return {
		event: handler => {
			listeners.push(handler);
			return { dispose() {} };
		},
		fire: value => {
			for (const handler of listeners) handler(value);
		},
	};
}

function vscode(settings = {}) {
	const state = { commands: new Map(), context: {}, messages: [], terminals: [], active: null };
	const window = {
		onDidChangeActiveTerminal: emitter().event,
		onDidCloseTerminal: emitter().event,
		createTerminal: options => {
			const terminal = { ...options, shown: false, show() { this.shown = true; } };
			state.terminals.push(terminal);
			if (options.pty?.open) options.pty.open({ columns: 120, rows: 30 });
			return terminal;
		},
		showErrorMessage: message => state.messages.push(message),
		showInformationMessage: message => state.messages.push(message),
		showWarningMessage: message => state.messages.push(message),
		withProgress: async (options, action) => action(),
	};
	const change = emitter();
	const close = emitter();
	window.onDidChangeActiveTerminal = change.event;
	window.onDidCloseTerminal = close.event;
	state.fireActive = change.fire;
	state.fireClose = close.fire;
	return {
		state,
		window,
		workspace: { workspaceFolders: undefined, getConfiguration: () => ({ get: name => settings[name] }) },
		commands: {
			registerCommand: (name, handler) => {
				state.commands.set(name, handler);
				return { dispose() {} };
			},
			executeCommand: (name, ...values) => {
				if (name === "setContext") {
					state.context = { ...state.context, [values[0]]: values[1] };
				}
				return Promise.resolve();
			},
		},
		ViewColumn: { Active: 1 },
		ProgressLocation: { Notification: 15 },
		EventEmitter: class {
			constructor() {
				this.source = emitter();
				this.event = this.source.event;
			}
			fire(value) {
				this.source.fire(value);
			}
		},
		env: { appRoot: "/app" },
	};
}

function nodePty() {
	const spawned = [];
	return {
		spawned,
		spawn(file, args, options) {
			const handlers = {};
			const proc = {
				file,
				args,
				options,
				killed: false,
				input: [],
				resizes: [],
				onData(handler) {
					handlers.data = handler;
				},
				onExit(handler) {
					handlers.exit = handler;
				},
				write(data) {
					this.input.push(data);
				},
				resize(columns, rows) {
					this.resizes.push([columns, rows]);
				},
				kill() {
					this.killed = true;
				},
				emit(data) {
					handlers.data?.(data);
				},
				exit(code) {
					handlers.exit?.({ exitCode: code });
				},
			};
			spawned.push(proc);
			return proc;
		},
	};
}

async function settle() {
	for (let index = 0; index < 12; index++) await Promise.resolve();
}

async function until(check, turns = 400) {
	for (let index = 0; index < turns; index++) {
		if (check()) return;
		await new Promise(resolve => setTimeout(resolve, 0));
	}
	throw new Error("Timed out waiting for the tab");
}

function deferred() {
	let resolve;
	let reject;
	const promise = new Promise((res, rej) => {
		resolve = res;
		reject = rej;
	});
	return { promise, resolve, reject };
}

function control(overrides = {}) {
	const paths = { dir: "/runtime/deadbeef", omp: "/runtime/deadbeef/omp.exe", model: "/runtime/deadbeef/model.gguf", llama: "/runtime/deadbeef/llama" };
	return {
		ensureRuntime: async () => paths,
		selectPayload: async () => "/extension/payload",
		payloadRevision: async () => revision,
		install: async () => ({ revision, changed: false }),
		configOverlays: async () => ["C:\\payload\\one.yml", "C:\\payload\\two.yml"],
		...overrides,
	};
}

function memory(spy) {
	return () => ({
		ensure: async () => {
			spy.count++;
			return { port: 5011, key: "memory-key" };
		},
		stop: () => {
			spy.stopped++;
		},
	});
}

function cli(host = {}) {
	const api = vscode(host.http);
	const pty = nodePty();
	const storageDir = temporary();
	const instance = createCli({
		vscode: api,
		extensionPath: temporary(),
		storageDir,
		version: "0.0.1",
		platform: "win32",
		arch: "x64",
		env: { PATH: "/usr/bin", PI_CODING_AGENT_DIR: temporary() },
		homedir: "/home/user",
		gitBash: "C:\\Program Files\\Git\\bin\\bash.exe",
		existsSync: () => true,
		loadPty: () => pty,
		control: control(host.control),
		memory: host.memory ?? memory({ count: 0, stopped: 0 }),
		...host.extra,
	});
	instance.activate();
	return { api, pty, storageDir, instance };
}

afterEach(() => {
	for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

test("a new tab starts OMP only after the local memory is ready", async () => {
	const ready = deferred();
	const spy = { count: 0, stopped: 0 };
	const { api, pty, storageDir, instance } = cli({
		memory: () => ({ ensure: () => (spy.count++, ready.promise), stop: () => spy.stopped++ }),
	});
	const opening = instance.newTab();
	await settle();
	expect(pty.spawned.length).toBe(0);
	ready.resolve({ port: 5012, key: "k" });
	await opening;
	await until(() => pty.spawned.length === 1);
	expect(pty.spawned.length).toBe(1);
	// The PCLI form: PowerShell, one login Git Bash, the program. No second bash and no wrapper file.
	const command = pty.spawned[0].args[3];
	expect(command).toStartWith("& 'C:\\Program Files\\Git\\bin\\bash.exe' --login -i -c 'unset http_proxy https_proxy all_proxy no_proxy; ");
	expect(command).not.toContain("rcfile");
	expect(command).not.toContain('"');
	const inner = command.match(/ -c '(.*)'$/s)[1].replaceAll("''", "'");
	expect(inner).toContain("; export PATH=$(cygpath -u '/runtime/deadbeef'):$PATH; export PI_CONFIG_FILES=$OMPCLI_CONFIG_FILES; '/runtime/deadbeef/omp.exe' '--config' '");
	expect(inner).toEndWith("memory.yml' '--allow-home'");
	expect(existsSync(join(storageDir, "chat-" + process.pid + ".sh"))).toBe(false);
	expect(api.state.terminals[0].name).toBe("OMP 1");
	expect(pty.spawned[0].file).toBe("powershell.exe");
});

test("a new terminal tab opens Git Bash, not OMP", async () => {
	const { pty, storageDir, instance } = cli();
	await instance.shellTab();
	await until(() => pty.spawned.length === 1);
	const proc = pty.spawned[0];
	const command = proc.args.join(" ");
	expect(command).toContain("bash --rcfile");
	expect(command).not.toContain("omp.exe");
	expect(proc.options.cwd).toBe("/home/user");
	const rc = join(storageDir, "shell-" + process.pid + ".sh");
	expect(existsSync(rc)).toBe(true);
	expect(readFileSync(rc, "utf8")).toContain("export PI_CONFIG_FILES=");
});

test("the shell receives OMP, Bun, the overlay and the embedding size", async () => {
	const { pty, storageDir, instance } = cli();
	await instance.shellTab();
	await until(() => pty.spawned.length === 1);
	const env = pty.spawned[0].options.env;
	expect(env.PATH.split(":").at(-1)).toBe("/usr/bin");
	expect(env.PATH.split("/").slice(0, 4).join("/")).toContain("/runtime");
	expect(env.MNEMOPI_EMBEDDING_DIM).toBe("768");
	expect(env.MNEMOPI_EMBEDDING_BATCH_SIZE).toBe("1");
	expect(env.MNEMOPI_EMBEDDING_MODEL).toBe("embeddinggemma-2:270m-q8_0");
	expect(env.PI_CONFIG_FILES).toContain(join(storageDir, "runs"));
	expect(pty.spawned[0].args.join(" ")).toContain("C:\\Program Files\\Git\\bin\\bash.exe");
});

test("a memory server restarted on the same port gives the next tab a fresh overlay", async () => {
	let starts = 0;
	const restarted = cli({ memory: () => ({ ensure: async () => ({ port: 5014, key: "key-" + ++starts }), stop: () => {} }) });
	await restarted.instance.shellTab();
	await until(() => restarted.pty.spawned.length === 1);
	await restarted.instance.shellTab();
	await until(() => restarted.pty.spawned.length === 2 || restarted.api.state.messages.length > 0);
	expect(restarted.api.state.messages).toEqual([]);
	const keys = restarted.pty.spawned.map(proc => readFileSync(proc.options.env.PI_CONFIG_FILES.split(";").at(-1), "utf8").match(/embeddingApiKey: (.+)/)[1]);
	expect(keys).toEqual(["key-1", "key-2"]);
});

test("two first tabs of one window open together and share one memory server", async () => {
	let servers = 0;
	const { api, pty, instance } = cli({ memory: () => (servers++, { ensure: async () => ({ port: 5015, key: "k" }), stop: () => {} }) });
	await Promise.all([instance.newTab(), instance.shellTab()]);
	await until(() => pty.spawned.length === 2 || api.state.messages.length > 0);
	expect(api.state.messages).toEqual([]);
	expect(pty.spawned.length).toBe(2);
	expect(servers).toBe(1);
});

test("closing the last tab stops the local memory", async () => {
	const spy = { count: 0, stopped: 0 };
	const { api, instance } = cli({ memory: memory(spy) });
	await instance.shellTab();
	await until(() => spy.count === 1);
	const terminal = api.state.terminals[0];
	api.state.fireClose(terminal);
	await until(() => spy.stopped === 1);
	expect(spy.stopped).toBe(1);
});

test("a tab closed during preparation never starts a process", async () => {
	const ready = deferred();
	const api = vscode();
	const pty = nodePty();
	const terminal = makePty({
		vscode: api,
		nodePty: pty,
		processes: new Set(),
		prepare: () => ready.promise,
		build: () => ({ command: "unused", env: {}, cwd: "/work" }),
	});
	terminal.open({ columns: 120, rows: 30 });
	terminal.close();
	ready.resolve({});
	await settle();
	expect(pty.spawned.length).toBe(0);
});

test("input, resize, exit and dispose drive the PTY", async () => {
	const api = vscode();
	const pty = nodePty();
	const processes = new Set();
	const terminal = makePty({
		vscode: api,
		nodePty: pty,
		processes,
		prepare: async () => ({}),
		build: () => ({ command: "run", env: {}, cwd: "/work" }),
	});
	const lines = [];
	terminal.onDidWrite(line => lines.push(line));
	terminal.open({ columns: 100, rows: 40 });
	await settle();
	const proc = pty.spawned[0];
	expect(proc.options.cols).toBe(100);
	expect(processes.has(proc)).toBe(true);
	terminal.handleInput("hi");
	expect(proc.input).toEqual(["hi"]);
	terminal.setDimensions({ columns: 90, rows: 30 });
	expect(proc.resizes).toEqual([[90, 30]]);
	proc.emit("out");
	expect(lines.join("")).toContain("out");
	proc.exit(0);
	expect(processes.has(proc)).toBe(false);
	expect(lines.join("")).toContain("[OMP CLI exited, code 0]");
	terminal.handleInput("ignored");
	expect(proc.input).toEqual(["hi"]);
});

test("dispose kills the processes of this extension only", async () => {
	const { pty, instance } = cli();
	await instance.newTab();
	await until(() => pty.spawned.length === 1);
	const proc = pty.spawned[0];
	instance.dispose();
	expect(proc.killed).toBe(true);
});

test("Ctrl+Enter stays inactive in foreign terminals", async () => {
	const { api, instance } = cli();
	await instance.newTab();
	await settle();
	const own = api.state.terminals[0];
	api.state.fireActive(own);
	expect(api.state.context["ompcli.terminalActive"]).toBe(true);
	api.state.fireActive({ name: "PowerShell" });
	expect(api.state.context["ompcli.terminalActive"]).toBe(false);
	api.state.fireActive(null);
	expect(api.state.context["ompcli.terminalActive"]).toBe(false);
});

test("commands refuse to start outside Windows x64", async () => {
	const { api, instance } = cli({ extra: { platform: "darwin" } });
	await instance.newTab();
	expect(api.state.messages[0]).toBe("OMP CLI requires Windows x64.");
});

test("a missing Git Bash names the exact path", async () => {
	const { api, instance } = cli({ extra: { existsSync: () => false } });
	await instance.newTab();
	expect(api.state.messages[0]).toBe("Not found: C:\\Program Files\\Git\\bin\\bash.exe. Install Git for Windows.");
});

test("a named profile is refused instead of mixing state", async () => {
	const { api, instance } = cli({ extra: { env: { PATH: "/usr/bin", OMP_PROFILE: "work" } } });
	await instance.newTab();
	expect(api.state.messages[0]).toBe("OMP CLI requires the default OMP profile.");
});

test("a live tab with another payload blocks the install", async () => {
	const installs = [];
	const { api, pty, instance } = cli({
		control: {
			tabLeases: async () => [{ pid: 1, revision: "e".repeat(40) }],
			install: async () => {
				installs.push(1);
				return { revision, changed: false };
			},
		},
	});
	await instance.newTab();
	await until(() => api.state.messages.length === 1);
	expect(api.state.messages[0]).toBe("Close OMP CLI tabs before updating.");
	expect(installs).toEqual([]);
	expect(pty.spawned.length).toBe(0);
});

test("a live tab with the same payload opens under a write guard", async () => {
	let seen = null;
	const { pty, instance } = cli({
		control: {
			tabLeases: async () => [{ pid: 1, revision }],
			install: async args => {
				seen = args;
				return { revision, changed: false };
			},
		},
	});
	await instance.newTab();
	await until(() => pty.spawned.length === 1);
	expect(seen.guard).toBe(true);
	expect(pty.spawned.length).toBe(1);
});

test("the installer runs inside the extension host with the tab's revision", async () => {
	let seen = null;
	const { instance } = cli({
		control: {
			install: async args => {
				seen = args;
				return { revision, changed: false };
			},
		},
	});
	await instance.newTab();
	await until(() => seen !== null);
	expect(seen.guard).toBe(false);
	expect(seen.revision).toBe(revision);
});

test("proxy credentials travel in the environment, never in the command line", async () => {
	const { pty, storageDir, instance } = cli({ http: { proxy: "http://user:secret@proxy.local:8080", proxyStrictSSL: true } });
	await instance.newTab();
	await until(() => pty.spawned.length === 1);
	const proc = pty.spawned[0];
	expect(proc.options.env.HTTP_PROXY).toBe("http://user:secret@proxy.local:8080");
	expect(proc.options.env.PI_PROXY).toBe("http://user:secret@proxy.local:8080");
	expect(proc.args.join(" ")).not.toContain("secret");
	expect(proc.options.env.OMPCLI_HTTPS_PROXY).toBe("http://user:secret@proxy.local:8080");
	// The profile may change PI_PROXY too: the wrapper restores it like the other proxy variables.
	expect(proc.options.env.OMPCLI_PI_PROXY).toBe("http://user:secret@proxy.local:8080");
	expect(proc.args[3]).toContain("[[ -n $OMPCLI_PI_PROXY ]] && export PI_PROXY=$OMPCLI_PI_PROXY; ");
});

test("previous overlays stay before the window overlay", async () => {
	const { pty, instance } = cli({
		extra: { env: { PATH: "/usr/bin", PI_CODING_AGENT_DIR: temporary(), PI_CONFIG_FILES: "C:\\before\\one.yml" } },
	});
	await instance.newTab();
	await until(() => pty.spawned.length === 1);
	const files = pty.spawned[0].options.env.PI_CONFIG_FILES.split(";");
	// The last file wins in OMP: the user's overlays, the harness fragments, the memory overlay of the window.
	expect(files.slice(0, 3)).toEqual(["C:\\before\\one.yml", "C:\\payload\\one.yml", "C:\\payload\\two.yml"]);
	expect(files[3]).toContain("memory.yml");
	expect(files.length).toBe(4);
	expect(pty.spawned[0].options.env.OMPCLI_CONFIG_FILES).toBe(pty.spawned[0].options.env.PI_CONFIG_FILES);
});

test("a tab closed during preparation releases its lease and memory", async () => {
	const ready = deferred();
	const spy = { created: 0, stopped: 0 };
	const { api, storageDir, instance } = cli({
		memory: () => {
			spy.created++;
			return { ensure: () => ready.promise, stop: () => spy.stopped++ };
		},
	});
	await instance.newTab();
	await until(() => spy.created === 1);
	expect(existsSync(join(storageDir, "leases", process.pid + ".json"))).toBe(true);
	api.state.fireClose(api.state.terminals[0]);
	ready.resolve({ port: 5013, key: "k" });
	await until(() => !existsSync(join(storageDir, "leases", process.pid + ".json")));
	expect(spy.stopped).toBeGreaterThan(0);
});

test("a busy lease is retried until the closed tab record is gone", async () => {
	let leases = 0;
	const { api, storageDir, instance } = cli({
		extra: {
			leaseDelay: 0,
			lease: async (agentDir, action) => {
				leases++;
				if (leases === 2) throw new Error("OMP CLI installation is busy.");
				return action();
			},
		},
	});
	await instance.shellTab();
	const record = join(storageDir, "leases", process.pid + ".json");
	await until(() => existsSync(record));
	expect(leases).toBe(1);
	await instance.closeTerminal(api.state.terminals[0]);
	await until(() => !existsSync(record));
	expect(leases).toBeGreaterThanOrEqual(3);
});

test("a tab closed while loading leaves no lease when the memory then fails", async () => {
	const runtime = deferred();
	const { api, storageDir, instance } = cli({
		control: { ensureRuntime: () => runtime.promise },
		memory: () => ({
			ensure: async () => {
				throw new Error("memory failed");
			},
			stop: () => {},
		}),
	});
	await instance.newTab();
	// Closed before the lease record exists, so closing has nothing to remove.
	api.state.terminals[0].pty.close();
	await instance.closeTerminal(api.state.terminals[0]);
	runtime.resolve({ dir: "/runtime/deadbeef", omp: "/runtime/deadbeef/omp.exe" });
	await until(() => api.state.messages.includes("OMP CLI: memory is off. memory failed"));
	await until(() => !existsSync(join(storageDir, "leases", process.pid + ".json")));
});

test("a crashed pointer is undone before the payload is selected", async () => {
	const { agent, storageDir, oldSha, newSha } = recovered();
	const picked = [];
	const { instance } = cli({
		extra: { storageDir, env: { PATH: "/usr/bin", PI_CODING_AGENT_DIR: agent } },
		control: {
			selectPayload: undefined,
			payloadRevision: undefined,
			install: async ({ sourceDir }) => {
				picked.push(sourceDir);
				return { revision, changed: false };
			},
		},
	});
	await instance.newTab();
	await until(() => picked.length === 1);
	expect(picked).toEqual([join(storageDir, "payload", "0.0.1", oldSha)]);
	expect(readFileSync(join(storageDir, "payload", "0.0.1", "current.json"), "utf8")).toBe(JSON.stringify(oldSha));
	expect(newSha).not.toBe(oldSha);
	rmSync(agent, { recursive: true, force: true });
});

function recovered() {
	const agent = temporary();
	const storageDir = temporary();
	const version = "0.0.1";
	const oldSha = "a".repeat(40);
	const newSha = "d".repeat(40);
	const base = join(storageDir, "payload", version);
	const id = "0f8fad5b-d9cb-469f-a165-70867728950e";
	mkdirSync(join(base, oldSha), { recursive: true });
	mkdirSync(join(base, newSha), { recursive: true });
	writeFileSync(join(base, oldSha, ".revision"), oldSha + "\n");
	writeFileSync(join(base, newSha, ".revision"), newSha + "\n");
	writeFileSync(join(base, "current.json"), JSON.stringify(newSha));
	mkdirSync(join(agent, ".ompcli-backups", id), { recursive: true });
	writeFileSync(join(agent, ".ompcli-backups", id, "0"), JSON.stringify(oldSha));
	writeFileSync(join(agent, ".ompcli-backups/journal.json"), JSON.stringify({
		id,
		entries: [{ path: join(base, "current.json"), existed: true, backup: join(agent, ".ompcli-backups", id, "0"), pointer: true }],
	}));
	return { agent, storageDir, oldSha, newSha };
}

test("only the memory server and OMP are started, both through the terminal chain", async () => {
	let options;
	const source = temporary();
	mkdirSync(join(source, "src"), { recursive: true });
	writeFileSync(join(source, "src", "a.js"), "a");
	writeFileSync(join(source, "src", "c.yml"), "a: 1\n");
	writeFileSync(join(source, "install.manifest.json"), JSON.stringify({ version: 1, files: [{ from: "src/a.js", to: "extensions/a.js" }], config: [{ from: "src/c.yml", to: "config.yml", mode: "merge" }] }));
	const agent = temporary();
	const { pty, instance } = cli({
		control: { install: undefined, configOverlays: undefined, selectPayload: async () => source },
		memory: given => ((options = given), { ensure: async () => ({ port: 5020, key: "k" }), stop: () => {} }),
		extra: { env: { PATH: "/usr/bin", PI_CODING_AGENT_DIR: agent } },
	});
	void instance.newTab();
	await until(() => pty.spawned.length === 1);
	// The harness was installed without any process: the only start so far is the tab itself.
	expect(readFileSync(join(agent, "extensions", "a.js"), "utf8")).toBe("a");
	expect(pty.spawned[0].args[3]).toContain("''/runtime/deadbeef/omp.exe'' ''--config''");
	expect(pty.spawned[0].options.env.PI_CONFIG_FILES.split(";")[0]).toBe(join(source, "src", "c.yml"));
	options.spawnProcess("C:\\ext\\runtime\\llama\\llama-server.exe", ["--port", "5020"], { env: {} });
	expect(pty.spawned[1].file).toBe("powershell.exe");
	expect(pty.spawned[1].args[3]).toEndWith("-c '''C:/ext/runtime/llama/llama-server.exe'' ''--port'' ''5020'''");
});

test("a memory server that cannot start opens OMP without memory and says why", async () => {
	let starts = 0;
	const { api, pty, instance } = cli({
		memory: () => ({
			ensure: async () => {
				if (++starts === 1) throw new Error("Local memory exited: 1 bash: c:/ext/runtime/llama/llama-server.exe: Permission denied");
				return { port: 5030, key: "live" };
			},
			stop: () => {},
		}),
	});
	const lines = [];
	await instance.newTab();
	api.state.terminals[0].pty.onDidWrite(line => lines.push(line));
	await until(() => pty.spawned.length === 1);
	expect(api.state.messages).toEqual(["OMP CLI: memory is off. Local memory exited: 1 bash: c:/ext/runtime/llama/llama-server.exe: Permission denied"]);
	const overlayOf = proc => readFileSync(proc.options.env.PI_CONFIG_FILES.split(";").at(-1), "utf8");
	expect(overlayOf(pty.spawned[0])).toBe('memory:\n  backend: "off"\n');
	expect(pty.spawned[0].args[3]).toContain("omp.exe");
	// The next tab tries the server again and gets working memory.
	await instance.newTab();
	await until(() => pty.spawned.length === 2);
	expect(overlayOf(pty.spawned[1])).toContain("embeddingApiKey: live");
});
