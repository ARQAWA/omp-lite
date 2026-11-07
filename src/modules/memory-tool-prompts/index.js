// Rewrites memory tool descriptions at runtime without forking OMP.
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import descriptions from "./memory-tool-prompts.descriptions.json";

const { old: OLD, new: NEW } = descriptions;
const TARGETS = Object.keys(OLD);
export { NEW, OLD };

export default function memoryPrompts(pi) {
	const state = new Map();
	const warned = new Set();
	let ui;

	const matches = (actual, expected) =>
		actual.replace(/\r\n/g, "\n").trimEnd() === expected.replace(/\r\n/g, "\n").trimEnd();

	const writeStatus = () => {
		const file = process.env.OMP_MEMORY_PROMPTS_STATUS ?? join(import.meta.dir, "..", "memory-tool-prompts.status.json");
		const tools = {};
		for (const name of TARGETS) tools[name] = state.get(name) ?? { status: "unchecked" };
		try {
			writeFileSync(file, `${JSON.stringify({ checkedAt: new Date().toISOString(), tools }, null, 2)}\n`);
		} catch {
			// A read-only profile must not break the session.
		}
	};

	const refreshStatusBar = () => {
		if (!ui) return;
		const stale = TARGETS.filter(name => state.get(name)?.status === "stale");
		ui.setStatus("memory-prompts", stale.length > 0 ? `memory patch stale: ${stale.join(", ")}` : undefined);
	};

	const reportStale = (name, source, actual, ctx) => {
		if (ctx?.ui?.setStatus) ui = ctx.ui;
		state.set(name, { status: "stale", actual: String(actual).slice(0, 300) });
		writeStatus();
		refreshStatusBar();
		if (warned.has(name)) return;
		warned.add(name);
		const target = ctx?.ui ?? ui;
		target?.notify?.(
			`Memory prompt patch: "${name}" changed upstream (${source}). Replacement skipped; update the OLD baseline.`,
			"warning",
		);
	};

	const rewriteTool = (record, name, source, ctx) => {
		const oldText = OLD[name];
		const newText = NEW[name];
		if (oldText === undefined || newText === undefined) return false;
		if (typeof record.description !== "string") return false;
		if (matches(record.description, newText)) {
			state.set(name, { status: "patched" });
			return false;
		}
		if (!matches(record.description, oldText)) {
			reportStale(name, source, record.description, ctx);
			return false;
		}
		record.description = newText;
		state.set(name, { status: "patched" });
		writeStatus();
		refreshStatusBar();
		return true;
	};

	pi.on("session_start", (_event, ctx) => {
		if (ctx?.ui?.notify && ctx.ui.setStatus) ui = ctx.ui;
		let tools;
		try {
			tools = pi.getAllTools();
		} catch {
			return;
		}
		if (!Array.isArray(tools)) return;
		let found = 0;
		for (const name of TARGETS) {
			if (state.get(name)?.status === "stale") continue;
			let description;
			for (const tool of tools) {
				if (typeof tool !== "object" || tool === null) continue;
				if (!("name" in tool) || tool.name !== name) continue;
				if ("description" in tool && typeof tool.description === "string") description = tool.description;
				break;
			}
			if (description === undefined) {
				state.set(name, { status: "missing" });
				continue;
			}
			found += 1;
			const oldText = OLD[name];
			const newText = NEW[name];
			if (oldText === undefined || newText === undefined) continue;
			if (matches(description, newText)) state.set(name, { status: "patched" });
			else if (matches(description, oldText)) state.set(name, { status: "ok" });
			else reportStale(name, "registry", description, ctx);
		}
		if (found > 0) {
			writeStatus();
			refreshStatusBar();
		}
	});

	pi.on("before_provider_request", (event, ctx) => {
		if (typeof event !== "object" || event === null || !("payload" in event)) return event;
		const payload = event.payload;
		const seen = new WeakSet();
		const walk = node => {
			if (typeof node !== "object" || node === null || seen.has(node)) return;
			seen.add(node);
			if (Array.isArray(node)) {
				for (const item of node) walk(item);
				return;
			}
			const fn = node.function;
			if (typeof fn === "object" && fn !== null && !Array.isArray(fn)) {
				if (typeof fn.name === "string" && typeof fn.description === "string") rewriteTool(fn, fn.name, "payload", ctx);
			}
			if (
				typeof node.name === "string" &&
				typeof node.description === "string" &&
				("parameters" in node ||
					"input_schema" in node ||
					"inputSchema" in node ||
					"strict" in node ||
					node.type === "function")
			) {
				rewriteTool(node, node.name, "payload", ctx);
			}
			for (const value of Object.values(node)) walk(value);
		};
		walk(payload);
		return payload;
	});

	pi.on("tool_result", (event, ctx) => {
		if (typeof event !== "object" || event === null) return;
		if (event.toolName !== "read" || event.isError === true) return;
		const input = event.input;
		if (typeof input !== "object" || input === null || Array.isArray(input)) return;
		const path = input.path;
		if (typeof path !== "string" || !path.startsWith("xd://")) return;
		const name = path.slice("xd://".length);
		const oldText = OLD[name];
		const newText = NEW[name];
		if (oldText === undefined || newText === undefined) return;
		const content = event.content;
		if (!Array.isArray(content)) return;
		const parts = [];
		for (const chunk of content) {
			if (typeof chunk !== "object" || chunk === null) continue;
			if (chunk.type !== "text" || typeof chunk.text !== "string") continue;
			parts.push(chunk.text);
		}
		const original = parts.join("\n");
		if (original === "") return;
		const firstBreak = original.indexOf("\n\n");
		const firstLine = firstBreak > 0 ? original.slice(0, firstBreak) : "";
		const hasHeading = firstLine.startsWith("# ") && firstLine.includes(" — ");
		const doc = hasHeading ? original.slice(firstBreak + 2) : original;
		const schemaAt = doc.indexOf("\n## Schema");
		const body = schemaAt >= 0 ? doc.slice(0, schemaAt) : doc;
		const schema = schemaAt >= 0 ? doc.slice(schemaAt) : "";
		if (matches(body, newText)) {
			state.set(name, { status: "patched" });
			return;
		}
		if (!matches(body, oldText)) {
			reportStale(name, path, body, ctx);
			return;
		}
		state.set(name, { status: "patched" });
		writeStatus();
		refreshStatusBar();
		return { content: [{ type: "text", text: `${newText}${schema}` }] };
	});
}
