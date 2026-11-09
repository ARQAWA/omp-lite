import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import review from "../../../../src/modules/review/index.js";

const model = { provider: "openai-codex", id: "gpt-6.1-terra" };
const reply = { stopReason: "stop", content: [{ type: "text", text: "CLEAN\nCHECKED: packet" }] };

function fixture(response = reply, load) {
	let tool;
	const calls = [];
	const scalar = { min() { return this; }, describe() { return this; } };
	const pi = {
		zod: { object: value => value, string: () => scalar, enum: () => scalar },
		registerTool: value => { tool = value; },
	};
	const ctx = {
		modelRegistry: { getAvailable: () => [model], getApiKey: async () => "test-key" },
		get memory() { throw new Error("parent memory accessed"); },
		get sessionManager() { throw new Error("parent history accessed"); },
		get getSystemPrompt() { throw new Error("parent prompt accessed"); },
	};
	review(pi, load ? undefined : async (...args) => { calls.push(args); return response; }, load);
	return { calls, ctx, run: (packet, level = "blind", signal) => tool.execute("call", { level, packet }, signal, undefined, ctx) };
}

for (const [level, reasoning] of [["blind", "high"], ["high", "xhigh"]]) {
	test(`${level} sends only the explicit packet and installed rules`, async () => {
		const f = fixture();
		const result = await f.run("original task and result", level);
		expect(result.isError).toBeUndefined();
		expect(result.content[0].text).toBe("CLEAN\nCHECKED: packet");
		const [used, context, options] = f.calls[0];
		expect(used).toBe(model);
		expect(context.messages).toEqual([{ role: "user", content: "original task and result" }]);
		expect(context.tools).toEqual([]);
		expect(context.systemPrompt).toHaveLength(2);
		expect(context.systemPrompt[0]).toContain("# Acceptance reviewer");
		expect(context.systemPrompt[1]).toContain("# Standing workflow principles");
		expect(options.reasoning).toBe(reasoning);
		expect(options.apiKey).toBe("test-key");
	});
}

test("the next call has no previous task or verdict", async () => {
	const f = fixture();
	await f.run("first task");
	f.calls[0][1].messages.push({ role: "assistant", content: "old opinion" });
	f.calls[0][1].systemPrompt.push("old context");
	await f.run("second task");
	expect(f.calls[1][1].messages).toEqual([{ role: "user", content: "second task" }]);
	expect(f.calls[1][1].systemPrompt).toHaveLength(2);
});

test("native completion starts loading during registration", async () => {
	let loads = 0;
	const f = fixture(reply, () => {
		loads++;
		return Promise.resolve({ completeSimple: async () => reply });
	});
	expect(loads).toBe(1);
	expect((await f.run("task")).isError).toBeUndefined();
});

test("failed native load reports an error", async () => {
	const f = fixture(reply, () => Promise.reject(new Error("native load failed")));
	const result = await f.run("task");
	expect(result.isError).toBe(true);
	expect(result.content[0].text).toContain("native load failed");
});

test("quoted UNCHECKED is not an unchecked section", async () => {
	for (const text of [
		"CLEAN\nCHECKED: quoted UNCHECKED example",
		"CLEAN\nCHECKED: quote\n> UNCHECKED: logs",
	]) {
		const f = fixture({ stopReason: "stop", content: [{ type: "text", text }] });
		expect((await f.run("task")).isError).toBeUndefined();
	}
});

test("CLEAN with missing proof cannot pass", async () => {
	for (const text of [
		"CLEAN",
		"CLEAN\nUNCHECKED: logs",
		"CLEAN\nCHECKED: code\nUNCHECKED: tests",
		"CLEAN\nCHECKED: code\n**UNCHECKED:** tests",
		"CLEAN\nCHECKED: code\n## UNCHECKED: tests",
		"CLEAN\nCHECKED: code\n  ## UNCHECKED: tests",
		"CLEAN\nCHECKED: code\n## UNCHECKED\ntests",
		"CLEAN\nCHECKED: code\n- UNCHECKED: tests",
		"CLEAN\nCHECKED: code\n## UNCHECKED \u2014 test logs",
	]) {
		const f = fixture({ stopReason: "stop", content: [{ type: "text", text }] });
		expect((await f.run("task")).isError).toBe(true);
	}
});

for (const stopReason of ["length", "toolUse", "error", "aborted"]) {
	test(`${stopReason} never becomes a successful review`, async () => {
		const f = fixture({ ...reply, stopReason });
		expect((await f.run("task")).isError).toBe(true);
	});
}

test("empty output and tool calls cannot become acceptance", async () => {
	for (const content of [[], [{ type: "toolCall", name: "recall", arguments: {} }]]) {
		expect((await fixture({ stopReason: "stop", content }).run("task")).isError).toBe(true);
	}
});

test("missing model or credentials does not choose a fallback", async () => {
	for (const missing of ["model", "auth"]) {
		const f = fixture();
		if (missing === "model") f.ctx.modelRegistry.getAvailable = () => [];
		else f.ctx.modelRegistry.getApiKey = async () => undefined;
		expect((await f.run("task")).isError).toBe(true);
		expect(f.calls).toHaveLength(0);
	}
});

test("cancellation is passed through and pre-cancelled calls do not start", async () => {
	const f = fixture();
	const controller = new AbortController();
	await f.run("task", "blind", controller.signal);
	expect(f.calls[0][2].signal).toBe(controller.signal);
	controller.abort();
	expect((await f.run("task", "blind", controller.signal)).isError).toBe(true);
	expect(f.calls).toHaveLength(1);
});

test("installed workflow quotations retain their original source", () => {
	const source = readFileSync(new URL("../../../WORKFLOW-MANIFEST.md", import.meta.url), "utf8");
	const shipped = readFileSync(new URL("../../../../src/modules/review/skills/reviewer/WORKFLOW.md", import.meta.url), "utf8");
	const quotes = shipped.split("\n").filter(line => line.startsWith("> "));
	expect(quotes.length).toBeGreaterThan(0);
	for (const quote of quotes) expect(source).toContain(quote.slice(2));
});
