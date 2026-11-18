// The guard reference takes the native descriptions of a version from its snapshot ($OMP_UP/cap-<version>-native.json).
// bun reference.js <version> [--repo <checkout>]. Only the changed `description` lines of the main forms are rewritten.
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { arg, contract, json, native, read, TMP, toolsOf } from "./lib.js";

const version = process.argv[2], file = `${resolve(arg("--repo", process.cwd()))}/${contract.guard.reference}`;
const tools = toolsOf(json(`${TMP}/cap-${version}-native.json`).payload), reference = json(file).tools;
const lines = read(file).split("\n"), changed = [];
let name;
for (const [index, line] of lines.entries()) {
	name = line.match(/^\t\t"(\w+)": \{$/)?.[1] ?? name;
	if (!/^\t\t\t"description": /.test(line) || !tools[name]) continue;
	if ([reference[name], ...(reference[name].alt ?? [])].some(form => form.description && native(form.description) === native(tools[name].description))) continue;
	lines[index] = `\t\t\t"description": ${JSON.stringify(tools[name].description)},`;
	changed.push(name);
}
writeFileSync(file, lines.join("\n"));
console.log(`эталон: изменены ${changed.join(", ") || "нет"}`);
