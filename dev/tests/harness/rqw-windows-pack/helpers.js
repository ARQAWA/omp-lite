import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { createCli } from "../../../../src/modules/rqw-windows-pack/vscode/index.js";

export const temp = () => mkdtempSync(join(tmpdir(), "rqw-windows-pack-"));
export const sha = data => createHash("sha256").update(data).digest("hex");

export function write(file, data) {
	mkdirSync(dirname(file), { recursive: true });
	writeFileSync(file, data);
	return file;
}

// A harness payload: the manifest and the files it names.
export function payload(dir, manifest, files) {
	write(join(dir, "install.manifest.json"), JSON.stringify({ version: 1, files: [], config: [], ...manifest }));
	for (const [name, data] of Object.entries(files)) write(join(dir, name), data);
	return dir;
}

// One VS Code window on a fake Windows: the extension folder, its storage, a home, node-pty and the network.
export function world({ settings = {}, env = {}, platform = "win32", request, folder, files = {} } = {}) {
	const root = temp();
	const [ext, storage, home] = ["ext", "storage", "home"].map(name => join(root, name));
	const model = "model-bytes";
	write(join(ext, "runtime/omp.exe"), "omp");
	write(join(storage, "model/model.gguf"), model);
	write(join(ext, "payload/.revision"), "a".repeat(40) + "\n");
	payload(join(ext, "payload"), { files: [{ from: "src/stt.windows.json", to: "extensions/pi-voice-stt/stt.windows.json" }], config: [{ from: "src/config.yml" }] }, {
		"src/stt.windows.json": JSON.stringify({ provider: { type: "soniox" } }),
		"src/config.yml": "a: 1\n",
	});
	for (const [name, data] of Object.entries(files)) write(join(root, name), data);
	const state = { commands: {}, messages: [], log: [], terminals: [], spawned: [], context: {} };
	const event = () => {
		const handlers = [];
		const on = handler => (handlers.push(handler), { dispose() {} });
		on.fire = value => Promise.all(handlers.map(handler => handler(value)));
		return on;
	};
	const window = {
		onDidChangeActiveTerminal: event(),
		onDidCloseTerminal: event(),
		createTerminal(options) {
			const terminal = { ...options, show() {}, opened: options.pty.open({ columns: 100, rows: 40 }) };
			state.terminals.push(terminal);
			return terminal;
		},
		withProgress: (options, action) => action(),
		createOutputChannel: () => ({ appendLine: line => state.log.push(line), dispose() {} }),
	};
	for (const name of ["showErrorMessage", "showInformationMessage", "showWarningMessage"]) window[name] = message => state.messages.push(message);
	const vscode = {
		window,
		workspace: { workspaceFolders: folder && [{ uri: { fsPath: folder } }], getConfiguration: () => ({ get: name => settings[name] }) },
		commands: {
			registerCommand: (name, handler) => (state.commands[name] = handler),
			executeCommand: (name, key, value) => (state.context[key] = value),
		},
		ViewColumn: { Active: 1 },
		ProgressLocation: { Notification: 15 },
		EventEmitter: class {
			event = event();
			fire(value) {
				this.event.fire(value);
			}
		},
		env: { appRoot: "/app" },
	};
	const pty = {
		spawn(file, args, options) {
			const exits = [];
			const proc = { file, args, options, input: [], onData() {}, onExit: handler => exits.push(handler), write: data => proc.input.push(data), resize: (...size) => (proc.size = size), kill: () => (proc.killed = true), exit: exitCode => exits.forEach(handler => handler({ exitCode })) };
			state.spawned.push(proc);
			return proc;
		},
	};
	const host = {
		vscode, platform, request, env, arch: "x64", version: "1.0.0", extensionPath: ext, storageDir: storage, homedir: home,
		gitBash: write(join(root, "bash.exe"), ""),
		loadPty: () => pty,
		pins: { assets: { omp: { file: "omp.exe", size: 3 }, model: { file: "model.gguf", size: model.length, sha256: sha(model), url: "https://model" } } },
	};
	createCli(host).activate();
	const tab = async (command = "ompcli.newTab") => {
		await state.commands[command]();
		await state.terminals.at(-1)?.opened;
		return state.terminals.at(-1);
	};
	return { root, ext, storage, home, state, window, tab, agent: join(home, ".omp/agent"), run: command => state.commands[command]() };
}
