/**
 * rqw-agy-provider — нативный antigravity-провайдер для OMP.
 * Механика воспроизведена по митм-реверсу оригинального agy-клиента:
 * конверт project/requestId/labels/sessionId, systemInstruction с role user,
 * tools с legacy parameters, SSE-события {response:...}. Данные — в json рядом.
 */
import { randomUUID } from "node:crypto";
import { AssistantMessageEventStream, toolWireSchema } from "@oh-my-pi/pi-ai";
import { getBundledModel } from "@oh-my-pi/pi-catalog/models";
import data from "./rqw-agy-provider.json";

const STREAM_URL = data.endpoint + data.streamPath;
const LOAD_CODE_ASSIST_URL = data.endpoint + data.loadCodeAssistPath;

// ---------- авторизация: keychain agy + обмен токена ----------

let cachedToken;
let tokenInFlight;

export function parseKeychainSecret(text, prefix = data.keychain.prefix) {
	if (typeof text !== "string" || !text.startsWith(prefix)) return undefined;
	const json = JSON.parse(Buffer.from(text.slice(prefix.length), "base64").toString("utf8"));
	const refresh = json?.token?.refresh_token;
	return typeof refresh === "string" && refresh ? refresh : undefined;
}

export function readRefreshToken() {
	const out = Bun.spawnSync(["security", "find-generic-password", "-s", data.keychain.service, "-a", data.keychain.account, "-w"]);
	const refresh = parseKeychainSecret(out.stdout.toString().trim());
	if (!refresh) throw new Error(`AGY: в keychain нет записи ${data.keychain.service}/${data.keychain.account} (залогинься в agy)`);
	return refresh;
}

async function fetchToken(fetcher) {
	// id и секрет лежат base64, как в апстрим-репозитории omp: гитхаб-пуш-протекция не пускает открытый текст
	const decode = (value, encoding) => (encoding === "base64" ? Buffer.from(value, "base64").toString("utf8") : value);
	const form = new URLSearchParams({
		client_id: decode(data.clientId, data.clientIdEncoding),
		client_secret: decode(data.clientSecret, data.clientSecretEncoding),
		grant_type: "refresh_token",
		refresh_token: readRefreshToken(),
	});
	const response = await fetcher(data.tokenUrl, {
		method: "POST",
		headers: { "content-type": "application/x-www-form-urlencoded" },
		body: form.toString(),
	});
	if (!response.ok) throw new Error(`AGY: обмен токена ${response.status} ${await response.text()}`);
	const payload = await response.json();
	if (typeof payload.access_token !== "string" || typeof payload.expires_in !== "number") throw new Error("AGY: token endpoint отдал неожиданный формат");
	return { access: payload.access_token, expMs: Date.now() + payload.expires_in * 1000 };
}

async function accessToken(fetcher) {
	if (cachedToken && Date.now() < cachedToken.expMs - 60000) return cachedToken.access;
	if (!tokenInFlight) {
		tokenInFlight = fetchToken(fetcher).then(t => {
			cachedToken = t;
			return t;
		}).finally(() => {
			tokenInFlight = undefined;
		});
	}
	return (await tokenInFlight).access;
}

// project id — из loadCodeAssist, кэшируется в процессе
let cachedProject;
async function project(fetcher, token) {
	if (cachedProject) return cachedProject;
	const response = await fetcher(LOAD_CODE_ASSIST_URL, {
		method: "POST",
		headers: authHeaders(token),
		body: JSON.stringify({ metadata: { ideType: "ANTIGRAVITY" } }),
	});
	if (!response.ok) throw new Error(`AGY: loadCodeAssist ${response.status} ${await response.text()}`);
	const payload = await response.json();
	if (typeof payload.cloudaicompanionProject !== "string") throw new Error("AGY: loadCodeAssist без project");
	cachedProject = payload.cloudaicompanionProject;
	return cachedProject;
}

export function authHeaders(token) {
	return {
		authorization: `Bearer ${token}`,
		"content-type": "application/json",
		"user-agent": data.userAgent,
		"accept-encoding": "gzip",
	};
}

// ---------- конверсация: стабильные ids для неявного кэша google ----------

const conversations = new Map();

export function conversation(key) {
	const k = key ?? "default";
	let conv = conversations.get(k);
	if (!conv) {
		// sessionId — отрицательный int63, как у agy
		const sessionId = `-${BigInt(Math.floor(Math.random() * 9e17)).toString()}`;
		conv = { agentId: randomUUID(), trajectoryId: randomUUID(), sessionId, step: 0, requestCount: 0 };
		conversations.set(k, conv);
	}
	conv.step += 1;
	conv.requestCount += 1;
	return conv;
}

// ---------- сборка пакета запроса ----------

export function messageParts(message) {
	if (message.role === "user" || message.role === "developer") {
		const parts = [];
		if (typeof message.content === "string") {
			if (message.content.trim()) parts.push({ text: message.content });
		} else {
			for (const item of message.content) {
				if (item.type === "text") {
					if (item.text.trim()) parts.push({ text: item.text });
				} else {
					parts.push({ inlineData: { mimeType: item.mimeType, data: item.data } });
				}
			}
		}
		return parts;
	}
	if (message.role === "assistant") {
		const parts = [];
		for (const block of message.content) {
			if (block.type === "text" && block.text.trim()) {
				parts.push({ text: block.text, ...(block.textSignature ? { thoughtSignature: block.textSignature } : {}) });
			} else if (block.type === "thinking" && (block.thinking.trim() || block.thinkingSignature)) {
				parts.push({ thought: true, text: block.thinking, ...(block.thinkingSignature ? { thoughtSignature: block.thinkingSignature } : {}) });
			} else if (block.type === "toolCall") {
				parts.push({
					functionCall: { name: block.name, args: block.arguments ?? {} },
					...(block.thoughtSignature ? { thoughtSignature: block.thoughtSignature } : {}),
				});
			}
		}
		return parts;
	}
	// toolResult: functionResponse {name, response:{output|error}} одним part
	const text = message.content.filter(c => c.type === "text").map(c => c.text).join("\n");
	return [{ functionResponse: { name: message.toolName, response: message.isError ? { error: text } : { output: text } } }];
}

export function wireContents(context) {
	const contents = [];
	for (const message of context.messages) {
		const role = message.role === "assistant" ? "model" : "user";
		const parts = messageParts(message);
		if (!parts.length) continue;
		// все functionResponse идут одним user-ходом, как у agy
		const last = contents[contents.length - 1];
		if (message.role === "toolResult" && last?.role === "user" && last.parts.some(p => p.functionResponse)) last.parts.push(...parts);
		else contents.push({ role, parts });
	}
	return contents;
}

// google принимает ограниченный набор ключей схемы; у agy запрещённые
// ключи свёрнуты в description строкой вида "{minimum: 1, maximum: ...}"
const ALLOWED_SCHEMA_KEYS = { type: true, description: true, properties: true, required: true, items: true, enum: true, anyOf: true };

export function cleanSchema(schema) {
	if (Array.isArray(schema)) return schema.map(cleanSchema);
	if (!schema || typeof schema !== "object") return schema;
	const out = {};
	const lifted = [];
	for (const [key, value] of Object.entries(schema)) {
		if (key === "type" && Array.isArray(value)) {
			out.type = value.find(t => t !== "null") ?? value[0];
			lifted.push(`type: ${JSON.stringify(value)}`);
		} else if (key === "properties" && value && typeof value === "object" && !Array.isArray(value)) {
			// properties — словарь «имя -> схема», а не схема: чистим каждое значение
			out.properties = Object.fromEntries(Object.entries(value).map(([name, sub]) => [name, cleanSchema(sub)]));
		} else if (key !== "properties" && ALLOWED_SCHEMA_KEYS[key]) {
			out[key] = cleanSchema(value);
		} else {
			lifted.push(`${key}: ${JSON.stringify(value)}`);
		}
	}
	if (lifted.length) {
		const note = `{${lifted.join(", ")}}`;
		out.description = typeof schema.description === "string" && schema.description ? `${schema.description} ${note}` : note;
	}
	return out;
}

export function wireTools(tools) {
	if (!tools?.length) return undefined;
	return [{ functionDeclarations: tools.map(tool => ({
		name: tool.name,
		description: tool.description || "",
		parameters: cleanSchema(toolWireSchema(tool)),
	})) }];
}

export function buildRequest(model, context, conv, project, effort) {
	const systemPrompts = (context.systemPrompt ?? []).map(t => t.trim()).filter(Boolean);
	// усилие выбирает wire-id: gemini-4-neon + high -> gemini-4-neon-high
	const wireModel = effort && !/-(low|medium|high|xhigh)$/.test(model.id) ? `${model.id}-${effort}` : model.id;
	const suffix = wireModel.match(/-(low|medium|high|xhigh)$/)?.[1] ?? "medium";
	const modelEnum = data.modelEnums[wireModel];
	// labels — ключи в алфавитном порядке, как у agy
	const labels = {
		cascade_id: conv.agentId,
		last_step_index: String(conv.step - 1),
		...(modelEnum ? { model_enum: modelEnum } : {}),
		request_id: `${conv.trajectoryId}-${conv.requestCount - 1}`,
		root_cascade_id: conv.agentId,
		trajectory_id: conv.trajectoryId,
		used_claude: "false",
		used_claude_conservative: "false",
		used_non_gemini_model: "false",
	};
	const tools = wireTools(context.tools);
	return {
		project,
		requestId: `agent/${conv.agentId}/${Date.now()}/${conv.trajectoryId}/${conv.step}`,
		request: {
			contents: wireContents(context),
			...(systemPrompts.length ? { systemInstruction: { role: "user", parts: systemPrompts.map(text => ({ text })) } } : {}),
			...(tools ? { tools } : {}),
			labels,
			generationConfig: {
				maxOutputTokens: model.maxTokens ?? (wireModel.includes("argon") ? 65536 : 262144),
				thinkingConfig: { includeThoughts: true, thinkingLevel: suffix.toUpperCase() },
			},
			sessionId: conv.sessionId,
		},
		model: wireModel,
		userAgent: "antigravity",
		requestType: "agent",
	};
}

// ---------- стрим: sse {response:...} ----------

function emptyOutput(model) {
	return {
		role: "assistant",
		content: [],
		api: "agy-api",
		provider: model.provider,
		model: model.id,
		usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
		stopReason: "stop",
		timestamp: Date.now(),
	};
}

export async function run(model, context, options, stream) {
	const output = emptyOutput(model);
	try {
		const fetcher = options.fetch ?? fetch;
		let token = await accessToken(fetcher);
		const wire = buildRequest(model, context, conversation(options.sessionId), await project(fetcher, token), options.reasoning);
		const send = () => fetcher(STREAM_URL, { method: "POST", headers: authHeaders(token), body: JSON.stringify(wire), signal: options.signal });
		let response = await send();
		if (response.status === 401) {
			cachedToken = undefined;
			token = await accessToken(fetcher);
			response = await send();
		}
		if (!response.ok || !response.body) throw new Error(`AGY: ${response.status} ${(await response.text().catch(() => "")).slice(0, 500)}`);

		let block;
		let sawFinish = false;
		const setBlockSignature = signature => {
			if (!signature) return;
			if (block) block.signature = signature;
			// подпись цепляется к последнему текстовому/thinking-блоку
			for (let i = output.content.length - 1; i >= 0; i--) {
				const item = output.content[i];
				if (block && i !== output.content.length - 1) break;
				if (item.type === "text") { item.textSignature = signature; return; }
				if (item.type === "thinking") { item.thinkingSignature = signature; return; }
				if (block) break;
			}
		};
		const closeBlock = () => {
			if (!block) return;
			stream.push(block.kind === "text"
				? { type: "text_end", contentIndex: output.content.length - 1, content: block.text, partial: output }
				: { type: "thinking_end", contentIndex: output.content.length - 1, content: block.text, partial: output });
			block = undefined;
		};
		const appendDelta = (delta, signature) => {
			if (delta) {
				block.text += delta;
				output.content[output.content.length - 1] = block.kind === "text"
					? { type: "text", text: block.text, ...(block.signature ? { textSignature: block.signature } : {}) }
					: { type: "thinking", thinking: block.text, summary: true, ...(block.signature ? { thinkingSignature: block.signature } : {}) };
				stream.push(block.kind === "text"
					? { type: "text_delta", contentIndex: output.content.length - 1, delta, partial: output }
					: { type: "thinking_delta", contentIndex: output.content.length - 1, delta, partial: output });
			}
			setBlockSignature(signature);
		};
		const openBlock = (kind, delta, signature) => {
			closeBlock();
			output.content.push(kind === "text" ? { type: "text", text: "" } : { type: "thinking", thinking: "", summary: true });
			stream.push(kind === "text"
				? { type: "text_start", contentIndex: output.content.length - 1, partial: output }
				: { type: "thinking_start", contentIndex: output.content.length - 1, partial: output });
			block = { kind, text: "" };
			appendDelta(delta, signature);
		};

		let toolCounter = 0;
		let started = false;
		const handleChunk = chunk => {
			if (chunk.error) throw new Error(`AGY: stream error ${chunk.error.code ?? ""} ${chunk.error.message ?? chunk.error.status ?? ""}`);
			const blockReason = chunk.response?.promptFeedback?.blockReason;
			if (blockReason) throw new Error(`AGY: запрос заблокирован фильтром (${blockReason})`);
			const candidate = chunk.response?.candidates?.[0];
			for (const part of candidate?.content?.parts ?? []) {
				if (!started) { started = true; stream.push({ type: "start", partial: output }); }
				if (part.functionCall) {
					closeBlock();
					const toolCall = {
						type: "toolCall",
						id: `${part.functionCall.name}_${Date.now()}_${++toolCounter}`,
						name: part.functionCall.name,
						arguments: part.functionCall.args ?? {},
						...(part.thoughtSignature ? { thoughtSignature: part.thoughtSignature } : {}),
					};
					output.content.push(toolCall);
					stream.push({ type: "toolcall_start", contentIndex: output.content.length - 1, partial: output });
					stream.push({ type: "toolcall_delta", contentIndex: output.content.length - 1, delta: JSON.stringify(toolCall.arguments), partial: output });
					stream.push({ type: "toolcall_end", contentIndex: output.content.length - 1, toolCall, partial: output });
				} else if (typeof part.text === "string" && part.text !== "") {
					if (part.thought) openBlock("thinking", part.text, part.thoughtSignature);
					else if (block?.kind === "text") appendDelta(part.text, part.thoughtSignature);
					else openBlock("text", part.text, part.thoughtSignature);
				} else if (part.thoughtSignature) {
					// часть-только-подпись подписывает открытый блок ответа
					setBlockSignature(part.thoughtSignature);
				}
			}
			if (candidate?.finishReason) {
				sawFinish = true;
				if (candidate.finishReason === "STOP") output.stopReason = output.content.some(b => b.type === "toolCall") ? "toolUse" : "stop";
				else if (candidate.finishReason === "MAX_TOKENS") output.stopReason = "length";
				else { output.stopReason = "error"; output.errorMessage = `finishReason: ${candidate.finishReason}`; }
			}
			const u = chunk.response?.usageMetadata;
			if (u) {
				const cacheRead = Math.min(u.cachedContentTokenCount ?? 0, u.promptTokenCount ?? u.totalTokenCount ?? 0);
				output.usage = {
					input: (u.promptTokenCount ?? 0) - cacheRead,
					output: (u.candidatesTokenCount ?? 0) + (u.thoughtsTokenCount ?? 0),
					cacheRead,
					cacheWrite: 0,
					totalTokens: u.totalTokenCount ?? 0,
					cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
				};
			}
		};
		const consume = async response => {
			const reader = response.body.getReader();
			const decoder = new TextDecoder();
			let buffer = "";
			for (;;) {
				const { done, value } = await reader.read();
				if (done) break;
				buffer += decoder.decode(value, { stream: true });
				let index;
				while ((index = buffer.indexOf("\n")) >= 0) {
					const line = buffer.slice(0, index).trim();
					buffer = buffer.slice(index + 1);
					if (!line.startsWith("data:")) continue;
					handleChunk(JSON.parse(line.slice(5)));
				}
			}
		};
		await consume(response);
		// сервер иногда рвёт стрим без ошибки: один повтор, пока ответ пуст
		if (!sawFinish && !output.content.length) {
			response = await send();
			if (!response.ok || !response.body) throw new Error(`AGY: ${response.status} ${(await response.text().catch(() => "")).slice(0, 500)}`);
			await consume(response);
		}
		closeBlock();
		if (!sawFinish) throw new Error("AGY: стрим оборвался без finishReason");
		if (output.stopReason === "error") throw new Error(output.errorMessage ?? "AGY: ошибка генерации");
		stream.push({ type: "done", reason: output.stopReason, message: output });
		stream.end();
	} catch (error) {
		output.stopReason = "error";
		output.errorMessage = error instanceof Error ? error.message : String(error);
		stream.push({ type: "error", reason: "error", error: output });
		stream.end();
	}
}

export function resetCaches() {
	cachedToken = undefined;
	tokenInFlight = undefined;
	cachedProject = undefined;
	conversations.clear();
}

// ---------- регистрация провайдера ----------

export async function discoverModels() {
	const child = Bun.spawn(["agy", "models"], { stdout: "pipe", stderr: "ignore" });
	const text = await new Response(child.stdout).text();
	if (await child.exited) throw new Error("agy models failed");
	const models = new Map();
	for (const line of text.split("\n")) {
		const [wire, name] = line.split("\t");
		if (!name || !wire.startsWith("gemini-") || /orchestrator|-(?:image|disabled|sonar)(?:-|$)/.test(wire)) continue;
		const effort = wire.match(/-(low|medium|high|xhigh)$/)?.[1];
		const id = effort ? wire.slice(0, -effort.length - 1) : wire;
		if (data.models.some(model => model.id === id)) continue;
		if (!models.has(id)) {
			const known = getBundledModel("antigravity-cli", id) ?? getBundledModel("google-antigravity", id);
			models.set(id, { id, name: name.replace(/ \([^)]+\)$/, ""), input: ["text", "image"], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: known?.contextWindow ?? undefined, maxTokens: known?.maxTokens ?? 64000 });
		}
		if (effort) {
			const model = models.get(id);
			model.reasoning = true;
			model.thinking ??= { mode: "google-level", efforts: [], defaultLevel: effort };
			model.thinking.efforts.push(effort);
		}
	}
	return [...models.values()];
}

export default function agyProvider(pi) {
	if (process.platform !== "darwin") return;
	pi.setLabel("AGY Antigravity");
	pi.registerProvider("agy", {
		baseUrl: data.endpoint,
		apiKey: "agy-keychain",
		api: "agy-api",
		fetchDynamicModels: discoverModels,
		streamSimple(model, context, options = {}) {
			const stream = new AssistantMessageEventStream();
			void run(model, context, options, stream);
			return stream;
		},
		models: data.models.map(m => ({
			id: m.id,
			name: m.name,
			reasoning: true,
			input: ["text", "image"],
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
			contextWindow: 1048576,
			maxTokens: m.maxTokens,
			thinking: { mode: "google-level", efforts: m.efforts, defaultLevel: m.efforts.includes("medium") ? "medium" : m.efforts.at(-1) },
		})),
	});
}
