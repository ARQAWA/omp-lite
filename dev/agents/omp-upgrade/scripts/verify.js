// Gates of consistency: the harness of a checkout against the OMP version its INSTALL.md names.
// bun verify.js [--repo <checkout>] [--runtime] [--no-tests]. `--runtime`: the installed harness and OMP too. Exit 1 on any FAIL.
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { arg, check, contract, json, read, release, report, run, settingsOf, stage, TMP } from "./lib.js";

const repo = resolve(arg("--repo", process.cwd())), flag = name => process.argv.includes(name);
const version = read(`${repo}/INSTALL.md`).match(/omp\/(\d+\.\d+\.\d+)/)[1];
const { rows, config, manifest } = check(version, repo), row = (id, ok, detail = "") => rows.push({ id, ok: Boolean(ok), detail: ok ? "" : String(detail) });

// One version everywhere. A version of another product has another major number.
const major = text => Number(text.split(".")[0]);
const stamps = run(["git", "-C", repo, "grep", "-n", "-E", "[0-9]+\\.[0-9]+\\.[0-9]+", "--", ...contract.stamps]).out.split("\n")
	.flatMap(line => [...line.matchAll(/(?<![\d.])\d+\.\d+\.\d+(?![\d.])/g)].map(found => ({ at: line.split(":").slice(0, 2).join(":"), found: found[0] })))
	.filter(stamp => Math.abs(major(stamp.found) - major(version)) <= 1 && stamp.found !== version);
row(`версия ${version} одна во всех местах`, !stamps.length, stamps.slice(0, 12).map(stamp => `${stamp.at} ${stamp.found}`).join("; "));

const pin = json(`${repo}/${contract.pin}`), exe = release(version)["omp-windows-x64.exe"];
row("пин omp.exe равен релизу", pin.version === version && pin.assets.omp.url === exe.url && pin.assets.omp.sha256 === exe.sha256 && pin.assets.omp.size === exe.size, JSON.stringify(exe));

if (!flag("--no-tests")) {
	const tests = run(["bun", "test", "dev/tests"], { cwd: repo, timeout: 600_000 });
	row("bun test dev/tests", tests.code === 0, (tests.err || tests.out).trim().split("\n").slice(-4).join(" | "));
}

if (flag("--runtime")) {
	const home = `${process.env.HOME}/.omp/agent`;
	row(`стоит omp/${version}`, run(["omp", "--version"]).out.trim() === `omp/${version}`);
	const differs = manifest.files.filter(({ from, to }) => !to.endsWith("stt.windows.json") && run(["cmp", "-s", `${repo}/${from}`, `${home}/${to}`]).code).map(file => file.to);
	row("файлы рантайма равны репозиторию", !differs.length, differs.join(", "));
	const left = manifest.remove.filter(path => existsSync(`${home}/${path}`));
	row("удалённых путей в рантайме нет", !left.length, left.join(", "));
	// Effective values of the installed config against the staged one; the default model belongs to the machine.
	const live = settingsOf("omp", home), staged = settingsOf("omp", stage(repo, `${TMP}/agent-runtime`).dir);
	const drift = Object.keys(staged).filter(id => id !== "modelRoles" && JSON.stringify(live[id]?.value) !== JSON.stringify(staged[id].value));
	row("настройки рантайма равны фрагментам", !drift.length, drift.join(", "));
}

console.log(report(`ворота, OMP ${version}, ${repo}`, rows));
process.exit(rows.some(item => !item.ok) ? 1 : 0);
