// Shared steps of scan, verify and probe. Run with bun. Nothing here imports product code: product files are read as data.
import { chmodSync, cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

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
/** Tools of a request in any provider shape: name -> { description, fields }. */
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
function imports(repo, manifest, engine) {
	const found = {}, add = (spec, names) => (found[spec] = [...new Set([...(found[spec] ?? []), ...names])]);
	for (const { from } of manifest.files.filter(file => file.from.endsWith(".js"))) {
		const text = read(`${repo}/${from}`);
		for (const [, names, spec] of text.matchAll(/import\s*\{([^}]+)\}\s*from\s*"(@oh-my-pi\/[^"]+)"/g)) add(spec, names.split(",").map(name => name.trim().split(/\s+as\s+/)[0]).filter(Boolean));
		for (const [, spec] of text.matchAll(/import\("(@oh-my-pi\/[^"]+)"\)/g)) add(spec, spec.endsWith("pi-natives") ? Object.keys(engine) : contract.exports[spec] ?? []);
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
export const numberOf = (version, entry) => show(version, entry.path).match(new RegExp(entry.match))?.[1];
/** Every model id the config names: enabled, thresholds, roles. */
export const modelsOf = config => [...new Set([...config.enabledModels, ...Object.keys(config.compaction?.modelThresholds ?? {}), ...Object.values(config.modelRoles ?? {}).flatMap(role => role.split(",").map(id => id.trim().replace(/:\w+$/, "")))])];

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
	const reference = json(`${repo}/${contract.guard.reference}`), wanted = imports(repo, manifest, reference.engine);
	const probe = `${TMP}/imp-${version}.js`, impOut = `${TMP}/imp-${version}.json`;
	writeFileSync(probe, `import { writeFileSync } from "node:fs";\nconst out = {};\n${Object.entries(wanted).map(([spec, names]) =>
		`try { const m = await import(${JSON.stringify(spec)}); out[${JSON.stringify(spec)}] = Object.fromEntries(${JSON.stringify(names)}.map(n => [n, typeof m[n]])); } catch (error) { out[${JSON.stringify(spec)}] = String(error.message); }`).join("\n")}\nwriteFileSync(process.env.IMP_OUT, JSON.stringify(out));\nexport default function () {}\n`);
	const plain = snap(bin, agent, `${version}-native`, { native: true, extensions: [probe], env: { IMP_OUT: impOut } }), full = snap(bin, agent, `${version}-full`);
	for (const [spec, names] of Object.entries(json(impOut))) {
		if (typeof names === "string") row(`импорт ${spec}`, false, names);
		else for (const [name, kind] of Object.entries(names)) row(`импорт ${spec}: ${name}`, kind !== "undefined" && (!(name in reference.engine) || kind === reference.engine[name]), kind);
	}
	for (const name of events(repo, manifest)) row(`событие расширений ${name}`, show(version, "packages/coding-agent/src/extensibility/extensions/types.ts").includes(`"${name}"`));

	// guard reference and markers of our texts against the native texts
	const nativeTools = toolsOf(plain.payload), texts = json(`${repo}/${contract.guard.texts}`);
	for (const [name, want] of Object.entries(reference.tools)) {
		const tool = nativeTools[name], forms = [want, ...(want.alt ?? [])];
		row(`эталон сторожа: ${name} описание`, tool && forms.some(form => form.description && native(form.description) === native(tool.description)), tool ? "родной текст другой" : "тула нет");
		row(`эталон сторожа: ${name} поля`, tool && forms.some(form => form.fields?.join() === tool.fields), tool?.fields);
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

	// source anchors and numbers
	for (const entry of contract.source) row(`опора: ${entry.use}`, new RegExp(entry.has).test(show(version, entry.path)), `в ${entry.path} нет /${entry.has}/`);
	const ours = read(`${repo}/${contract.guard.texts}`);
	for (const entry of contract.numbers) {
		const value = numberOf(version, entry), text = entry.text.replace("{}", value);
		row(`число: ${text}`, value !== undefined && ours.includes(text), value === undefined ? `в ${entry.path} нет /${entry.match}/` : `в OMP ${value}, в наших текстах такой фразы нет`);
	}
	return { rows, bin, agent, config, manifest, plain, full, list, models };
}

export function report(title, rows) {
	const failed = rows.filter(item => !item.ok);
	return [`## ${title}: ${rows.length - failed.length} из ${rows.length}`, ...failed.map(item => `- FAIL ${item.id}${item.detail ? `: ${item.detail}` : ""}`)].join("\n");
}
