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

// Owner and agent replies of a session file, without tool calls, tool results and thinking.
export const replies = file => readFileSync(file, "utf8").split("\n").flatMap(line => {
	try {
		const { type, timestamp, message } = JSON.parse(line);
		const body = type === "message" && ["user", "assistant"].includes(message.role) && text(message.content).trim();
		return body ? [{ role: message.role, time: timestamp, text: body }] : [];
	} catch {
		return [];
	}
});

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
