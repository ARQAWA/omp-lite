import { afterEach, beforeEach, expect, mock, spyOn, test } from "bun:test";
import webSearch from "../../../../src/modules/web-search/index.js";

const originalFetch = globalThis.fetch;
const query = { search_query: [{ q: "q" }] };
const sse = event => new Response(`data: ${JSON.stringify(event)}\n\n`);
const plan = args => sse({ type: "response.completed", response: { output: [{
	type: "function_call", namespace: "web", name: "run", call_id: "call", arguments: JSON.stringify(args),
}] } });
const done = () => sse({ type: "response.completed", response: { output: [] } });

beforeEach(() => {
	spyOn(AbortSignal, "timeout").mockImplementation(() => new AbortController().signal);
	spyOn(crypto, "randomUUID").mockReturnValue("00000000-0000-4000-8000-000000000000");
});
afterEach(() => {
	globalThis.fetch = originalFetch;
	mock.restore();
});

function run(fetch, signal) {
	globalThis.fetch = fetch;
	let tool;
	webSearch({
		zod: { string: () => ({ describe: () => ({}) }), object: shape => shape },
		registerTool: definition => { tool = definition; },
	});
	return tool.execute("call", { query: "q" }, signal, undefined, {
		modelRegistry: { authStorage: { oauth: { access: async () => ({ accessToken: "token" }) } } },
	});
}

test("B3: stop before forwarding an over-budget UTF-8 input", async () => {
	let responses = 0;
	const evidence = "Я".repeat(1_100_000);
	const result = await run(url => {
		if (url.endsWith("/responses")) return ++responses === 1 ? plan(query) : done();
		return Response.json({ output: evidence });
	});
	expect(responses).toBe(1);
	expect(result.content[0].text).toContain(evidence);
});

test("B4: forward response_length and only supported commands", async () => {
	let responses = 0, sent;
	const search_query = ["a", "b", "c", "d"].map(q => ({ q }));
	await run((url, options) => {
		if (url.endsWith("/responses")) return ++responses === 1 ? plan({ search_query, response_length: "long", weather: [{}] }) : done();
		sent = JSON.parse(options.body).commands;
		return Response.json({ output: "source" });
	});
	expect(sent).toEqual({ search_query, response_length: "long" });
});

test("B6: surface planner SSE errors with the provider message", async () => {
	for (const event of [
		{ type: "response.failed", response: { error: { message: "failed response" } } },
		{ type: "error", error: { message: "nested error" } },
		{ type: "error", message: "top-level error" },
	]) {
		const message = event.message ?? event.error?.message ?? event.response.error.message;
		await expect(run(() => sse(event))).rejects.toThrow(message);
	}
});

test("B8: preserve evidence after a timeout or planner SSE failure", async () => {
	for (const [failure, message] of [["planner", "planner timed out"], ["search", "search timed out"], ["sse", "planner failed"], ["event", "planner error"]]) {
		let responses = 0, searches = 0;
		const result = await run(url => {
			if (url.endsWith("/responses")) {
				if (++responses === 1) return plan(query);
				if (failure === "planner") throw new DOMException(message, "TimeoutError");
				if (failure === "sse") return sse({ type: "response.failed", response: { error: { message } } });
				if (failure === "event") return sse({ type: "error", error: { message } });
				return plan(query);
			}
			if (++searches === 2) throw new DOMException(message, "TimeoutError");
			return Response.json({ output: "source A" });
		});
		expect(result.content[0].text).toContain("[fetch 1]\nsource A");
		expect(result.content[0].text.endsWith(`[incomplete] ${message}`)).toBe(true);
	}
	const error = new Error("other failure");
	let responses = 0;
	await expect(run(url => {
		if (url.endsWith("/responses")) {
			if (++responses === 1) return plan(query);
			throw error;
		}
		return Response.json({ output: "source A" });
	})).rejects.toBe(error);
});

test("B8: caller cancellation still rejects after a successful fetch", async () => {
	const controller = new AbortController();
	const error = new DOMException("cancelled", "AbortError");
	let responses = 0;
	await expect(run(url => {
		if (url.endsWith("/responses")) {
			if (++responses === 1) return plan(query);
			controller.abort(error);
			throw error;
		}
		return Response.json({ output: "source A" });
	}, controller.signal)).rejects.toBe(error);
});
