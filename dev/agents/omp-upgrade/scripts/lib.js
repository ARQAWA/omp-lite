// Shared steps of scan, verify and probe. Run with bun. Nothing here imports product code: product files are read as data.
import { chmodSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

export const TMP = process.env.OMP_UP ?? "/tmp/omp-up";
export const SRC = process.env.OMP_SRC ?? `${process.env.HOME}/ai-project/omp-src`;
export const HERE = dirname(new URL(import.meta.url).pathname);
export const read = path => readFileSync(path, "utf8");
export const json = path => JSON.parse(read(path));
export const contract = json(`${HERE}/../contract.json`);
export const arg = (name, fallback) => (process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : fallback);

export function run(cmd, { cwd, env, timeout = 180_000 } = {}) {
	const done = Bun.spawnSync({ cmd, cwd, env: { ...process.env, ...env }, timeout, stdout: "pipe", stderr: "pipe" });
	return { code: done.exitCode, out: done.stdout.toString(), err: done.stderr.toString() };
}

// ---- OMP sources: the shared clone, read by tag, never switched ----

const git = (...args) => run(["git", "-C", SRC, ...args]);
export function source(version) {
	if (git("rev-parse", "-q", "--verify", `refs/tags/v${version}`).code) git("fetch", "-q", "--depth", "1", "origin", "tag", `v${version}`);
	if (git("rev-parse", "-q", "--verify", `refs/tags/v${version}`).code) throw new Error(`no tag v${version} in ${SRC}`);
}
export const show = (version, path) => git("show", `v${version}:${path}`).out;
export const changed = (old, neu, paths) => git("diff", "--stat", `v${old}`, `v${neu}`, "--", ...paths).out.trim();

// ---- OMP binaries: from the release, checked by its digest ----

const sha256 = path => new Bun.CryptoHasher("sha256").update(readFileSync(path)).digest("hex");
export function release(version) {
	const cache = `${TMP}/release-${version}.json`;
	if (!existsSync(cache)) {
		const answer = run(["gh", "api", `repos/can1357/oh-my-pi/releases/tags/v${version}`]);
		if (answer.code) throw new Error(`no release v${version}: ${answer.err.trim()}`);
		mkdirSync(TMP, { recursive: true });
		writeFileSync(cache, answer.out);
	}
	return Object.fromEntries(json(cache).assets.map(asset => [asset.name, { url: asset.browser_download_url, size: asset.size, sha256: asset.digest.replace("sha256:", "") }]));
}
export function binary(version) {
	const asset = release(version)[`omp-${process.platform}-${process.arch}`], path = `${TMP}/omp-${version}`;
	const installed = run(["which", "omp"]).out.trim();
	if (installed && sha256(installed) === asset.sha256) return installed;
	if (!existsSync(path) || sha256(path) !== asset.sha256) {
		if (run(["curl", "-fsSL", "-o", path, asset.url], { timeout: 900_000 }).code || sha256(path) !== asset.sha256) throw new Error(`binary ${version}: download or digest failed`);
		chmodSync(path, 0o755);
	}
	return path;
}

// ---- the harness as the manifest installs it, in a scratch agent directory ----

const merge = (into, from) => {
	for (const [key, value] of Object.entries(from)) into[key] = value && typeof value === "object" && !Array.isArray(value) ? merge(into[key] ?? {}, value) : value;
	return into;
};
export function stage(repo, dir) {
	const manifest = json(`${repo}/install.manifest.json`);
	rmSync(dir, { recursive: true, force: true });
	for (const { from, to } of manifest.files) {
		mkdirSync(dirname(`${dir}/${to}`), { recursive: true });
		cpSync(`${repo}/${from}`, `${dir}/${to}`);
	}
	const config = manifest.config.reduce((all, part) => merge(all, Bun.YAML.parse(read(`${repo}/${part.from}`))), {});
	// JSON is YAML.
	writeFileSync(`${dir}/config.yml`, JSON.stringify(config, null, 1));
	return { dir, config, manifest };
}

/** A real candidate and the staged harness: the prediction must survive the visible, saved timer row. */
export async function composer(bin, repo) {
	const id = "composer: метка сохранена, подсказка видна", requests = [];
	const input = "Explain the tiny composer fixture.", followup = "Check the saved timer.", answer = "The fixture worked.", followupAnswer = "The second turn worked.", prediction = "Please show the next step.";
	const model = "claude-sonnet-5-5", decoder = new TextDecoder();
	let dir, child, server, release, output = "", returned = false, mark, failure = "";
	const barrier = new Promise(resolve => { release = resolve; });
	const assert = (ok, message) => { if (!ok) throw new Error(message); };
	const screen = () => output.replace(/\x1b\[[0-?]*[ -/]*[@-~]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)|\x1b[=>]/g, "");
	const until = async (condition, timeout, message) => {
		const end = Date.now() + timeout;
		while (Date.now() < end) {
			if (condition()) return;
			if (child?.exitCode != null) throw new Error(`OMP завершился: ${child.exitCode}`);
			await Bun.sleep(20);
		}
		throw new Error(`${message}: ${screen().slice(-250)}`);
	};
	try {
		dir = mkdtempSync(join(tmpdir(), "omp-composer-"));
		const home = join(dir, "home"), agent = join(dir, "agent"), work = join(dir, "work");
		mkdirSync(home); mkdirSync(work);
		const { config } = stage(repo, agent);
		assert(config.composer?.predictions === true && config.composer?.predictionAlternatives === false, "нужен composer с одной подсказкой");
		config.models = { ...config.models, offline: true };
		config.providers = { ...config.providers, cacheWarming: "off" };
		writeFileSync(join(agent, "config.yml"), JSON.stringify(config));
		server = Bun.serve({ hostname: "127.0.0.1", port: 0, async fetch(request) {
			const wire = JSON.stringify(await request.json()), side = wire.includes("<composer-prediction>");
			const serial = requests.push({ wire, side });
			if (side) {
				const timer = setTimeout(() => release(false), 12_000), ready = await barrier;
				clearTimeout(timer);
				if (!ready) return new Response("timer row not ready", { status: 504 });
				returned = true;
			}
			const usage = { input_tokens: 10, output_tokens: 7 };
			const events = [
				{ type: "message_start", message: { id: `msg_${serial}`, type: "message", role: "assistant", content: [], model, stop_reason: null, usage } },
				{ type: "content_block_start", index: 0, content_block: { type: "text", text: "" } },
				{ type: "content_block_delta", index: 0, delta: { type: "text_delta", text: side ? prediction : wire.includes(followup) ? followupAnswer : answer } },
				{ type: "content_block_stop", index: 0 },
				{ type: "message_delta", delta: { stop_reason: "end_turn", stop_sequence: null }, usage },
				{ type: "message_stop" },
			];
			return new Response(events.map(event => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`).join(""), { headers: { "content-type": "text/event-stream" } });
		} });
		child = Bun.spawn([resolve(bin), "--model", `anthropic/${model}`], {
			cwd: work,
			env: { PATH: "/usr/bin:/bin:/usr/sbin:/sbin", HOME: home, TMPDIR: dir, PI_CODING_AGENT_DIR: agent, TERM: "xterm-256color", LANG: "en_US.UTF-8", ANTHROPIC_BASE_URL: `http://127.0.0.1:${server.port}`, ANTHROPIC_API_KEY: "sk-ant-fake", NO_PROXY: "127.0.0.1,localhost" },
			terminal: { cols: 140, rows: 40, data(_terminal, bytes) { output += decoder.decode(bytes, { stream: true }); } },
		});
		await until(() => screen().includes(contract.tui.status), 8_000, "TUI не открылся");
		child.terminal.write(input);
		await until(() => screen().includes(input), 4_000, "ввод не появился в TUI");
		child.terminal.write("\r");
		await until(() => {
			const visible = screen();
			if (!visible.includes(answer)) return false;
			for (const file of new Bun.Glob("sessions/**/*.jsonl").scanSync({ cwd: agent })) {
				const lines = read(join(agent, file)).split("\n"); lines.pop();
				let entries;
				try { entries = lines.filter(Boolean).map(line => JSON.parse(line)); } catch { continue; }
				const reply = entries.findIndex(entry => entry.type === "message" && entry.message?.role === "assistant" && JSON.stringify(entry.message.content).includes(answer));
				if (reply < 0) continue;
				mark = entries.slice(reply + 1).find(entry => entry.type === "custom_message" && entry.customType === "omp-lite.turn-duration" && entry.display === true && typeof entry.content?.[0]?.text === "string" && entry.content[0].text.startsWith(`${contract.tui.turnMark} `) && visible.includes(entry.content[0].text));
				if (mark) return true;
			}
			return false;
		}, 10_000, "ответ или сохранённая метка не видны");
		assert(requests.some(request => !request.side && request.wire.includes(input)), "нет обычного запроса");
		await until(() => requests.some(request => request.side && request.wire.includes(answer)), 3_000, "нет побочного запроса с ответом");
		release(true);
		await until(() => returned && screen().includes(prediction), 4_000, "подсказка не показана");
		assert(mark.excludeFromContext === true, "у сохранённой метки нет флага");
		child.terminal.write(followup);
		await until(() => screen().includes(followup), 4_000, "повторный ввод не появился в TUI");
		child.terminal.write("\r");
		await until(() => requests.some(request => !request.side && request.wire.includes(followup) && request.wire.includes(answer)), 8_000, "нет следующего обычного запроса");
		await until(() => requests.some(request => request.side && request.wire.includes(followup) && request.wire.includes(followupAnswer)), 8_000, "нет следующего побочного запроса с ответом");
	} catch (error) {
		failure = String(error.message ?? error);
	} finally {
		release(false);
		if (child) {
			let timer;
			try {
				if (child.exitCode === null) child.kill("SIGKILL");
				await Promise.race([child.exited, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error("OMP не завершился")), 2_000); })]);
			} catch (error) { failure ||= String(error.message ?? error); }
			clearTimeout(timer);
			try { child.terminal?.close(); } catch (error) { failure ||= String(error.message ?? error); }
		}
		try { await server?.stop(true); } catch (error) { failure ||= String(error.message ?? error); }
		try { if (dir) rmSync(dir, { recursive: true, force: true }); } catch (error) { failure ||= String(error.message ?? error); }
	}
	if (!failure && requests.some(request => request.wire.includes(mark.content[0].text) || request.wire.includes(`${contract.tui.turnMark} `))) failure = "метка попала в запрос";
	return { id, ok: !failure, detail: failure };
}

/** One request, caught before it is sent: a fake key and a scratch agent directory. */
export function snap(bin, agent, name, { native = false, extensions = [], env = {} } = {}) {
	const out = `${TMP}/cap-${name}.json`, proj = `${TMP}/proj`;
	if (!existsSync(`${proj}/.git`)) run(["git", "init", "-q", proj]);
	rmSync(out, { force: true });
	const cmd = [bin, "-p", "--no-session", ...(native ? ["--no-extensions"] : []), ...[...extensions, `${HERE}/tap.js`].flatMap(path => ["-e", path]), "--model", contract.snapshotModel, "say ok"];
	const done = run(cmd, { cwd: proj, env: { PI_CODING_AGENT_DIR: agent, TAP_OUT: out, ANTHROPIC_API_KEY: "sk-ant-fake", ...env } });
	if (!existsSync(out)) throw new Error(`no snapshot ${name}: ${(done.err || done.out).slice(-400)}`);
	return json(out);
}

export const bare = name => String(name).replace(/^_/, "");
/** Tools of a provider request in any supported shape: name -> description and fields. */
export function toolsOf(payload) {
	const list = [payload?.tools, payload?.config?.tools, payload?.request?.tools].filter(Array.isArray).flat().flatMap(tool => tool?.functionDeclarations ?? [tool?.function ?? tool?.toolSpec ?? tool]);
	return Object.fromEntries(list.filter(tool => typeof tool?.name === "string").map(tool => {
		const schema = tool.parameters ?? tool.input_schema ?? tool.inputSchema?.json ?? tool.inputSchema ?? {};
		return [bare(tool.name), { description: String(tool.description ?? ""), fields: Object.keys(schema.properties ?? {}).sort().join() }];
	}));
}
const count = (text, part) => text.split(part).length - 1;
/** The harness lines that must be in the request and the native lines that must not come back. */
export function wire(payload, row) {
	const tools = toolsOf(payload), body = JSON.stringify(payload.messages ?? payload.input ?? payload.contents ?? "");
	for (const name of contract.wire.tools) row(`запрос: тул ${name}`, name in tools);
	for (const part of contract.wire.messages) row(`запрос: памятка «${part}»`, body.includes(part));
	for (const [name, want] of Object.entries(contract.wire)) {
		const text = tools[name]?.description;
		if (Array.isArray(want)) continue;
		if (text === undefined) { row(`запрос: тул ${name}`, false, "тула нет"); continue; }
		for (const part of want.once ?? []) row(`запрос: ${name} «${part.slice(0, 40)}» один раз`, count(text, part) === 1, `найдено ${count(text, part)}`);
		for (const part of want.never ?? []) row(`запрос: ${name} без «${part}»`, !text.includes(part));
		if (want.starts) row(`запрос: ${name} начинается с нашего текста`, [].concat(want.starts).some(start => text.startsWith(start)), text.slice(0, 60));
	}
}

// As the guard of rqw-base-tools compares: the platform list of builtins and the hashline line are not a change.
export const native = text => String(text).replace(/^In-process builtins, ahead of PATH: .*$|^- Selected file: .*\n/m, "").trim();

/** Imports of OMP packages in the shipped .js files: specifier -> names. */
function imports(repo, manifest, reference) {
	const found = {}, add = (spec, names) => (found[spec] = [...new Set([...(found[spec] ?? []), ...names])]);
	for (const { from } of manifest.files.filter(file => file.from.endsWith(".js"))) {
		const text = read(`${repo}/${from}`);
		for (const [, names, spec] of text.matchAll(/import\s*\{([^}]+)\}\s*from\s*"(@oh-my-pi\/[^"]+)"/g)) add(spec, names.split(",").map(name => name.trim().split(/\s+as\s+/)[0]).filter(Boolean));
		for (const [, spec] of text.matchAll(/import\("(@oh-my-pi\/[^"]+)"\)/g)) add(spec, spec.endsWith("pi-natives") ? Object.keys(reference.engine) : spec.endsWith("output-meta") ? Object.keys(reference.notice ?? {}) : contract.exports[spec] ?? []);
	}
	return found;
}
const events = (repo, manifest) => [...new Set(manifest.files.filter(file => file.from.endsWith(".js")).flatMap(({ from }) => {
	const text = read(`${repo}/${from}`);
	return [...text.matchAll(/pi\.on\("(\w+)"/g), ...text.matchAll(/for \(const event of \[([^\]]+)\]\) pi\.on\(event/g)].flatMap(found => found[1].match(/\w+/g));
}))];
const leaves = (value, path = []) => (value && typeof value === "object" && !Array.isArray(value) ? Object.entries(value).flatMap(([key, inner]) => leaves(inner, [...path, key])) : [[path, value]]);
export const settingsOf = (bin, agent) => JSON.parse(run([bin, "config", "list", "--json"], { env: { PI_CODING_AGENT_DIR: agent } }).out);
/** Setting id of a config path: the longest known prefix; the rest of the path goes into the value. */
export function settingOf(list, path) {
	for (let cut = path.length; cut > 0; cut--) {
		const id = path.slice(0, cut).join(".");
		if (id in list) return { id, value: path.slice(cut).reduce((value, key) => value?.[key], list[id].value) };
	}
}
/** The `register({ ... })` block of a setting in the sources of a version. */
export function registration(version, id) {
	const file = git("grep", "-l", "-F", `id: "${id}"`, `v${version}`, "--", "packages/coding-agent/src").out.split("\n")[0]?.split(":").slice(1).join(":");
	if (!file) return "";
	const text = show(version, file), at = text.indexOf(`id: "${id}"`);
	return text.slice(text.lastIndexOf("register(", at), text.indexOf("});", at));
}
export const providerIds = version => [...show(version, contract.providers.ids).matchAll(/\|\s*"([^"]+)"/g)].map(found => found[1]);
/** Exact selectors the config names; startup scope globs are not model ids. */
export const modelsOf = config => [...new Set([...config.enabledModels, ...Object.keys(config.compaction?.modelThresholds ?? {}), ...Object.values(config.modelRoles ?? {}).flatMap(role => role.split(",").map(id => id.trim().replace(/:\w+$/, "")))])].filter(id => !/[*?[]/.test(id));

/**
 * The harness of `repo` against OMP `version`: every reliance of the harness on OMP, one row each.
 * A row: { id, ok, detail }. Scan runs it for the new version, verify for the installed one.
 */
export function check(version, repo) {
	source(version);
	const bin = binary(version), { dir: agent, config, manifest } = stage(repo, `${TMP}/agent-${version}`);
	const rows = [], row = (id, ok, detail = "") => rows.push({ id, ok: Boolean(ok), detail: ok ? "" : String(detail) });
	row(`бинарь отвечает omp/${version}`, run([bin, "--version"]).out.trim() === `omp/${version}`);

	// imports: one extension that loads every OMP module the harness loads
	const reference = json(`${repo}/${contract.guard.reference}`), wanted = imports(repo, manifest, reference), kinds = { ...reference.engine, ...reference.notice };
	const probe = `${TMP}/imp-${version}.js`, impOut = `${TMP}/imp-${version}.json`, classes = { read: "ReadTool", grep: "GrepTool", glob: "GlobTool" };
	rmSync(impOut, { force: true });
	writeFileSync(probe, `import { writeFileSync } from "node:fs";\nconst out = {}, classes = {};\n${Object.entries(wanted).map(([spec, names]) => {
		const name = Object.keys(classes).find(name => spec === `@oh-my-pi/pi-coding-agent/tools/${name}`);
		return `try { const m = await import(${JSON.stringify(spec)}); out[${JSON.stringify(spec)}] = Object.fromEntries(${JSON.stringify(names)}.map(n => [n, typeof n.split(".").reduce((v, k) => v?.[k], m)])); ${name ? `classes[${JSON.stringify(name)}] = m[${JSON.stringify(classes[name])}];` : ""} } catch (error) { out[${JSON.stringify(spec)}] = String(error.message); }`;
	}).join("\n")}\nexport default function (pi) { pi.on("session_start", (_event, ctx) => {\nconst session = { cwd: ctx.cwd, settings: pi.pi.settings, hasEditTool: true, getSessionSpawns: () => "*" }, schemas = {}, errors = {};\nfor (const name of ${JSON.stringify(Object.keys(classes))}) try { const tool = new classes[name](session); schemas[name] = tool.parameters.toJsonSchema(); } catch (error) { errors[name] = String(error.message); }\nwriteFileSync(process.env.IMP_OUT, JSON.stringify({ imports: out, schemas, errors }));\n}); }\n`);
	const plain = snap(bin, agent, `${version}-native`, { native: true, extensions: [probe], env: { IMP_OUT: impOut } }), full = snap(bin, agent, `${version}-full`);
	const captured = json(impOut);
	for (const [spec, names] of Object.entries(captured.imports)) {
		if (typeof names === "string") row(`импорт ${spec}`, false, names);
		else for (const [name, kind] of Object.entries(names)) row(`импорт ${spec}: ${name}`, kind !== "undefined" && (!(name in kinds) || kind === kinds[name]), kind);
	}
	for (const name of events(repo, manifest)) row(`событие расширений ${name}`, show(version, "packages/coding-agent/src/extensibility/extensions/types.ts").includes(`"${name}"`));

	// guard reference and markers of our texts against the native texts
	const nativeTools = toolsOf(plain.payload), texts = json(`${repo}/${contract.guard.texts}`);
	for (const [name, want] of Object.entries(reference.tools)) {
		const tool = nativeTools[name], forms = [want, ...(want.alt ?? [])];
		row(`эталон сторожа: ${name} описание`, tool && forms.some(form => form.description && native(form.description) === native(tool.description)), tool ? "родной текст другой" : "тула нет");
		row(`эталон сторожа: ${name} поля`, tool && forms.some(form => form.fields?.join() === tool.fields), tool?.fields);
		if (want.schema) row(`эталон сторожа: ${name} схема`, captured.schemas[name] && JSON.stringify(want.schema) === JSON.stringify(captured.schemas[name]), captured.errors[name] ?? JSON.stringify(captured.schemas[name]));
	}
	for (const [name, parts] of Object.entries(texts.native)) {
		const marker = [].concat(parts).at(-1)?.native;
		if (marker) row(`маркер родного хвоста ${name}: «${marker}»`, nativeTools[name]?.description.includes(marker));
	}
	wire(full.payload, row);

	// settings: our keys are known and take effect
	const list = settingsOf(bin, agent);
	for (const [path, value] of leaves(config)) {
		const setting = settingOf(list, path);
		row(`настройка ${path.join(".")}`, setting && JSON.stringify(setting.value) === JSON.stringify(value), setting ? `действует ${JSON.stringify(setting.value)}, у нас ${JSON.stringify(value)}` : "OMP такой настройки не знает");
	}

	// providers; the models of the config that the built-in catalog knows (live catalogs need a login: probe checks them)
	const ids = providerIds(version), disabled = new Set(config.disabledProviders), open = ids.filter(id => !disabled.has(id));
	row("открыты только разрешённые провайдеры", open.sort().join() === [...contract.providers.open].sort().join(), `открыты: ${open.join(", ")}`);
	const catalog = new Set(full.models ?? []);
	const models = modelsOf(config).filter(id => catalog.has(id));

	// source anchors
	for (const entry of contract.source) row(`опора: ${entry.use}`, new RegExp(entry.has).test(show(version, entry.path)), `в ${entry.path} нет /${entry.has}/`);
	return { rows, bin, agent, config, manifest, plain, full, list, models };
}

export function report(title, rows) {
	const failed = rows.filter(item => !item.ok);
	return [`## ${title}: ${rows.length - failed.length} из ${rows.length}`, ...failed.map(item => `- FAIL ${item.id}${item.detail ? `: ${item.detail}` : ""}`)].join("\n");
}
