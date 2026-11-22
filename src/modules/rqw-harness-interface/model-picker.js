import { cfgEnabledModels } from "@oh-my-pi/pi-coding-agent/config/model-settings";
import { settings } from "@oh-my-pi/pi-coding-agent/config/settings";
import data from "./model-picker.json";

const id = model => `${model.provider}/${model.id}`;
const same = (a, b) => !!a && !!b && id(a) === id(b);
const levels = model => data.effortOrder.filter(level => model?.thinking?.efforts?.includes(level));
const tag = level => data.effortLabels[level];
const nearest = (model, effort) => {
	const list = levels(model), index = data.effortOrder.indexOf(effort);
	return list.filter(level => data.effortOrder.indexOf(level) <= (index < 0 ? 2 : index)).at(-1) ?? list[0];
};
const size = text => [...text].length;
const cut = (text, width) => [...text].slice(0, Math.max(0, width)).join("");
const short = (text, width) => size(text) <= width ? text : width > 0 ? cut(text, width - 1) + "…" : "";
const label = model => (data.aliases[id(model)] ?? String(model.name || model.id))
	.replace(/[\u0000-\u001f\u007f-\u009f]/g, " ").replace(/\s+/g, " ").trim().replace(/^Claude /, "");
const color = (name, text) => {
	const hex = data.colors[name];
	return `\x1b[38;2;${parseInt(hex.slice(1, 3), 16)};${parseInt(hex.slice(3, 5), 16)};${parseInt(hex.slice(5, 7), 16)}m${text}\x1b[39m`;
};
const arrow = input => /^\x1b\[(?:1)?(?:;(\d+))?(?::(\d+))?([ABCD])$/.exec(input);
const enabled = (models, patterns) => {
	if (!Array.isArray(patterns) || !patterns.length) return models;
	const tests = patterns.map(pattern => new RegExp(`^${String(pattern).replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*")}$`));
	return models.filter(model => tests.some(test => test.test(id(model))));
};

function picker(models, initial, effort, theme, done, advisor) {
	let visible = models, selected = initial, filter = "", closed = false, on = advisor?.enabled;
	const accent = advisor?.view.accent ?? "accent";
	if (!advisor) effort = nearest(selected, effort) ?? (data.effortOrder.includes(effort) ? effort : "high");
	const finish = value => { if (!closed) { closed = true; done(value); } };
	const refilter = () => {
		visible = models.filter(model => `${id(model)} ${model.name ?? ""} ${data.aliases[id(model)] ?? ""}`.toLowerCase().includes(filter.toLowerCase()));
		selected = visible.find(model => same(model, selected)) ?? visible[0];
		if (selected && levels(selected).length) effort = nearest(selected, effort);
	};
	const handleInput = input => {
		if (closed) return;
		if (advisor?.isShortcut(input) || input === "\r" || input === "\n" || /^\x1b\[(?:13(?:;2)?|27;2;13)(?::[12])?[u~]$/.test(input)) {
			if (selected) finish(advisor ? { model: selected, enabled: on } : { model: selected, effort: levels(selected).length ? effort : undefined });
			return;
		}
		if (input === "\x1b" || input === "\x03" || /^\x1b\[27(?::[12])?u$/.test(input)) return finish();
		const key = arrow(input);
		if (key) {
			if (key[2] === "3" || !selected || (advisor && key[1] && key[1] !== "1")) return;
			if (key[3] === "A" || key[3] === "B") {
				const next = visible[visible.indexOf(selected) + (key[3] === "A" ? -1 : 1)];
				if (next) { selected = next; if (levels(next).length) effort = nearest(next, effort); }
			} else if (advisor) on = key[3] === "C";
			else {
				const list = levels(selected), next = list[list.indexOf(effort) + (key[3] === "D" ? -1 : 1)];
				if (next) effort = next;
			}
		} else if (advisor) return;
		else if (input === "\x7f" || input === "\x08" || /^\x1b\[(?:127|8)(?::[12])?u$/.test(input)) {
			filter = [...filter].slice(0, -1).join(""); refilter();
		} else if (input && !/[\u0000-\u001f\u007f-\u009f]/.test(input)) {
			filter += input; refilter();
		}
	};
	const render = width => {
		if (width <= 0) return [];
		const list = levels(selected).map(tag), needed = 3 + data.minName + size(list.join(" "));
		if (!advisor && selected && needed > width) {
			const text = data.effortNeeds.replace("{n}", String(needed)), rows = [];
			for (let i = 0; i < size(text); i += width) rows.push(color("error", cut([...text].slice(i).join(""), width)));
			return rows;
		}
		const index = visible.indexOf(selected);
		const rows = advisor ? visible : [-2, -1, 0, 1, 2].map(offset => visible[index + offset]);
		const body = !visible.length ? [color("muted", cut(data.noModels, width)), "", "", "", ""] : rows.map(model => {
			if (!model) return "";
			if (model !== selected) return cut("  ", width) + color("muted", short(label(model), width - 2));
			const names = advisor ? [] : levels(model), name = short(label(model), width - 3 - size(names.map(tag).join(" ")));
			const ladder = names.map(level => level === effort ? color(level, theme.bold(tag(level))) : color("dim", tag(level))).join(" ");
			return color(accent, cut("› ", width)) + theme.bold(name) + (advisor ? "" : " " + ladder);
		});
		if (advisor) {
			const { title, on: yes, off: no, hint } = advisor.view;
			return [color(accent, theme.bold(cut(`${title}: ${on ? yes : no}`, width))), "", ...body, "", color("dim", cut(hint, width))];
		}
		const actions = data.hintEnter + data.hintOk + data.hintEsc + data.hintCancel;
		const hint = width >= size(data.hintWide + actions) ? data.hintWide : width >= size(data.hintMedium + actions) ? data.hintMedium : "";
		return [
			color("accent", theme.bold(cut(data.title, width))), "", color("dim", cut(data.filterLabel + filter, width)), ...body,
			hint ? color("dim", hint) + theme.bold(data.hintEnter) + color("dim", data.hintOk) + theme.bold(data.hintEsc) + color("dim", data.hintCancel) : color("dim", cut(data.hintShort, width)),
		];
	};
	return { handleInput, render, invalidate() {} };
}

export default function modelPicker(pi, advisor) {
	let generation = 0, unsubscribe, open = false;
	const start = (_event, ctx) => {
		if (ctx.agent.kind !== "main") return;
		const owner = ++generation;
		open = false; unsubscribe?.(); unsubscribe = undefined;
		if (ctx.mode !== "tui" || !ctx.hasUI) return;
		unsubscribe = ctx.ui.onTerminalInput(input => {
			const key = arrow(input);
			const choosingAdvisor = advisor?.isShortcut(input);
			if (open || (!choosingAdvisor && (!key || key[1] !== "2" || key[2] === "3"))) return;
			open = true;
			void (async () => {
				try {
					if (choosingAdvisor) {
						const { models, state, view, isShortcut } = advisor;
						const selected = models.find(model => model.ref === state.model);
						const draft = await ctx.ui.custom((_tui, theme, _keys, done) =>
							picker(models, selected, undefined, theme, done, { enabled: state.enabled, view, isShortcut }));
						if (draft && owner === generation) await advisor.save(draft);
						return;
					}
					// OMP 19.1.0 model-api.ts lists models without enabledModels; session/model-controls.ts filters by cfgEnabledModels.
					const models = enabled(ctx.models.list(), cfgEnabledModels.get(settings));
					if (!models.length) return ctx.ui.notify(data.noModelsAvailable, "warning");
					const current = ctx.models.current() ?? ctx.model;
					const selected = models.find(model => same(model, current)) ?? models[0];
					const draft = await ctx.ui.custom((_tui, theme, _keys, done) => {
						const component = picker(models, selected, pi.getThinkingLevel(), theme, done);
						component.handleInput(input);
						return component;
					});
					if (!draft || owner !== generation) return;
					const name = id(draft.model);
					try {
						if (!same(ctx.models.current() ?? ctx.model, draft.model) && !(await pi.setModel(draft.model))) {
							if (owner === generation) ctx.ui.notify(data.noAuth + name, "warning");
							return;
						}
						if (owner === generation && draft.effort) pi.setThinkingLevel(draft.effort);
					} catch (error) {
						if (owner === generation) ctx.ui.notify(`${data.switchFailed}${name}: ${error instanceof Error ? error.message : String(error)}`, "warning");
					}
				} catch (error) {
					if (owner === generation) ctx.ui.notify(error instanceof Error ? error.message : String(error), "warning");
				} finally {
					if (owner === generation) open = false;
				}
			})();
			return { consume: true };
		});
	};
	for (const event of ["session_start", "session_switch", "session_branch"]) pi.on(event, start);
	pi.on("session_shutdown", () => { generation++; open = false; unsubscribe?.(); unsubscribe = undefined; });
}
