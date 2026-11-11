import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { killTree, launch } from "../../../../src/modules/voice-stt/pi-voice-stt/src/audio/launch.ts";

const root = join(import.meta.dir, "../../../..");
const bash = "C:\\Program Files\\Git\\bin\\bash.exe";

test("off the VDI the program starts as upstream does", () => {
	expect(launch("ffmpeg", ["-version"], {}, "darwin")).toEqual(["ffmpeg", ["-version"]]);
	expect(launch("ffmpeg", ["-version"], { OMPCLI_GIT_BASH: bash }, "linux")).toEqual(["ffmpeg", ["-version"]]);
	expect(launch("ffmpeg", ["-version"], {}, "win32")).toEqual(["ffmpeg", ["-version"]]);
	expect(killTree({ pid: 1 }, {}, "win32")).toBe(false);
});

test("on the VDI ffmpeg goes PowerShell -> login Git Bash -> ffmpeg, and bash gets every argument intact", () => {
	const args = ["-f", "dshow", "-i", "audio=Microphone (Citrix HDX Audio)", "C:\\Users\\o'k\\AppData\\Local\\Temp\\rec.wav", "\$HOME"];
	const [file, argv] = launch(process.execPath, args, { OMPCLI_GIT_BASH: bash }, "win32");
	expect(file).toBe("powershell.exe");
	expect(argv.slice(0, 3)).toEqual(["-NoLogo", "-NoProfile", "-Command"]);
	const command = argv[3];
	expect(command).not.toContain('"');
	expect(command.startsWith("& 'C:\\Program Files\\Git\\bin\\bash.exe' --login -i -c '")).toBe(true);
	// PowerShell turns '' back into ': what is left is the bash command.
	const inner = command.match(/ -c '(.*)'$/s)[1].replaceAll("''", "'");
	expect(inner.startsWith("exec ")).toBe(true);
	// Run that bash command here with printf in place of ffmpeg: it must see the arguments as given, slashes forward.
	const probe = inner.replace(/^exec '[^']*'/, "exec /usr/bin/printf '%s\\n'");
	const run = Bun.spawnSync(["bash", "-c", probe]);
	expect(run.stdout.toString().trimEnd().split("\n")).toEqual(args.map(value => value.replaceAll("\\", "/")));
});

test("only the launch lines differ from upstream v0.11.0", () => {
	const index = readFileSync(join(root, "src/modules/voice-stt/pi-voice-stt/src/index.ts"), "utf8");
	expect(index.match(/launch\(/g).length).toBe(2);
	for (const name of ["ffmpeg-recorder.ts", "stream-recorder.ts"]) {
		const text = readFileSync(join(root, "src/modules/voice-stt/pi-voice-stt/src/audio", name), "utf8");
		expect(text).toContain("spawn(...launch(config.ffmpegPath, args)");
		expect(text).toContain("if (killTree(child)) return;");
	}
	expect(JSON.parse(readFileSync(join(root, "src/modules/voice-stt/pi-voice-stt/package.json"), "utf8")).version).toBe("0.11.0");
});

test("both dictation configs use free chords and keep the key out of the file", () => {
	for (const name of ["stt.json", "stt.windows.json"]) {
		const config = JSON.parse(readFileSync(join(root, "src/modules/voice-stt", name), "utf8"));
		expect([config.keybind, config.profileKeybind]).toEqual(["alt+w", "alt+shift+s"]);
		expect(config.provider).toEqual({ type: "soniox", model: "stt-async-v5", apiKeyEnv: "SONIOX_API_KEY" });
		expect(JSON.stringify(config)).not.toMatch(/apiKey"|apiKeyFile/);
	}
	expect(JSON.parse(readFileSync(join(root, "src/modules/voice-stt/stt.windows.json"), "utf8")).capture.inputFormat).toBe("dshow");
});
