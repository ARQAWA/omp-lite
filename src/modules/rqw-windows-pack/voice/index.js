// RQW voice dictation, OMP 18.18.8. Lives only in an OMP CLI tab on Windows: ffmpeg records, Soniox transcribes.
import { spawn, spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { extractSegments, matchesKey, visibleWidth } from "@oh-my-pi/pi-tui";
import { CustomEditor } from "@oh-my-pi/pi-tui/prompt/custom-editor";
import data from "./stt.windows.json";

const FRAMES = ["•  ", " • ", "  •", " • "], MIN_BYTES = 4096, SILENCE = 3, text = data.texts;
const bashQuote = value => `'${value.replace(/'/g, "'\\''")}'`;
const psQuote = value => `'${value.replace(/'/g, "''")}'`;

// The VDI runs a bundled program only the way OMP itself does: PowerShell starts a login Git Bash, Git Bash
// starts the program. Slashes change in Windows paths only: a device name keeps its backslash. No double quotes.
export const launch = (bash, file, args) => {
	const inner = "exec " + [file, ...args].map(value => bashQuote(/^[A-Za-z]:\\|^\\\\/.test(value) ? value.replace(/\\/g, "/") : value)).join(" ");
	return ["powershell.exe", ["-NoLogo", "-NoProfile", "-Command", `& ${psQuote(bash)} --login -i -c ${psQuote(inner)}`]];
};

// Peak sample of a PCM16 WAV. A device without sound records zeros.
export const peak = audio => {
	for (let offset = 12; offset + 8 <= audio.length; ) {
		const size = audio.readUInt32LE(offset + 4), start = offset + 8;
		if (audio.toString("ascii", offset, offset + 4) !== "data") { offset = start + size + (size % 2); continue; }
		let max = 0;
		for (let at = start; at + 1 < Math.min(start + size, audio.length); at += 2) max = Math.max(max, Math.abs(audio.readInt16LE(at)));
		return max;
	}
	return 0;
};

// The label takes the left end of the top border; the rest of the line keeps its colors.
export const inject = (line, width, label) => {
	const used = visibleWidth(label) + 1;
	return used >= width ? line : `${label} ${extractSegments(line, 0, used, width - used, false).after}`;
};

// Soniox async: upload, order, poll, read, delete. The recognition settings come from the JSON as they are.
export async function transcribe(audio, key, signal, request = fetch) {
	const { baseUrl, pollMs, timeoutMs, ...settings } = data.soniox, headers = { Authorization: `Bearer ${key}` };
	const call = async (path, init = {}) => {
		const response = await request(baseUrl + path, { ...init, headers: { ...headers, ...init.headers }, signal });
		if (!response.ok) throw new Error(`Soniox ${response.status}: ${(await response.text()).slice(0, 200)}`);
		return response.json();
	};
	const drop = path => request(baseUrl + path, { method: "DELETE", headers, signal: AbortSignal.timeout(5000) }).catch(() => {});
	const form = new FormData();
	form.append("file", new Blob([audio], { type: "audio/wav" }), "rec.wav");
	const file = await call("/v1/files", { method: "POST", body: form });
	let job;
	try {
		job = await call("/v1/transcriptions", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...settings, file_id: file.id }) });
		for (const end = Date.now() + timeoutMs; ; await new Promise(done => setTimeout(done, pollMs))) {
			const { status, error_message } = await call(`/v1/transcriptions/${job.id}`);
			if (status === "completed") break;
			if (status === "error" || Date.now() > end) throw new Error(`Soniox: ${error_message || "timed out"}`);
		}
		return (await call(`/v1/transcriptions/${job.id}/transcript`)).text.trim();
	} finally {
		if (job) await drop(`/v1/transcriptions/${job.id}`);
		await drop(`/v1/files/${file.id}`);
	}
}

export default function voice(pi, { env = process.env, platform = process.platform, run = spawn, request } = {}) {
	const bash = platform === "win32" && env.OMPCLI_GIT_BASH;
	if (!bash) return;
	let mode = "idle", tick = 0, timer, tui, live, job, unsubscribe;

	const setMode = next => {
		mode = next;
		clearInterval(timer);
		timer = next === "idle" ? undefined : setInterval(() => { tick++; tui?.requestRender(); }, 120);
		tui?.requestRender();
	};
	const label = theme => {
		if (mode === "idle") return `${theme.fg("dim", text.idle)} ${theme.fg("accent", data.keybind)}`;
		const [color, mark] = mode === "recording" ? ["error", tick % 2 ? "○" : "●"] : ["warning", FRAMES[tick % FRAMES.length]];
		return `${theme.fg(color, `${mark} ${text[mode]}`)} ${theme.fg("dim", text[mode + "Hint"])}`;
	};
	// The key file is read on every recording: the owner may write it while the tab is open.
	const readKey = async () => {
		const file = JSON.parse(await readFile(env.PI_STT_CONFIG, "utf8")).provider.apiKeyFile;
		const key = (await readFile(file, "utf8").catch(() => "")).trim();
		if (!key) throw new Error(text.noKey + file);
		return key;
	};
	const ffmpeg = args => launch(bash, "ffmpeg", args);

	const start = async () => {
		setMode("recording");
		const key = await readKey(), dir = await mkdtemp(join(tmpdir(), "rqw-voice-")), file = join(dir, "rec.wav");
		// Esc came while the key was read: nothing is started.
		if (mode !== "recording") return rm(dir, { recursive: true, force: true });
		const child = run(...ffmpeg(["-hide_banner", "-loglevel", "warning", "-f", "dshow", "-audio_buffer_size", "20", "-i", data.input, "-vn", "-acodec", "pcm_s16le", "-ar", "16000", "-ac", "1", "-y", file]), { stdio: ["pipe", "ignore", "pipe"] });
		const rec = { key, dir, file, child, log: "", closed: new Promise(done => child.once("close", done).once("error", done)) };
		child.stderr.on("data", chunk => (rec.log = (rec.log + chunk).slice(-2000)));
		job = rec;
	};
	const halt = async rec => {
		try { rec.child.stdin.end("q\n"); } catch {}
		// Killing PowerShell alone can leave ffmpeg holding the microphone.
		const kill = setTimeout(() => spawnSync("taskkill", ["/T", "/F", "/PID", String(rec.child.pid)], { windowsHide: true }), 3000);
		await rec.closed;
		clearTimeout(kill);
	};
	const finish = async (ctx, send) => {
		const rec = job, abort = new AbortController(), mine = (job = { abort });
		setMode("transcribing");
		try {
			await halt(rec);
			const audio = await readFile(rec.file).catch(() => { throw new Error(`${text.noAudio} ${rec.log}`); });
			if (audio.length < MIN_BYTES || peak(audio) <= SILENCE) throw new Error(text.silent);
			const words = await transcribe(audio, rec.key, abort.signal, request);
			if (abort.signal.aborted) return;
			ctx.ui.setEditorText(`${ctx.ui.getEditorText()}${words} `);
			const prompt = send && ctx.ui.getEditorText().trimEnd();
			if (!prompt) return;
			ctx.ui.setEditorText("");
			await pi.sendUserMessage(prompt, ctx.isIdle() ? undefined : { deliverAs: "followUp" });
		} catch (error) {
			if (!abort.signal.aborted) throw error;
		} finally {
			await rm(rec.dir, { recursive: true, force: true });
			if (job === mine) { job = undefined; setMode("idle"); }
		}
	};
	const cancel = async () => {
		const rec = job;
		job = undefined;
		setMode("idle");
		rec?.abort?.abort();
		if (!rec?.child) return;
		await halt(rec);
		await rm(rec.dir, { recursive: true, force: true });
	};
	const guard = (ctx, work) => void work.catch(error => {
		job = undefined;
		setMode("idle");
		ctx.ui.notify(`${text.title}: ${error.message}`, "error");
	});
	const press = (ctx, input) => {
		if (matchesKey(input, data.keybind)) {
			if (mode === "idle") guard(ctx, start());
			else if (job?.child) guard(ctx, finish(ctx));
		} else if (job?.child && matchesKey(input, "enter")) guard(ctx, finish(ctx, true));
		else if (mode !== "idle" && matchesKey(input, "escape")) guard(ctx, cancel());
		else return;
		return { consume: true };
	};

	const attach = (_event, ctx) => {
		unsubscribe?.();
		unsubscribe = undefined;
		if (ctx.mode !== "tui" || !ctx.hasUI) return;
		live = ctx;
		unsubscribe = ctx.ui.onTerminalInput(input => press(ctx, input));
		const previous = ctx.ui.getEditorComponent();
		if (previous?.voice) return;
		const factory = (ui, theme, keys) => {
			tui = ui;
			const editor = previous?.(ui, theme, keys) ?? new CustomEditor(theme);
			const render = editor.render.bind(editor);
			editor.render = width => {
				const lines = render(width);
				if (lines.length) lines[0] = inject(lines[0], width, label(live.ui.theme));
				return lines;
			};
			return editor;
		};
		factory.voice = true;
		ctx.ui.setEditorComponent(factory);
	};
	for (const event of ["session_start", "session_switch", "session_branch"]) pi.on(event, attach);
	pi.on("session_shutdown", () => { unsubscribe?.(); unsubscribe = undefined; return cancel(); });

	pi.registerCommand("stt", {
		description: text.command,
		handler: async (_args, ctx) => {
			try {
				await readKey();
				const probe = await pi.exec(...ffmpeg(["-version"]), { timeout: 5000 });
				if (probe.code !== 0) throw new Error(`ffmpeg: ${probe.stderr || probe.stdout}`);
				ctx.ui.notify(text.ready, "info");
			} catch (error) {
				ctx.ui.notify(`${text.title}: ${error.message}`, "error");
			}
		},
	});
}
