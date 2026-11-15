import { expect, mock, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import data from "../../../../src/modules/rqw-windows-pack/voice/stt.windows.json";

// OMP stand-ins: an editor with a plain border, keys named as they are, plain text widths.
mock.module("@oh-my-pi/pi-tui", () => ({
	matchesKey: (input, key) => input === key,
	visibleWidth: line => line.length,
	truncateToWidth: (line, width) => line.slice(0, width),
	extractSegments: (line, _end, start, length) => ({ after: line.slice(start, start + length) }),
}));
mock.module("@oh-my-pi/pi-tui/prompt/custom-editor", () => ({ CustomEditor: class { render(width) { return ["─".repeat(width), "text"]; } submit() { this.onSubmit(); } } }));
const { default: voice, launch } = await import("../../../../src/modules/rqw-windows-pack/voice/index.js");

const bash = "C:\\Program Files\\Git\\bin\\bash.exe";
const wav = sample => {
	const audio = Buffer.alloc(44 + 8000);
	audio.write("RIFF", 0); audio.write("WAVEfmt ", 8); audio.writeUInt32LE(16, 16); audio.write("data", 36); audio.writeUInt32LE(8000, 40);
	for (let at = 44; at < audio.length; at += 2) audio.writeInt16LE(sample, at);
	return audio;
};
const until = async done => { while (!done()) await new Promise(next => setTimeout(next, 1)); };

// One fake of the tab: OMP, the editor, ffmpeg that writes `sound` when it is told to quit, and Soniox.
function world(platform = "win32", env = { OMPCLI_GIT_BASH: bash }) {
	const dir = mkdtempSync(join(tmpdir(), "rqw-voice-test-")), keyFile = join(dir, "key.txt");
	writeFileSync(join(dir, "stt.json"), JSON.stringify({ provider: { apiKeyFile: keyFile } }));
	const w = { handlers: {}, notes: [], sent: [], calls: [], spawned: [], editor: "", sound: wav(1000), keyFile, exec: { code: 0 } };
	const pi = {
		on: (name, handler) => (w.handlers[name] = handler),
		registerCommand: (name, command) => (w.command = { name, ...command }),
		exec: async (...args) => (w.calls.push(args), w.exec),
	};
	w.ctx = {
		mode: "tui", hasUI: true,
		ui: {
			theme: { fg: (_color, line) => line },
			onTerminalInput: handler => (w.input = handler, () => {}),
			getEditorComponent: () => w.factory,
			setEditorComponent: factory => (w.factory = factory),
			getEditorText: () => w.editor,
			setEditorText: line => (w.editor = line),
			notify: (...note) => w.notes.push(note),
		},
	};
	const run = (file, args) => {
		const listeners = {}, target = /''([^']+rec\.wav)''/.exec(args[3])[1];
		w.spawned.push([file, args[3], listeners]);
		return { pid: 7, stderr: { on() {} }, once(name, fn) { listeners[name] = fn; return this; }, stdin: { on() {}, end: () => { writeFileSync(target, w.sound); listeners.close(); } } };
	};
	const request = async (url, init = {}) => {
		const path = url.replace(data.soniox.baseUrl, ""), method = init.method ?? "GET";
		w.calls.push([method, path, typeof init.body === "string" ? JSON.parse(init.body) : undefined, init.headers.Authorization]);
		const body = path === "/v1/files" ? { id: "f1" } : method === "POST" ? { id: "t1" } : path.endsWith("/transcript") ? { text: " привет " } : { status: "completed" };
		return new Response(JSON.stringify(body));
	};
	voice(pi, { env: { ...env, PI_STT_CONFIG: join(dir, "stt.json") }, platform, run, request });
	return w;
}

test("the plugin lives only in an OMP CLI tab on Windows", () => {
	for (const [platform, env] of [["darwin", { OMPCLI_GIT_BASH: bash }], ["win32", {}]]) expect([world(platform, env).handlers, world(platform, env).command]).toEqual([{}, undefined]);
	expect(world().command.name).toBe("stt");
});

test("ffmpeg goes PowerShell -> login Git Bash -> ffmpeg; slashes change in paths only", () => {
	const args = ["-f", "dshow", "-i", "audio=USB\\Mic (o'k)", "C:\\Users\\o'k\\Temp\\rec.wav", "$HOME"];
	const [file, argv] = launch(bash, "C:\\ext\\runtime\\ffmpeg.exe", args);
	expect([file, argv.slice(0, 3)]).toEqual(["powershell.exe", ["-NoLogo", "-NoProfile", "-Command"]]);
	expect(argv[3]).not.toContain('"');
	expect(argv[3]).toStartWith("& 'C:\\Program Files\\Git\\bin\\bash.exe' --login -i -c 'exec ''C:/ext/runtime/ffmpeg.exe'' ");
	// PowerShell turns '' back into '. Bash then runs the command: printf in place of ffmpeg shows what it would get.
	const inner = argv[3].match(/ -c '(.*)'$/s)[1].replaceAll("''", "'").replace(/^exec '[^']*'/, "exec /usr/bin/printf '%s\\n'");
	expect(Bun.spawnSync(["bash", "-c", inner]).stdout.toString().trimEnd().split("\n")).toEqual(["-f", "dshow", "-i", "audio=USB\\Mic (o'k)", "C:/Users/o'k/Temp/rec.wav", "$HOME"]);
});

test("alt+w records and inserts, Enter sends, Esc cancels; the label stands on the left", async () => {
	const w = world();
	writeFileSync(w.keyFile, "secret\n");
	w.handlers.session_start({}, w.ctx);
	const tui = { requestRender() {} }, first = w.factory(tui, {}, {}).render(40)[0];
	expect(first).toBe("voice alt+w " + "─".repeat(28));
	// A second session wraps nothing twice. Its editor is the live one.
	w.handlers.session_switch({}, w.ctx);
	const editor = w.factory(tui, {}, {}), top = () => editor.render(40)[0];
	editor.onSubmit = () => { w.sent.push(w.editor); w.editor = ""; };
	expect(top()).toBe(first);

	expect(w.input("x")).toBeUndefined();
	expect(w.input("alt+w")).toEqual({ consume: true });
	await until(() => w.spawned.length === 1);
	expect(w.spawned[0][1]).toContain("''-f'' ''dshow'' ''-audio_buffer_size'' ''20'' ''-i'' ''audio=Remote Audio''");
	expect(top()).toMatch(/^[●○] recording · enter send · esc cancel ─/);
	expect(top()).toHaveLength(40);
	expect(editor.render(12)[0]).toMatch(/^[●○] recordin ─$/);
	w.input("alt+w");
	await until(() => w.editor);
	expect(w.editor).toBe("привет ");
	const { baseUrl, pollMs, timeoutMs, ...settings } = data.soniox;
	expect(w.calls.map(call => call.slice(0, 2))).toEqual([["POST", "/v1/files"], ["POST", "/v1/transcriptions"], ["GET", "/v1/transcriptions/t1"], ["GET", "/v1/transcriptions/t1/transcript"], ["DELETE", "/v1/transcriptions/t1"], ["DELETE", "/v1/files/f1"]]);
	expect(w.calls[1].slice(2)).toEqual([{ ...settings, file_id: "f1" }, "Bearer secret"]);
	expect(settings).toMatchObject({ model: "stt-async-v6", language_hints: ["ru", "en"], enable_language_identification: true, enable_speaker_diarization: false });

	await until(() => top().startsWith("voice"));
	w.input("alt+w");
	await until(() => w.spawned.length === 2);
	expect([w.input("enter"), w.input("enter")]).toEqual([{ consume: true }, { consume: true }]);
	await until(() => w.sent.length);
	expect([w.sent, w.editor]).toEqual([["привет привет "], ""]);

	// Esc: ffmpeg is stopped, Soniox is not asked.
	await until(() => top().startsWith("voice"));
	const before = w.calls.length;
	w.input("alt+w");
	await until(() => w.spawned.length === 3);
	w.input("escape");
	expect([top().slice(0, 5), w.calls.length, w.input("enter"), w.input("escape")]).toEqual(["voice", before, undefined, undefined]);

	// A silent recording is an error, not a request.
	w.sound = wav(0);
	w.input("alt+w");
	await until(() => w.spawned.length === 4);
	w.input("alt+w");
	await until(() => w.notes.length);
	expect([w.notes, w.calls.length]).toEqual([[["voice: " + data.texts.silent, "error"]], before]);

	// ffmpeg dies by itself: the error is shown, the label is idle again.
	w.input("alt+w");
	await until(() => w.spawned.length === 5);
	w.spawned[4][2].close();
	await until(() => w.notes.length === 2);
	expect([w.notes[1][0], top().slice(0, 5)]).toEqual(["voice: " + data.texts.noAudio + " ", "voice"]);

	// A cancelled start launches nothing; a session switch cancels the recording.
	w.input("alt+w"); w.input("escape"); w.input("alt+w");
	await until(() => w.spawned.length === 6);
	await new Promise(next => setTimeout(next, 20));
	expect(w.spawned).toHaveLength(6);
	w.handlers.session_switch({}, w.ctx);
	expect(top().slice(0, 5)).toBe("voice");
});

test("/stt doctor names the missing key, then checks ffmpeg through the chain", async () => {
	const w = world();
	await w.command.handler("doctor", w.ctx);
	expect(w.notes).toEqual([["voice: " + data.texts.noKey + w.keyFile, "error"]]);
	writeFileSync(w.keyFile, "secret");
	await w.command.handler("doctor", w.ctx);
	expect(w.notes[1]).toEqual([data.texts.ready, "info"]);
	expect(w.calls[0][0]).toBe("powershell.exe");
	w.exec = { code: 1, stderr: "no ffmpeg" };
	await w.command.handler("doctor", w.ctx);
	expect(w.notes[2]).toEqual(["voice: ffmpeg: no ffmpeg", "error"]);
	// Without a key no recording starts.
	writeFileSync(w.keyFile, "");
	w.handlers.session_start({}, w.ctx);
	w.input("alt+w");
	await until(() => w.notes.length === 4);
	expect(w.spawned).toEqual([]);
});
