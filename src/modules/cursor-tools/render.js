// Rendering and paging for the grep wrapper: engine matches in, model text out.
// Every page is cut between whole entries, so the entry that did not fit starts the next page.

export const PAGE_BUDGET = 15000;
const ITEM_LIMIT = PAGE_BUDGET - 1000;

/** A single entry cannot be dropped, so an oversized one keeps its head and tail. */
export function cut(text) {
	if (text.length <= ITEM_LIMIT) return text;
	return `${text.slice(0, ITEM_LIMIT - 2)}…${text.slice(-1)}`;
}

/** One entry per match line, with the context lines that belong to it. */
export function contentEntries(matches, display = path => path) {
	const byFile = new Map();
	for (const match of matches) {
		const file = display(match.path);
		let lines = byFile.get(file);
		if (lines === undefined) byFile.set(file, (lines = new Map()));
		for (const side of [match.contextBefore ?? [], match.contextAfter ?? []]) {
			for (const line of side) {
				if (!lines.has(line.lineNumber)) lines.set(line.lineNumber, { lineNumber: line.lineNumber, line: line.line, isContext: true });
			}
		}
		lines.set(match.lineNumber, { lineNumber: match.lineNumber, line: match.line, isContext: false });
	}
	const entries = [];
	for (const [file, lines] of byFile) {
		const pending = [];
		let entry;
		for (const line of [...lines.values()].sort((a, b) => a.lineNumber - b.lineNumber)) {
			if (line.isContext) {
				if (entry === undefined) pending.push(line);
				else entry.lines.push(line);
				continue;
			}
			entry = { file, lines: [...pending.splice(0), line] };
			entries.push(entry);
		}
	}
	return entries;
}

/** Match lines read `file:12:text`, context lines `file:12-text`, as ripgrep prints them. */
export function contentLines(entry) {
	return entry.lines.map(line => `${entry.file}:${line.lineNumber}${line.isContext ? "-" : ":"}${line.line}`);
}

/** Takes whole entries until the page budget, then names the next index. */
export function paginate(entries, render, options = {}) {
	const offset = options.offset ?? 0;
	const limit = options.limit;
	const budget = options.budget ?? PAGE_BUDGET;
	const lines = [];
	let used = 0;
	let taken = 0;
	let index = offset;
	for (; index < entries.length; index++) {
		if (limit !== undefined && taken >= limit) break;
		const chunk = render(entries[index]);
		const size = chunk.reduce((sum, line) => sum + line.length + 1, 0);
		if (taken > 0 && used + size > budget) break;
		if (taken === 0 && size > budget) {
			lines.push(cut(chunk.join("\n")));
			taken++;
			index++;
			break;
		}
		lines.push(...chunk);
		used += size;
		taken++;
	}
	return { text: lines.join("\n"), next: index < entries.length ? index : undefined };
}
