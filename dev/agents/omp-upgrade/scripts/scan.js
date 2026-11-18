// What an OMP update breaks, changes and adds for the harness. bun scan.js <old> <new> [--repo <checkout>].
// The harness is taken as it is in the checkout and run against both versions. The report goes to $OMP_UP/scan.md.
import { existsSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { arg, changed, check, contract, numberOf, providerIds, registration, release, run, settingOf, SRC, TMP, toolsOf } from "./lib.js";

const [old, neu] = process.argv.slice(2), repo = resolve(arg("--repo", process.cwd()));
const before = check(old, repo), after = check(neu, repo);
const out = { broken: [], regress: [], changed: [], fresh: [] };

// Broken: a gate that fails on the new version. A gate that failed before too is the debt of the checkout, not of this update.
const failedBefore = new Set(before.rows.filter(item => !item.ok).map(item => item.id));
for (const item of after.rows.filter(item => !item.ok)) (failedBefore.has(item.id) ? out.regress : out.broken).push(`${item.id}${item.detail ? `: ${item.detail}` : ""}`);

// The request: native texts and the final request, old against new.
const dated = text => text.replace(/\d{4}-\d{2}-\d{2}/g, "DATE");
const diff = (name, a, b) => {
	writeFileSync(`${TMP}/d-${name}-old.txt`, a);
	writeFileSync(`${TMP}/d-${name}-new.txt`, b);
	return `${TMP}/d-${name}-{old,new}.txt`;
};
for (const [kind, a, b] of [["native", before.plain.payload, after.plain.payload], ["full", before.full.payload, after.full.payload]]) {
	const was = toolsOf(a), now = toolsOf(b);
	for (const name of new Set([...Object.keys(was), ...Object.keys(now)])) {
		if (!(name in was)) out.fresh.push(`${kind}: новый тул ${name}`);
		else if (!(name in now)) out.changed.push(`${kind}: тул ${name} пропал`);
		else if (was[name].description !== now[name].description) out.changed.push(`${kind}: описание ${name} другое, ${diff(`${kind}-${name}`, was[name].description, now[name].description)}`);
		else if (was[name].fields !== now[name].fields) out.changed.push(`${kind}: поля ${name}: ${was[name].fields} -> ${now[name].fields}`);
	}
	const text = payload => dated([].concat(payload.system ?? []).map(block => block.text ?? block).join("\n----\n"));
	if (text(a) !== text(b)) out.changed.push(`${kind}: системный промпт другой, ${diff(`${kind}-system`, text(a), text(b))}`);
	const messages = payload => dated(JSON.stringify(payload.messages, null, 1));
	if (messages(a) !== messages(b)) out.changed.push(`${kind}: сообщения другие, ${diff(`${kind}-messages`, messages(a), messages(b))}`);
}

// Settings: ours keep their registration; the others keep their effective values.
const ours = new Set();
const walk = (value, path = []) => (value && typeof value === "object" && !Array.isArray(value) ? Object.entries(value).flatMap(([key, inner]) => walk(inner, [...path, key])) : [path]);
for (const path of walk(after.config)) {
	const id = (settingOf(after.list, path) ?? settingOf(before.list, path))?.id;
	if (!id || ours.has(id)) continue;
	ours.add(id);
	if (registration(old, id) !== registration(neu, id)) out.changed.push(`настройка ${id}: регистрация в исходниках другая (тип, значение по умолчанию или слияние)`);
}
for (const id of new Set([...Object.keys(before.list), ...Object.keys(after.list)])) {
	if (ours.has(id)) continue;
	if (!(id in before.list)) out.fresh.push(`настройка ${id} = ${JSON.stringify(after.list[id].value)}`);
	else if (!(id in after.list)) out.changed.push(`настройка ${id} пропала`);
	else if (JSON.stringify(before.list[id].value) !== JSON.stringify(after.list[id].value)) out.changed.push(`настройка ${id}: по умолчанию ${JSON.stringify(before.list[id].value)} -> ${JSON.stringify(after.list[id].value)}`);
}

// Providers, models, source anchors, numbers.
const was = new Set(providerIds(old)), disabled = new Set(after.config.disabledProviders);
for (const id of before.models.filter(id => !after.models.includes(id))) out.broken.push(`модель ${id} пропала из каталога`);
for (const id of providerIds(neu).filter(id => !was.has(id))) out.fresh.push(`провайдер ${id}${disabled.has(id) ? " (закрыт)" : " (открыт)"}`);
const files = [...new Set(contract.source.map(entry => entry.path))].filter(path => changed(old, neu, [path]));
for (const entry of contract.source.filter(entry => files.includes(entry.path))) out.changed.push(`опора «${entry.use}»: ${entry.path} менялся`);
for (const entry of contract.numbers) {
	const [a, b] = [numberOf(old, entry), numberOf(neu, entry)];
	if (a !== b) out.changed.push(`число «${entry.text}»: ${a} -> ${b}`);
}
const prompts = changed(old, neu, ["packages/coding-agent/src/prompts", "packages/coding-agent/src/extensibility/extensions/types.ts", "packages/coding-agent/src/extensibility/shared-events.ts"]);

// The new sources as files, for reading; the shared clone stays on its tag.
const tree = `${TMP}/src-${neu}`;
if (!existsSync(tree)) run(["git", "-C", SRC, "worktree", "add", "-q", "--detach", tree, `v${neu}`]);
const exe = release(neu)["omp-windows-x64.exe"], list = (title, items) => [`## ${title}: ${items.length}`, ...items.map(item => `- ${item}`), ""];
const passed = after.rows.filter(item => item.ok).length;
writeFileSync(`${TMP}/scan.md`, [
	`# scan: OMP ${old} -> ${neu}, харнес ${repo}`, "",
	...list("сломано на новой версии", out.broken),
	...list("не проходило и на старой (долг, не этот апдейт)", out.regress),
	...list("изменилось в OMP: прочитать и решить", out.changed),
	...list("новое в OMP", out.fresh),
	`## не изменилось: ${passed} из ${after.rows.length} проверок проходят на ${neu}`, "",
	"## промпты и API расширений, git diff --stat", "```", prompts || "без изменений", "```", "",
	"## пин omp.exe", `- version: ${neu}`, `- url: ${exe.url}`, `- sha256: ${exe.sha256}`, `- size: ${exe.size}`, "",
	`исходники ${neu}: ${tree}; снимки: ${TMP}/cap-*.json; changelog: git -C ${SRC} diff v${old} v${neu} -- '*CHANGELOG.md'`, "",
].join("\n"));
console.log(`${TMP}/scan.md: сломано ${out.broken.length}, долг ${out.regress.length}, изменилось ${out.changed.length}, новое ${out.fresh.length}, проходят ${passed} из ${after.rows.length}`);
