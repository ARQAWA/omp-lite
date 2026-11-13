// Compact model/effort picker: Shift+any arrow opens it, arrows move, letters filter.
import data from "./model-picker.json";

const ARROW_RE = /^\x1b\[(?:1)?(?:;(\d+))?(?::(\d+))?([ABCD])$/;
const ENTER_RE = /^\x1b\[(?:13(?:;2)?|27;2;13)(?::(\d+))?[u~]$/;
const ESCAPE_RE = /^\x1b\[27(?::(\d+))?u$/;
const BACKSPACE_RE = /^\x1b\[(?:127|8)(?::(\d+))?u$/;
const CONTROL_ALL = /[\u0000-\u001f\u007f-\u009f]/g;
const CONTROL_ANY = /[\u0000-\u001f\u007f-\u009f]/;
const DIRECTIONS = { A: "up", B: "down", C: "right", D: "left" };
const size = text => [...text].length;
const cut = (text, width) => [...text].slice(0, Math.max(0, width)).join("");
const short = (text, room) => (size(text) <= room ? text : room < 1 ? "" : `${cut(text, room - 1)}…`);
const wrap = (text, width) => {
	const chars = [...text];
	const rows = [];
	for (let at = 0; at < chars.length; at += width) rows.push(chars.slice(at, at + width).join(""));
	return rows.length > 0 ? rows : [""];
};

function readArrow(value) {
	const match = ARROW_RE.exec(value);
	if (!match) return undefined;
	return {
		direction: DIRECTIONS[match[3]],
		modifier: match[1] === undefined ? 1 : Number(match[1]),
		event: match[2] === undefined ? 1 : Number(match[2]),
	};
}

export function parseArrow(value) {
	const arrow = readArrow(value);
	return arrow ? { direction: arrow.direction, modifier: arrow.modifier, event: arrow.event } : undefined;
}

export function shiftArrow(value) {
	const arrow = readArrow(value);
	return arrow && arrow.modifier === 2 && arrow.event !== 3 ? arrow.direction : undefined;
}

export function arrowDirection(value) {
	const arrow = readArrow(value);
	return arrow && arrow.event !== 3 ? arrow.direction : undefined;
}

const isEnter = value => {
	if (value === "\r" || value === "\n") return true;
	const match = ENTER_RE.exec(value);
	return Boolean(match) && match[1] !== "3";
};

const isEscape = value => {
	if (value === "\x1b") return true;
	const match = ESCAPE_RE.exec(value);
	return Boolean(match) && match[1] !== "3";
};

const isBackspace = value => {
	if (value === "\x7f" || value === "\x08") return true;
	const match = BACKSPACE_RE.exec(value);
	return Boolean(match) && match[1] !== "3";
};

const printable = value =>
	typeof value === "string" && value.length > 0 && !value.includes("\x1b") && !CONTROL_ANY.test(value)
		? value
		: undefined;

export function sameModel(left, right) {
	return Boolean(left && right && left.provider === right.provider && left.id === right.id);
}

export function modelLabel(model) {
	const raw = String(model?.name || model?.id || "");
	const clean = raw.replace(CONTROL_ALL, " ").replace(/\s+/g, " ").trim();
	return clean.startsWith("Claude ") ? clean.slice(7) : clean;
}

export function levelsFor(model) {
	const efforts = Array.isArray(model?.thinking?.efforts) ? model.thinking.efforts : [];
	const supported = new Set(["auto", "off", ...efforts]);
	return data.effortOrder.filter(level => supported.has(level));
}

export function nearestLevel(model, level) {
	const levels = levelsFor(model);
	if (typeof level !== "string") return levels[0];
	if (levels.includes(level)) return level;
	const from = data.effortOrder.indexOf(level);
	for (let index = (from < 0 ? data.effortOrder.length : from) - 1; index >= 0; index -= 1) {
		if (levels.includes(data.effortOrder[index])) return data.effortOrder[index];
	}
	return levels[0];
}

export function filterModels(models, filter) {
	const query = String(filter).toLowerCase();
	if (query === "") return models;
	return models.filter(model => `${model.provider}/${model.id} ${model.name ?? ""}`.toLowerCase().includes(query));
}

export function allowModels(models, patterns) {
	if (!Array.isArray(patterns) || patterns.length === 0) return models;
	const tests = patterns.map(
		pattern => new RegExp(`^${String(pattern).replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*")}$`),
	);
	return models.filter(model => tests.some(test => test.test(`${model.provider}/${model.id}`)));
}

// Workaround: ctx.models.list() ignores enabledModels (OMP 18.18.8, extensibility/extensions/model-api.ts), so OMP itself is asked.
async function enabledModels(pi) {
	try {
		return JSON.parse((await pi.exec(process.execPath, ["config", "get", "enabledModels", "--json"])).stdout).value;
	} catch {
		return [];
	}
}

const side = (theme, model, room) => (room > size(model.provider) ? ` ${theme.fg("dim", model.provider)}` : "");

export function configuredEffort(ctx, pi) {
	let latest;
	const branch = ctx?.sessionManager?.getBranch?.();
	if (Array.isArray(branch)) {
		for (const entry of branch) if (entry?.type === "thinking_level_change") latest = entry;
	}
	if (typeof latest?.configured === "string") return latest.configured;
	if (typeof latest?.thinkingLevel === "string") return latest.thinkingLevel;
	const live = pi?.getThinkingLevel?.();
	return typeof live === "string" ? live : "off";
}

export async function commitSelection(pi, ctx, draft) {
	const model = draft?.model;
	if (!model) return;
	const id = `${model.provider}/${model.id}`;
	try {
		const current = ctx.models.current() ?? ctx.model;
		if (!sameModel(current, model) && !(await pi.setModel(model))) {
			ctx.ui.notify(data.noAuth + id, "warning");
			return;
		}
		if (draft.effort) pi.setThinkingLevel(draft.effort);
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		ctx.ui.notify(`${data.switchFailed}${id}: ${message}`, "warning");
	}
}

const paintEffort = (theme, level, active) => {
	if (!active) return theme.fg("dim", level);
	const style = data.efforts[level];
	if (style?.mode === "ansi") return `\x1b[1m\x1b[38;5;${style.color}m${level}\x1b[39m\x1b[22m`;
	const color = style?.color ?? "text";
	const role = typeof theme.hasColor === "function" && !theme.hasColor(color) ? "thinkingXhigh" : color;
	return theme.fg(role, theme.bold(level));
};

export class ModelPicker {
	constructor(models, initial, theme, done) {
		this.models = models;
		this.theme = theme;
		this.done = done;
		this.filter = "";
		this.closed = false;
		this.visible = models;
		const wanted = initial?.model;
		const model = (wanted && models.find(item => sameModel(item, wanted))) || models[0];
		this.current = { model, effort: model ? nearestLevel(model, initial?.effort) : undefined };
	}

	invalidate() {}

	handleInput(input) {
		if (this.closed) return;
		if (isEnter(input)) return this.#apply();
		if (isEscape(input) || input === "\x03") return this.#finish(undefined);
		const direction = arrowDirection(input);
		if (direction) return this.#move(direction);
		if (isBackspace(input)) {
			if (this.filter === "") return;
			this.filter = [...this.filter].slice(0, -1).join("");
			return this.#refilter();
		}
		const text = printable(input);
		if (!text) return;
		this.filter += text;
		this.#refilter();
	}

	render(width) {
		if (width <= 0) return [];
		const theme = this.theme;
		const index = this.visible.indexOf(this.current.model);
		if (index >= 0) {
			const needed = 3 + data.minName + size(levelsFor(this.visible[index]).join(" "));
			if (needed > width) {
				return wrap(data.effortNeeds.replace("{n}", String(needed)), width).map(row => theme.fg("error", row));
			}
		}
		const rows = [theme.fg("accent", theme.bold(cut(data.title, width))), ""];
		rows.push(theme.fg("dim", cut(data.filterLabel + this.filter, width)));
		rows.push(...this.#body(width, index));
		rows.push(this.#hint(width));
		return rows;
	}

	#finish(value) {
		if (this.closed) return;
		this.closed = true;
		this.done(value);
	}

	#apply() {
		const model = this.current.model;
		if (!model || this.visible.indexOf(model) < 0) return;
		this.#finish({ model, effort: this.current.effort });
	}

	#move(direction) {
		const model = this.current.model;
		if (!model) return;
		if (direction === "up" || direction === "down") {
			const index = this.visible.indexOf(model);
			const next = index + (direction === "up" ? -1 : 1);
			if (next < 0 || next >= this.visible.length) return;
			const picked = this.visible[next];
			this.current = { model: picked, effort: nearestLevel(picked, this.current.effort) };
			return;
		}
		const levels = levelsFor(model);
		const found = levels.indexOf(this.current.effort);
		const at = found < 0 ? levels.indexOf(nearestLevel(model, this.current.effort)) : found;
		const next = at + (direction === "left" ? -1 : 1);
		if (next < 0 || next >= levels.length) return;
		this.current = { model, effort: levels[next] };
	}

	#refilter() {
		this.visible = filterModels(this.models, this.filter);
		const previous = this.current.model;
		const kept = previous ? this.visible.find(model => sameModel(model, previous)) : undefined;
		const model = kept ?? this.visible[0];
		this.current = { model, effort: model ? nearestLevel(model, this.current.effort) : this.current.effort };
	}

	#body(width, index) {
		const theme = this.theme;
		if (this.visible.length === 0) return [theme.fg("muted", cut(data.noModels, width)), "", "", "", ""];
		// The selected model stays on the middle row, as in MyP; rows past the ends of the list are empty.
		return [-2, -1, 0, 1, 2].map(offset => {
			const model = this.visible[index + offset];
			return model ? this.#row(model, offset === 0, width) : "";
		});
	}

	#row(model, selected, width) {
		const theme = this.theme;
		const name = modelLabel(model);
		if (!selected) return `  ${theme.fg("muted", short(name, width - 2))}${side(theme, model, width - 2 - size(name))}`;
		const levels = levelsFor(model);
		const used = 3 + size(levels.join(" "));
		// The name gives way to the efforts, down to minName columns.
		const label = short(name, width - used);
		const efforts = levels.map(level => paintEffort(theme, level, level === this.current.effort)).join(" ");
		return `${theme.fg("accent", "› ")}${theme.fg("text", theme.bold(label))} ${efforts}${side(theme, model, width - used - size(label))}`;
	}

	#hint(width) {
		const theme = this.theme;
		const dim = text => theme.fg("dim", text);
		const actions = `${data.hintEnter}${data.hintOk}${data.hintEsc}${data.hintCancel}`;
		const styled = `${theme.bold(data.hintEnter)}${dim(data.hintOk)}${theme.bold(data.hintEsc)}${dim(data.hintCancel)}`;
		if (width >= size(data.hintWide + actions)) return dim(data.hintWide) + styled;
		if (width >= size(data.hintMedium + actions)) return dim(data.hintMedium) + styled;
		return dim(cut(data.hintShort, width));
	}
}

export async function openPicker(pi, ctx, isCurrent = () => true, patterns) {
	try {
		if (!isCurrent()) return;
		if (ctx?.mode !== "tui" || !ctx.hasUI || typeof ctx.ui?.custom !== "function") return;
		const models = allowModels(ctx.models.list(), patterns);
		if (models.length === 0) {
			ctx.ui.notify(data.noModelsAvailable, "warning");
			return;
		}
		const current = ctx.models.current() ?? ctx.model;
		const selected = models.find(model => sameModel(model, current)) ?? models[0];
		const initial = { model: selected, effort: nearestLevel(selected, configuredEffort(ctx, pi)) };
		const draft = await ctx.ui.custom((_tui, theme, _keybindings, done) => new ModelPicker(models, initial, theme, done));
		if (!draft || !isCurrent()) return;
		await commitSelection(pi, ctx, draft);
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		ctx?.ui?.notify?.(message, "warning");
	}
}

export default function modelPicker(pi) {
	let generation = 0;
	let dialogOpen = false;
	let unsubscribe;
	let patterns;

	const start = (_event, ctx) => {
		if (ctx?.agent?.kind === "sub") return;
		generation += 1;
		dialogOpen = false;
		unsubscribe?.();
		unsubscribe = undefined;
		if (ctx?.mode !== "tui" || !ctx?.hasUI) return;
		if (typeof ctx.ui?.onTerminalInput !== "function") return;
		void enabledModels(pi).then(value => (patterns = value));
		unsubscribe = ctx.ui.onTerminalInput(input => {
			if (dialogOpen || !shiftArrow(input)) return;
			dialogOpen = true;
			const owner = generation;
			void openPicker(pi, ctx, () => owner === generation, patterns).finally(() => {
				if (owner === generation) dialogOpen = false;
			});
			return { consume: true };
		});
	};

	pi.on("session_start", start);
	pi.on("session_switch", start);
	pi.on("session_branch", start);

	pi.on("session_shutdown", () => {
		generation += 1;
		dialogOpen = false;
		unsubscribe?.();
		unsubscribe = undefined;
	});
}
