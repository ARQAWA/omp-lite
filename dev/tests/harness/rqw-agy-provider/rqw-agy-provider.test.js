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
mock.module("@oh-my-pi/pi-catalog/models", () => ({
	getBundledModel: (provider, id) => provider === "antigravity-cli" && id === "gemini-4-new" ? { contextWindow: 750000, maxTokens: 64000 } : undefined,
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

test("токен: keychain, при пустом keychain файл agy, иначе ошибка с обоими источниками", async () => {
	const spawn = spyOn(Bun, "spawnSync").mockImplementation(() => ({ stdout: Buffer.from(keychain + "\n") }));
	const file = spyOn(Bun, "file").mockImplementation(() => ({ exists: async () => true, json: async () => ({ token: { refresh_token: "from-file" } }) }));
	try {
		expect(await index.readRefreshToken()).toBe("r1");
		spawn.mockImplementation(() => ({ stdout: Buffer.from("") }));
		expect(await index.readRefreshToken()).toBe("from-file");
		expect(file.mock.calls[0][0]).toBe(data.tokenFile.replace("~", process.env.HOME));
		file.mockImplementation(() => ({ exists: async () => false }));
		expect(index.readRefreshToken()).rejects.toThrow("AGY: нет токена agy");
	} finally {
		spawn.mockRestore();
		file.mockRestore();
	}
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
			n: { type: "integer", minimum: 1, description: "{maximum: 9}" },
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
					{ type: "thinking", thinking: "думаю", summary: true },
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
		{ role: "model", parts: [{ text: "ответ", thoughtSignature: "SIG-TEXT" }, { functionCall: { id: "c1", name: "read", args: { path: "a" } }, thoughtSignature: "SIG-CALL" }] },
		{ role: "model", parts: [{ functionResponse: { id: "c1", name: "read", response: { output: "данные" } } }] },
	]);
	expect(request.request.generationConfig).toEqual({ maxOutputTokens: 65536, thinkingConfig: { includeThoughts: true, thinkingLevel: "MEDIUM" } });
	expect(request.request.sessionId).toMatch(/^-?\d{1,19}$/);
	expect(wireSchemaCalls).toEqual(["read"]);
	// усилие маршрутизирует wire-id базовой модели
	const xhigh = index.buildRequest({ id: "gemini-4-neon", provider: "agy" }, { messages: [] }, index.conversation("xh"), "proj-1", "xhigh");
	expect(xhigh.model).toBe("gemini-4-neon-xhigh");
	expect(xhigh.request.labels.model_enum).toBe("MODEL_PLACEHOLDER_M535");
	expect(xhigh.request.generationConfig.thinkingConfig.thinkingLevel).toBe(100);
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
			{ response: { candidates: [{ content: { parts: [{ functionCall: { id: "call_7", name: "read", args: { path: "a" } }, thoughtSignature: "SIG-CALL" }] } }] } },
			{ response: { candidates: [{ content: { parts: [{ text: "ок" }] }, finishReason: "STOP" }] } },
		]));
	};
	index.run({ id: "gemini-4-neon-low", provider: "agy" }, { messages: [{ role: "user", content: "привет" }] }, { fetch: fetcher }, fakeStream());
	await new Promise(resolve => setTimeout(resolve, 10));
	expect(streamCalls).toBe(2);
	expect(seenAuth).toEqual(["Bearer t1", "Bearer t2"]);
	expect(events.find(event => event.type === "done").message.content).toMatchObject([{ type: "toolCall", id: "call_7", name: "read" }, { type: "text", text: "ок" }]);
	spawn.mockRestore();
});

test("мёртвый стрим без finishReason повторяется один раз", async () => {
	const spawn = spyOn(Bun, "spawnSync").mockImplementation(() => ({ stdout: Buffer.from(keychain + "\n") }));
	let streamCalls = 0;
	const fetcher = async (url, init) => {
		if (url === data.tokenUrl) return new Response(JSON.stringify({ access_token: "t1", expires_in: 3600 }));
		if (url.endsWith(data.loadCodeAssistPath)) return new Response(JSON.stringify({ cloudaicompanionProject: "p" }));
		streamCalls += 1;
		if (streamCalls === 1) return new Response(sseBody([
			{ response: { candidates: [], usageMetadata: { promptTokenCount: 111444, totalTokenCount: 111444 } } },
		]));
		return new Response(sseBody([
			{ response: { candidates: [{ content: { parts: [{ text: "ок" }] } }] } },
			{ response: { candidates: [{ finishReason: "STOP" }] } },
		]));
	};
	index.run({ id: "gemini-4-hydrogen", provider: "agy" }, { messages: [{ role: "user", content: "привет" }] }, { fetch: fetcher, reasoning: "high" }, fakeStream());
	await new Promise(resolve => setTimeout(resolve, 10));
	expect(streamCalls).toBe(2);
	expect(events.filter(event => event.type === "error")).toHaveLength(0);
	expect(events.find(event => event.type === "done").message.content[0].text).toBe("ок");
	spawn.mockRestore();
});

test("заблокированный фильтром запрос отдаёт blockReason без повтора", async () => {
	const spawn = spyOn(Bun, "spawnSync").mockImplementation(() => ({ stdout: Buffer.from(keychain + "\n") }));
	let streamCalls = 0;
	const fetcher = async url => {
		if (url === data.tokenUrl) return new Response(JSON.stringify({ access_token: "t1", expires_in: 3600 }));
		if (url.endsWith(data.loadCodeAssistPath)) return new Response(JSON.stringify({ cloudaicompanionProject: "p" }));
		streamCalls += 1;
		return new Response(sseBody([
			{ response: { promptFeedback: { blockReason: "SAFETY" }, usageMetadata: { promptTokenCount: 10, totalTokenCount: 10 } } },
		]));
	};
	index.run({ id: "gemini-4-hydrogen", provider: "agy" }, { messages: [{ role: "user", content: "привет" }] }, { fetch: fetcher }, fakeStream());
	await new Promise(resolve => setTimeout(resolve, 10));
	expect(streamCalls).toBe(1);
	expect(events.find(event => event.type === "error").error.errorMessage).toBe("AGY: запрос заблокирован фильтром (SAFETY)");
	spawn.mockRestore();
});

test("agy models groups new Gemini efforts without adding old or non-chat rows", async () => {
	const spawn = spyOn(Bun, "spawn").mockReturnValue({
		stdout: "gemini-4-new-high\tGemini 4 New (High)\ngemini-4-new-low\tGemini 4 New (Low)\ngemini-4-neon-high\tNeon\nclaude-sonnet-5-5\tClaude\ngemini-4-new-image\tImage\n",
		exited: Promise.resolve(0),
	});
	try {
		const models = await index.discoverModels();
		expect(models.map(({ id, thinking }) => [id, thinking.efforts])).toEqual([["gemini-4-new", ["high", "low"]]]);
		expect(models[0].contextWindow).toBe(750000);
		expect(index.buildRequest(models[0], { messages: [] }, index.conversation("new"), "project", "low").model).toBe("gemini-4-new-low");
	} finally {
		spawn.mockRestore();
	}
});

test("квота agy: свой запрос retrieveUserQuotaSummary и два лимита Gemini в отчёте usage", async () => {
	const calls = [];
	const fetcher = async (url, init) => {
		calls.push([url, init]);
		if (url === data.tokenUrl) return new Response(JSON.stringify({ access_token: "t1", expires_in: 3600 }));
		if (url.endsWith(data.loadCodeAssistPath)) return new Response(JSON.stringify({ cloudaicompanionProject: "aicode-consumers" }));
		return new Response(JSON.stringify({ groups: [
			{ buckets: [{ bucketId: "3p-5h", displayName: "Five Hour Limit Remaining", window: "5h", resetTime: "2026-11-23T12:25:12Z", remainingFraction: 1 }] },
			{ buckets: [{ bucketId: "gemini-weekly", displayName: "Weekly Limit Remaining", window: "weekly", resetTime: "2026-11-29T11:19:33Z", remainingFraction: 0.75 }, { bucketId: "gemini-5h", displayName: "Five Hour Limit Remaining", window: "5h", resetTime: "2026-11-23T12:08:52Z", remainingFraction: 0.5 }] },
		] }));
	};
	const registered = {};
	index.default({ setLabel() {}, registerProvider: (name, config) => { registered[name] = config; } });
	const report = await registered.agy.usage.fetchUsage({}, { fetch: fetcher });
	expect(registered.agy.usage.id).toBe("agy");
	expect(calls[2]).toEqual([data.endpoint + data.quotaPath, { method: "POST", headers: index.authHeaders("t1"), body: JSON.stringify({ project: "aicode-consumers" }) }]);
	expect(report).toEqual({ provider: "agy", fetchedAt: expect.any(Number), limits: [
		{ id: "gemini-weekly", label: "Weekly Limit Remaining", scope: { provider: "agy", windowId: "weekly", shared: true }, window: { id: "weekly", label: "Weekly Limit Remaining", resetsAt: Date.parse("2026-11-29T11:19:33Z") }, amount: { unit: "percent", remainingFraction: 0.75, usedFraction: 0.25 } },
		{ id: "gemini-5h", label: "Five Hour Limit Remaining", scope: { provider: "agy", windowId: "5h", shared: true }, window: { id: "5h", label: "Five Hour Limit Remaining", resetsAt: Date.parse("2026-11-23T12:08:52Z") }, amount: { unit: "percent", remainingFraction: 0.5, usedFraction: 0.5 } },
	] });
});
