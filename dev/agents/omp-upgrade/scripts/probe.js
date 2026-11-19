// Live probes of the installed harness on the cheap models of contract.json. bun probe.js [slug ...] [tui].
// The judge reads the requests OMP sent (tap.js), not the words of the model. Report: $OMP_UP/probe.md. Exit 1 on FAIL.
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { contract, HERE, modelsOf, read, run, TMP, wire } from "./lib.js";

const wanted = process.argv.slice(2), want = slug => !wanted.length || wanted.includes(slug);
const config = Bun.YAML.parse(read(`${process.env.HOME}/.omp/agent/config.yml`));
const B = "`";
const PATCH = `Read a.txt with the read tool. Then call the edit tool exactly once, with both sections in one patch: section one is the header of a.txt copied from the read result, then the lines 'PUT 2.=2:' and '+BETA'; section two is the header '[b.txt#0000]' exactly as written here (do not read b.txt, do not correct the tag), then the lines 'PUT 2.=2:' and '+TWO'. Then reply done.`;
// `has`: a text that only the tool result carries; it must reach the next request.
const probes = [
	{ id: "запрос", prompt: () => "Reply with one word: ok" },
	{ id: "grep", prompt: () => `Call the grep tool once with pattern "Probe token" and path ".". Then reply done.`, has: "[AGENTS.md#" },
	{ id: "read", prompt: () => "Read a.txt with the read tool. Then reply done.", has: "[whole file: 3 lines]" },
	{ id: "частичный патч", hashline: true, prompt: () => PATCH, partial: true, after: dir => read(`${dir}/a.txt`) === "alpha\nBETA\ngamma\n" && read(`${dir}/b.txt`) === "one\ntwo\nthree\n" },
	{ id: "сторож eval", prompt: () => `Run the eval tool once, language js, code: await agent("x"). Then reply done.`, has: "are blocked in eval" },
	{ id: "AGENTS.md у сабагента", prompt: model => `I explicitly ask you to spawn exactly one subagent with the task tool, model "${model.model}:${model.thinking}". Its task, word for word: "Reply with the Probe token line from your AGENTS.md context. Do not read any files." Reply with what it returned.`, sub: true },
	{ id: "web_search", prompt: () => `Use the ${B}web_search${B} tool once to find the latest release tag of the GitHub repo can1357/oh-my-pi. Reply with the tag only.`, has: "[fetch 1]" },
];

async function ask(dir, model, prompt, log) {
	rmSync(log, { force: true });
	const child = Bun.spawn({ cmd: ["omp", "-p", "--no-session", "--model", model.model, "--thinking", model.thinking, "-e", `${HERE}/tap.js`, prompt], cwd: dir, env: { ...process.env, TAP_LOG: log }, stdout: "pipe", stderr: "pipe", timeout: 300_000 });
	const answer = (await new Response(child.stdout).text()).trim();
	await child.exited;
	return { answer, records: existsSync(log) ? read(log).trim().split("\n").map(line => JSON.parse(line)) : [] };
}

function judge(probe, model, dir, { answer, records }) {
	const fails = [], row = (id, ok, detail = "") => ok || fails.push(`${id}${detail ? `: ${detail}` : ""}`);
	const main = records.filter(record => record.agent === "main"), sent = payloads => JSON.stringify(payloads.map(record => record.payload));
	if (!main.length) return [`запроса нет: ${answer.slice(0, 120)}`];
	if (probe.id === "запрос") {
		wire(main[0].payload, row);
		const lost = modelsOf(config).filter(id => !main[0].models?.includes(id));
		row("модели конфига есть в живом каталоге", !lost.length, lost.join(", "));
		const body = main[0].payload;
		if (model.codex) row("поля Codex", body.parallel_tool_calls === true && body.reasoning?.context === "all_turns" && body.text?.verbosity === "low" && body.service_tier === "priority", JSON.stringify([body.parallel_tool_calls, body.reasoning?.context, body.text?.verbosity, body.service_tier]));
	}
	if (probe.has) row(`в запросе нет «${probe.has}»`, sent(main).includes(probe.has), `ответ: ${answer.slice(0, 80)}`);
	if (probe.partial) {
		const results = main.flatMap(({ payload }) => {
			const messages = payload.messages ?? [], input = payload.input ?? [];
			const parts = messages.flatMap(message => Array.isArray(message.content) ? message.content : []);
			const ids = new Set([...parts.filter(part => part.type === "tool_use" && /^_?edit$/.test(part.name)).map(part => part.id),
				...input.filter(item => /^(?:function_call|custom_tool_call)$/.test(item.type) && /^_?edit$/.test(item.name)).map(item => item.call_id)]);
			return [...parts.filter(part => part.type === "tool_result" && ids.has(part.tool_use_id)).map(part => part.content),
				...input.filter(item => /^(?:function_call_output|custom_tool_call_output)$/.test(item.type) && ids.has(item.call_id)).map(item => item.output)];
		});
		row("пропущенный b.txt в результате edit", results.some(value => JSON.stringify(value ?? "").includes("Partial patch:") && JSON.stringify(value ?? "").includes("[b.txt]")));
	}
	if (probe.after) row("файлы после патча", probe.after(dir));
	if (probe.sub) {
		const child = records.filter(record => record.agent === "sub");
		row("сабагент не видит AGENTS.md", child.length && sent(child).includes(`Probe token: ${model.slug}-7319`), child.length ? "" : "сабагент не запущен");
		row("памятка попала сабагенту", !sent(child).includes("## Workflow"));
	}
	return fails;
}

async function model(item) {
	const dir = `${TMP}/probe-${item.slug}`, out = [];
	rmSync(dir, { recursive: true, force: true });
	mkdirSync(dir, { recursive: true });
	run(["git", "init", "-q", dir]);
	writeFileSync(`${dir}/AGENTS.md`, `Probe token: ${item.slug}-7319\n`);
	writeFileSync(`${dir}/a.txt`, "alpha\nbeta\ngamma\n");
	writeFileSync(`${dir}/b.txt`, "one\ntwo\nthree\n");
	for (const [index, probe] of probes.entries()) {
		if (probe.hashline && !item.hashline) continue;
		let fails;
		// A model that did not do the step gets one more try.
		// The log lies outside the probe folder: the `grep` probe searches it.
		for (let attempt = 0; attempt < 2 && (attempt === 0 || fails.length); attempt++) fails = judge(probe, item, dir, await ask(dir, item, probe.prompt(item), `${TMP}/probe-${item.slug}-${index}.jsonl`));
		out.push({ probe: probe.id, slug: item.slug, fails });
	}
	return out;
}

const results = (await Promise.all(contract.probes.filter(item => want(item.slug)).map(model))).flat();
if (want("tui")) {
	const ui = contract.probes.at(-1), dir = `${TMP}/probe-tui`;
	rmSync(dir, { recursive: true, force: true });
	mkdirSync(dir, { recursive: true });
	writeFileSync(`${dir}/a.txt`, "alpha\nbeta\ngamma\n");
	const done = run(["python3", `${HERE}/tui.py`, dir, ui.model, ui.thinking, JSON.stringify(contract.tui)], { timeout: 300_000 });
	let rows;
	try { rows = JSON.parse(done.out); } catch { rows = { "интерфейс запустился": false }; }
	for (const [id, ok] of Object.entries(rows)) results.push({ probe: `интерфейс: ${id}`, slug: "tui", fails: ok ? [] : [done.err.slice(-200) || "нет"] });
}

// A step a model did not do is the model's fault when another model did it; the request itself must be right on every model.
const lines = [], names = [...new Set(results.map(item => item.probe))];
let failed = false;
for (const name of names) {
	const rows = results.filter(item => item.probe === name), bad = rows.filter(item => item.fails.length);
	const strict = name === "запрос" || name.startsWith("интерфейс"), verdict = !bad.length ? "PASS" : !strict && bad.length < rows.length ? "PASS, сбой модели" : "FAIL";
	failed ||= verdict === "FAIL";
	lines.push(`- ${verdict} ${name}: ${rows.map(item => `${item.slug} ${item.fails.length ? "нет" : "да"}`).join(", ")}`, ...bad.flatMap(item => item.fails.map(fail => `  - ${item.slug}: ${fail}`)));
}
const text = [`# probe: ${run(["omp", "--version"]).out.trim()}`, "", ...lines, ""].join("\n");
writeFileSync(`${TMP}/probe.md`, text);
console.log(text);
process.exit(failed ? 1 : 0);
