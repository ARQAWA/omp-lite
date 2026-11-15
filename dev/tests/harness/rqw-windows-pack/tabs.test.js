import { expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { world } from "./helpers.js";

const read = file => readFileSync(file, "utf8");

test("the OMP tab runs omp.exe through PowerShell and Git Bash with the managed environment", async () => {
	const w = world({ settings: { proxy: " http://user:secret@proxy:8080 ", proxyStrictSSL: false }, env: { Path: "C:\\Windows", PI_CONFIG_FILES: "C:\\mine.yml", https_proxy: "http://old" } });
	const terminal = await w.tab();
	expect(terminal.name).toBe("OMP 1");
	const [server, proc] = w.state.spawned;
	expect([server.file, proc.file, proc.args.slice(0, 3)]).toEqual(["powershell.exe", "powershell.exe", ["-NoLogo", "-NoProfile", "-Command"]]);
	const command = proc.args[3];
	const overlay = proc.options.env.PI_CONFIG_FILES.split(";").at(-1);
	expect(command.startsWith(`& '${join(w.root, "bash.exe")}' --login -i -c '`)).toBe(true);
	expect(command.endsWith(`; ''${join(w.ext, "runtime/omp.exe")}'' ''--config'' ''${overlay}'' ''--allow-home'''`)).toBe(true);
	expect(command).toContain("unset http_proxy https_proxy all_proxy no_proxy; [[ -n $OMPCLI_HTTP_PROXY ]] && export HTTP_PROXY=$OMPCLI_HTTP_PROXY;");
	expect(command).toContain("export PI_CONFIG_FILES=$OMPCLI_CONFIG_FILES");
	// No double quote and no secret in the command line.
	expect(command).not.toMatch(/"|secret/);
	const env = proc.options.env;
	expect(env.PI_CONFIG_FILES).toBe(["C:\\mine.yml", join(w.ext, "payload/src/config.yml"), overlay].join(";"));
	expect(env.OMPCLI_CONFIG_FILES).toBe(env.PI_CONFIG_FILES);
	expect(env.PATH).toBe(join(w.ext, "runtime") + ";C:\\Windows");
	for (const name of ["HTTP_PROXY", "HTTPS_PROXY", "PI_PROXY", "OMPCLI_HTTPS_PROXY", "OMPCLI_PI_PROXY"]) expect(env[name]).toBe("http://user:secret@proxy:8080");
	expect([env.https_proxy, env.NODE_TLS_REJECT_UNAUTHORIZED, env.MNEMOPI_EMBEDDING_DIM, env.MNEMOPI_EMBEDDING_BATCH_SIZE, env.MNEMOPI_EMBEDDING_MODEL]).toEqual([undefined, "0", "768", "1", "embeddinggemma-2:270m-q8_0"]);
	expect([proc.options.cwd, proc.options.cols, proc.options.rows]).toEqual([w.home, 100, 40]);
	// The harness is installed, and the dictation config of the window points to the key file.
	expect(env.OMPCLI_GIT_BASH).toBe(join(w.root, "bash.exe"));
	expect(env.PI_STT_CONFIG).toBe(join(w.storage, "stt.json"));
	expect(JSON.parse(read(env.PI_STT_CONFIG)).provider).toEqual({ type: "soniox", apiKeyFile: join(w.storage, "ad591530-694c-42f1-9f01-f03bee4cca1c.txt") });
	expect(existsSync(join(w.agent, "extensions/pi-voice-stt/stt.windows.json"))).toBe(true);
	// Input and size go straight to the program; the shortcuts work in our tabs only.
	terminal.pty.handleInput("x");
	terminal.pty.setDimensions({ columns: 80, rows: 20 });
	expect([proc.input, proc.size]).toEqual([["x"], [80, 20]]);
	w.window.onDidChangeActiveTerminal.fire(terminal);
	expect(w.state.context["ompcli.terminalActive"]).toBe(true);
	w.window.onDidChangeActiveTerminal.fire({});
	expect(w.state.context["ompcli.terminalActive"]).toBe(false);
	// Closing the last tab kills its program, stops the memory server and drops the overlay.
	terminal.pty.close();
	await w.window.onDidCloseTerminal.fire(terminal);
	expect([proc.killed, server.killed, existsSync(overlay)]).toEqual([true, true, false]);
});

test("the terminal tab is Git Bash with an rc file; a workspace folder is the working directory", async () => {
	const w = world({ folder: "C:\\work", env: { HTTP_PROXY: "http://vdi:1" } });
	expect((await w.tab("ompcli.shellTab")).name).toBe("OMP terminal 1");
	const proc = w.state.spawned.at(-1);
	const rc = join(w.storage, "shell-" + process.pid + ".sh");
	expect(proc.args[3].endsWith(`-c 'exec bash --rcfile ''${rc}'' -i'`)).toBe(true);
	expect(read(rc)).toContain("[ -f ~/.bashrc ] && . ~/.bashrc\nunset http_proxy");
	expect(read(rc)).toContain("export PATH=$(cygpath -u '" + join(w.ext, "runtime") + "'):$PATH\n");
	// An empty `http.proxy` takes the proxy VS Code was started with.
	expect([proc.options.cwd, proc.options.env.PI_PROXY, proc.options.env.HTTPS_PROXY]).toEqual(["C:\\work", "http://vdi:1", "http://vdi:1"]);
	await w.tab();
	expect(w.state.spawned.at(-1).args[3]).not.toContain("--allow-home");
	// Two tabs share one memory server.
	expect(w.state.spawned.length).toBe(3);
});

test("a command names what is missing and opens nothing", async () => {
	const cases = [
		[{ platform: "darwin" }, "OMP CLI requires Windows x64."],
		[{ env: { PI_PROFILE: "work" } }, "OMP CLI requires the default OMP profile."],
	];
	for (const [options, message] of cases) {
		const w = world(options);
		for (const command of ["ompcli.newTab", "ompcli.shellTab"]) await w.run(command);
		await w.run("ompcli.update");
		expect(w.state.messages).toEqual([message, message, "OMP CLI update failed: " + message]);
		expect([w.state.terminals, w.state.spawned]).toEqual([[], []]);
	}
});

test("a tab closed while it was loading starts nothing and leaves no memory server", async () => {
	const w = world();
	await w.run("ompcli.newTab");
	const terminal = w.state.terminals[0];
	terminal.pty.close();
	w.window.onDidCloseTerminal.fire(terminal);
	await terminal.opened;
	expect(w.state.spawned.map(proc => proc.killed)).toEqual([true]);
});
