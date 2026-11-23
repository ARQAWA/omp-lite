import { beforeEach, expect, mock, spyOn, test } from "bun:test";

const events = [];
class FakeStream {
	push(event) { events.push(event); }
	end() {}
}
let wireSchemaCalls = [];
mock.module("@oh-my-pi/pi-ai", () => ({
	// общий модуль с rqw-codex-adapter.test.js: оба мока — надмножество друг друга
	AssistantMessageEventStream: FakeStream,
	toolWireSchema: tool => { wireSchemaCalls.push(tool.name); return tool.parameters; },
	withOAuthAccess: async (storage, _provider, attempt, options) => {
		let last = new Error(options.missingAccessMessage);
		for (const access of storage) {
			try { return await attempt(access); } catch (error) { if (!options.isAuthError(error)) throw error; last = error; }
		}
		throw last;
	},
}));
const index = await import("../../../../src/modules/rqw-agy-provider/index.js");
import data from "../../../../src/modules/rqw-agy-provider/rqw-agy-provider.json";

const keychain = "go-keyring-base64:" + Buffer.from(JSON.stringify({ token: { refresh_token: "r1" } })).toString("base64");
const sseBody = chunks => new Response(chunks.map(c => `data: ${JSON.stringify(c)}\n\n`).join("")).body;
const fakeStream = () => ({ push: event => events.push(event), end() {} });

beforeEach(() => {
	events.length = 0;
	wireSchemaCalls = [];
	index.resetCaches();
});

test("cleanSchema сворачивает запрещённые ключи в description и чистит properties по значениям", () => {
	const cleaned = index.cleanSchema({
		type: "object",
		properties: { n: { type: "integer", minimum: 1, maximum: 9 }, t: { type: ["string", "null"] } },
		required: ["n"],
		additionalProperties: false,
	});
	expect(cleaned).toEqual({
		type: "object",
		properties: {
			n: { type: "integer", description: "{minimum: 1, maximum: 9}" },
			t: { type: "string", description: '{type: ["string","null"]}' },
		},
		required: ["n"],
		description: "{additionalProperties: false}",
	});
});

test("buildRequest собирает конверт agy: labels по алфавиту, подписи, functionResponse, thinkingLevel", () => {
	const conv = index.conversation("build");
	const request = index.buildRequest(
		{ id: "gemini-4-argon", provider: "agy" },
		{
			systemPrompt: [" СИС ", ""],
			messages: [
				{ role: "user", content: "вопрос" },
				{ role: "assistant", content: [
					{ type: "text", text: "ответ", textSignature: "SIG-TEXT" },
					{ type: "toolCall", id: "c1", name: "read", arguments: { path: "a" }, thoughtSignature: "SIG-CALL" },
				] },
				{ role: "toolResult", toolCallId: "c1", toolName: "read", content: [{ type: "text", text: "данные" }], isError: false },
			],
			tools: [{ name: "read", description: "читай", parameters: { type: "object", properties: { path: { type: "string" } }, required: ["path"] } }],
		},
		conv,
		"proj-1",
		"medium",
	);
	expect(request.project).toBe("proj-1");
	expect(request.requestId).toMatch(/^agent\/[0-9a-f-]+\/\d+\/[0-9a-f-]+\/1$/);
	expect(request.model).toBe("gemini-4-argon-medium");
	expect(request.userAgent).toBe("antigravity");
	expect(request.requestType).toBe("agent");
	expect(Object.keys(request.request.labels)).toEqual([...Object.keys(request.request.labels)].sort());
	expect(request.request.labels).toEqual({
		cascade_id: conv.agentId,
		last_step_index: "0",
		model_enum: "MODEL_PLACEHOLDER_M418",
		request_id: `${conv.trajectoryId}-0`,
		root_cascade_id: conv.agentId,
		trajectory_id: conv.trajectoryId,
		used_claude: "false",
		used_claude_conservative: "false",
		used_non_gemini_model: "false",
	});
	expect(request.request.systemInstruction).toEqual({ role: "user", parts: [{ text: "СИС" }] });
	expect(request.request.tools).toEqual([{ functionDeclarations: [{ name: "read", description: "читай", parameters: { type: "object", properties: { path: { type: "string" } }, required: ["path"] } }] }]);
	expect(request.request.contents).toEqual([
		{ role: "user", parts: [{ text: "вопрос" }] },
		{ role: "model", parts: [{ text: "ответ", thoughtSignature: "SIG-TEXT" }, { functionCall: { name: "read", args: { path: "a" } }, thoughtSignature: "SIG-CALL" }] },
		{ role: "user", parts: [{ functionResponse: { name: "read", response: { output: "данные" } } }] },
	]);
	expect(request.request.generationConfig).toEqual({ maxOutputTokens: 65536, thinkingConfig: { includeThoughts: true, thinkingLevel: "MEDIUM" } });
	expect(request.request.sessionId).toMatch(/^-/);
	expect(wireSchemaCalls).toEqual(["read"]);
	// усилие маршрутизирует wire-id базовой модели
	const xhigh = index.buildRequest({ id: "gemini-4-neon", provider: "agy" }, { messages: [] }, index.conversation("xh"), "proj-1", "xhigh");
	expect(xhigh.model).toBe("gemini-4-neon-xhigh");
	expect(xhigh.request.labels.model_enum).toBe("MODEL_PLACEHOLDER_M535");
	expect(xhigh.request.generationConfig.thinkingConfig.thinkingLevel).toBe("XHIGH");
	expect(xhigh.request.generationConfig.maxOutputTokens).toBe(262144);
});

test("стрим ведёт текст, подпись и usage с cacheRead до done", async () => {
	const spawn = spyOn(Bun, "spawnSync").mockImplementation(() => ({ stdout: Buffer.from(keychain + "\n") }));
	const calls = [];
	const fetcher = async (url, init) => {
		calls.push([url, init]);
		if (url === data.tokenUrl) return new Response(JSON.stringify({ access_token: "t1", expires_in: 3600 }));
		if (url.endsWith(data.loadCodeAssistPath)) return new Response(JSON.stringify({ cloudaicompanionProject: "aicode-consumers" }));
		return new Response(sseBody([
			{ response: { candidates: [{ content: { parts: [{ text: "пон" }] } }] } },
			{ response: { candidates: [{ content: { parts: [{ text: "г" }, { thoughtSignature: "SIG" }] }, finishReason: "STOP" }], usageMetadata: { promptTokenCount: 100, candidatesTokenCount: 2, totalTokenCount: 162, cachedContentTokenCount: 60 } } },
		]));
	};
	index.run({ id: "gemini-4-neon-medium", provider: "agy" }, { systemPrompt: [], messages: [{ role: "user", content: "привет" }] }, { fetch: fetcher }, fakeStream());
	await new Promise(resolve => setTimeout(resolve, 10));
	expect(calls[0][0]).toBe(data.tokenUrl);
	expect(calls[1][1].headers).toEqual(index.authHeaders("t1"));
	const done = events.find(event => event.type === "done");
	expect(done.message.content[0]).toEqual({ type: "text", text: "понг", textSignature: "SIG" });
	expect(done.message.usage).toEqual({ input: 40, output: 2, cacheRead: 60, cacheWrite: 0, totalTokens: 162, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } });
	expect(events.map(event => event.type)).toEqual(["start", "text_start", "text_delta", "text_delta", "text_end", "done"]);
	spawn.mockRestore();
});

test("401 на стриме обновляет токен и повторяет запрос один раз", async () => {
	const spawn = spyOn(Bun, "spawnSync").mockImplementation(() => ({ stdout: Buffer.from(keychain + "\n") }));
	let streamCalls = 0;
	const seenAuth = [];
	const fetcher = async (url, init) => {
		if (url === data.tokenUrl) return new Response(JSON.stringify({ access_token: streamCalls ? "t2" : "t1", expires_in: 3600 }));
		if (url.endsWith(data.loadCodeAssistPath)) return new Response(JSON.stringify({ cloudaicompanionProject: "p" }));
		streamCalls += 1;
		seenAuth.push(init.headers.authorization);
		if (streamCalls === 1) return new Response("нет доступа", { status: 401 });
		return new Response(sseBody([
			{ response: { candidates: [{ content: { parts: [{ text: "ок" }] } }] } },
			{ response: { candidates: [{ finishReason: "STOP" }] } },
		]));
	};
	index.run({ id: "gemini-4-neon-low", provider: "agy" }, { messages: [{ role: "user", content: "привет" }] }, { fetch: fetcher }, fakeStream());
	await new Promise(resolve => setTimeout(resolve, 10));
	expect(streamCalls).toBe(2);
	expect(seenAuth).toEqual(["Bearer t1", "Bearer t2"]);
	expect(events.find(event => event.type === "done").message.content[0].text).toBe("ок");
	spawn.mockRestore();
});
