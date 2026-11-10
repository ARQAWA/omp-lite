import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const frozen = ["slice.md", "facts.md"];
const read = (dir, name) => readFileSync(join(dir, name), "utf8");
const flat = text => text.replace(/\s+/g, " ").trim();
const text = content => typeof content === "string" ? content
	: content.filter(block => block.type === "text").map(block => block.text).join("\n");
const sums = dir => frozen.map(name =>
	`${createHash("sha256").update(readFileSync(join(dir, name))).digest("hex")}  ${name}`).join("\n") + "\n";
const parse = line => {
	try {
		return JSON.parse(line) ?? {};
	} catch {
		return {};
	}
};

// Owner and agent replies of a session file, without tool calls, tool results and thinking.
// The file also keeps abandoned branches: the last entry is the leaf, `parentId` leads to the root (omp://session.md).
export const replies = file => {
	const entries = readFileSync(file, "utf8").split("\n").map(parse);
	const byId = new Map(entries.map(entry => [entry.id, entry]));
	const branch = new Set();
	for (let entry = entries.findLast(entry => entry.parentId !== undefined); entry && !branch.has(entry); entry = byId.get(entry.parentId)) branch.add(entry);
	return entries.flatMap(entry => {
		try {
			const { id, type, timestamp, message } = entry;
			const body = (id === undefined || branch.has(entry)) && type === "message" && ["user", "assistant"].includes(message.role) && text(message.content).trim();
			return body ? [{ role: message.role, time: timestamp, text: body }] : [];
		} catch {
			return [];
		}
	});
};

// Writes dir/slice.md from [file, first reply number, last reply number] parts, oldest session first.
export function slice(dir, parts) {
	const body = parts.map(([file, from = 1, to = Infinity]) => `# ${file}\n\n` + replies(file)
		.map((reply, i) => i + 1 < from || i + 1 > to ? "" : `## ${i + 1} ${reply.role} ${reply.time}\n\n${reply.text}\n\n`).join(""));
	writeFileSync(join(dir, "slice.md"), body.join(""));
}

export const freeze = dir => writeFileSync(join(dir, "sha256"), sums(dir));

// Problems of a frozen fact file: changed files and quotes absent from the slice. Empty means valid.
export function check(dir) {
	const errors = sums(dir) === read(dir, "sha256") ? [] : ["facts changed after freeze"];
	const source = flat(read(dir, "slice.md"));
	for (const line of read(dir, "facts.md").split("\n")) {
		const quote = line.startsWith("> ") && flat(line.slice(2));
		if (quote && !source.includes(quote)) errors.push(`quote not in slice: ${quote}`);
	}
	return errors;
}
