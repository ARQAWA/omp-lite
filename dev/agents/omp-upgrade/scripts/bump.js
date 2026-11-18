// The mechanical edits of every update: the version stamps, the omp.exe pin, the extension version (+1 patch).
// bun bump.js <old> <new> [--repo <checkout>]. History (dev/DECISIONS.md, dev/history) is outside contract.stamps and stays.
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { arg, contract, json, read, release, run } from "./lib.js";

const [old, neu] = process.argv.slice(2), repo = resolve(arg("--repo", process.cwd()));
const files = run(["git", "-C", repo, "grep", "-l", "-F", old, "--", ...contract.stamps]).out.trim().split("\n").filter(Boolean);
for (const file of files) writeFileSync(`${repo}/${file}`, read(`${repo}/${file}`).replaceAll(old, neu));

const was = json(`${repo}/${contract.pin}`).assets.omp, exe = release(neu)["omp-windows-x64.exe"];
writeFileSync(`${repo}/${contract.pin}`, read(`${repo}/${contract.pin}`).replace(was.sha256, exe.sha256).replace(`"size": ${was.size}`, `"size": ${exe.size}`));

const pack = `${repo}/${contract.extension}`, version = json(pack).version, next = version.replace(/\d+$/, patch => Number(patch) + 1);
writeFileSync(pack, read(pack).replace(`"version": "${version}"`, `"version": "${next}"`));
console.log(`версия ${old} -> ${neu}: ${files.length} файлов; пин ${exe.sha256.slice(0, 12)} ${exe.size}; расширение ${version} -> ${next}`);
