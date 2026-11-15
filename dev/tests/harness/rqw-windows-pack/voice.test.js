import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { killTree, launch } from "../../../../src/modules/rqw-windows-pack/voice/src/audio/launch.ts";

const voice = join(import.meta.dir, "../../../../src/modules/rqw-windows-pack/voice");
const bash = "C:\\Program Files\\Git\\bin\\bash.exe";
const json = name => JSON.parse(readFileSync(join(voice, name), "utf8"));

test("off the VDI ffmpeg starts as in the original plugin", () => {
	for (const [env, platform] of [[{}, "darwin"], [{ OMPCLI_GIT_BASH: bash }, "linux"], [{}, "win32"]]) expect(launch("ffmpeg", ["-version"], env, platform)).toEqual(["ffmpeg", ["-version"]]);
	expect(killTree({ pid: 1 }, {}, "win32")).toBe(false);
});

test("on the VDI ffmpeg goes PowerShell -> login Git Bash -> ffmpeg; slashes change in paths only", () => {
	const args = ["-f", "dshow", "-i", "audio=USB\\Mic (o'k)", "C:\\Users\\o'k\\Temp\\rec.wav", "$HOME"];
	const [file, argv] = launch("C:\\ext\\runtime\\ffmpeg.exe", args, { OMPCLI_GIT_BASH: bash }, "win32");
	expect([file, argv.slice(0, 3)]).toEqual(["powershell.exe", ["-NoLogo", "-NoProfile", "-Command"]]);
	expect(argv[3]).not.toContain('"');
	expect(argv[3]).toStartWith("& 'C:\\Program Files\\Git\\bin\\bash.exe' --login -i -c 'exec ''C:/ext/runtime/ffmpeg.exe'' ");
	// PowerShell turns '' back into '. Bash then runs the command: printf in place of ffmpeg shows what it would get.
	const inner = argv[3].match(/ -c '(.*)'$/s)[1].replaceAll("''", "'").replace(/^exec '[^']*'/, "exec /usr/bin/printf '%s\\n'");
	expect(Bun.spawnSync(["bash", "-c", inner]).stdout.toString().trimEnd().split("\n")).toEqual(["-f", "dshow", "-i", "audio=USB\\Mic (o'k)", "C:/Users/o'k/Temp/rec.wav", "$HOME"]);
});

test("stopping a recording kills the process tree; a failed taskkill falls back to the usual stop", () => {
	const calls = [];
	const run = result => (...call) => (calls.push(call), result);
	const results = [[{ status: 0 }, true], [{ status: 1 }, false], [{ status: null, error: new Error("missing") }, false]];
	for (const [result, expected] of results) expect(killTree({ pid: 42 }, { OMPCLI_GIT_BASH: bash }, "win32", run(result))).toBe(expected);
	expect(calls[0]).toEqual(["taskkill", ["/T", "/F", "/PID", "42"], { windowsHide: true }]);
});

test("OMP sees the plugin as pi-voice-stt: the entry file sits in the plugin root", () => {
	expect(json("package.json").pi.extensions).toEqual(["./index.ts"]);
	expect(json("package.json").version).toBe("0.11.0");
	expect(readFileSync(join(voice, "index.ts"), "utf8")).toBe('export { default } from "./src/index.ts";\n');
});

test("both configs use the free chords and Soniox, keep the key out, and differ in the microphone only", () => {
	const [mac, vdi] = ["stt.json", "stt.windows.json"].map(json);
	expect({ ...vdi, capture: mac.capture }).toEqual(mac);
	expect(mac).toEqual({ keybind: "alt+w", profileKeybind: "alt+shift+s", provider: { type: "soniox", model: "stt-async-v5", apiKeyEnv: "SONIOX_API_KEY" }, capture: { input: ":MacBook Air Microphone" } });
	expect(vdi.capture.inputFormat).toBe("dshow");
});
