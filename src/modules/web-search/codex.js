// Codex wire only: credential identity, headers, Responses SSE, alpha/search.
const BASE = "https://chatgpt.com/backend-api/codex";
const VERSION = "0.159.0";

export const MODEL = "gpt-6-luna";

function accountIdFrom(token) {
	try {
		const claim = JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString())["https://api.openai.com/auth"];
		return typeof claim?.chatgpt_account_id === "string" ? claim.chatgpt_account_id : undefined;
	} catch {
		return undefined;
	}
}

/** OMP refreshes the stored ChatGPT login; only the bearer and account id are taken from it. */
export function authOf(access) {
	return { token: access.accessToken, accountId: access.accountId ?? accountIdFrom(access.accessToken) };
}

export function events(text) {
	const out = [];
	for (const line of text.split("\n")) {
		if (!line.startsWith("data: ")) continue;
		try {
			out.push(JSON.parse(line.slice(6)));
		} catch {}
	}
	return out;
}

export async function post(path, body, auth, stream, signal) {
	const headers = {
		"content-type": "application/json",
		accept: stream ? "text/event-stream" : "application/json",
		originator: "omp",
		version: VERSION,
		Authorization: `Bearer ${auth.token}`,
	};
	if (auth.accountId) headers["chatgpt-account-id"] = auth.accountId;
	const response = await fetch(`${BASE}${path}`, {
		method: "POST",
		headers,
		body: JSON.stringify(body),
		signal: AbortSignal.any([signal ?? new AbortController().signal, AbortSignal.timeout(180000)]),
	});
	if (!response.ok) throw new Error(`Codex ${path} failed: ${response.status} ${(await response.text()).slice(0, 400)}`);
	return stream ? await response.text() : await response.json();
}
