// Rendering and paging for the grep wrapper: engine matches in, model text out.
// Every page is cut between whole entries, so the entry that did not fit starts the next page.

export const PAGE_BUDGET = 15000;
const TAIL = 400;

/** An oversized entry keeps its head and its tail, because the match may sit anywhere. */
export function cut(text) {
	if (text.length <= PAGE_BUDGET) return text;
	return `${text.slice(0, PAGE_BUDGET - TAIL - 1)}…${text.slice(-TAIL)}`;
}

/**
 * One entry per match line. A context line belongs to the next match in the file,
 * or to the last one after it, so a page never carries another match's context.
 */
export function contentEntries(matches, display = path => path) {
	const byFile = new Map();
	for (const match of matches) {
		const file = display(match.path);
		let list = byFile.get(file);
		if (list === undefined) byFile.set(file, (list = []));
		list.push(match);
	}
	const entries = [];
	for (const [file, list] of byFile) {
		list.sort((a, b) => a.lineNumber - b.lineNumber);
		const owned = list.map(() => new Map());
		list.forEach((match, index) => owned[index].set(match.lineNumber, { lineNumber: match.lineNumber, line: match.line, isContext: false }));
		const context = new Map();
		for (const match of list) {
			for (const side of [match.contextBefore ?? [], match.contextAfter ?? []]) {
				for (const line of side) if (!context.has(line.lineNumber)) context.set(line.lineNumber, line);
			}
		}
		for (const line of context.values()) {
			if (owned.some(map => map.has(line.lineNumber))) continue;
			let owner = list.findIndex(match => match.lineNumber > line.lineNumber);
			if (owner === -1) owner = list.length - 1;
			owned[owner].set(line.lineNumber, { lineNumber: line.lineNumber, line: line.line, isContext: true });
		}
		for (const map of owned) entries.push({ file, lines: [...map.values()].sort((a, b) => a.lineNumber - b.lineNumber) });
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
