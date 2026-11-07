// Codex web search uses fetch directly, outside before_provider_request.
const key = Symbol.for("omp.codex-luna-search.fetch");
const endpoint = "https://chatgpt.com/backend-api/codex/responses";

export default function codexLunaSearch(pi) {
  let state = globalThis[key];
  if (!state) {
    const original = globalThis.fetch;
    state = { users: 0, original };
    state.fetch = function (input, init) {
      if (!state.users || input !== endpoint || typeof init?.body !== "string") {
        return original(input, init);
      }
      let body;
      try {
        body = JSON.parse(init.body);
      } catch {
        return original(input, init);
      }
      if (body.model !== "gpt-6-luna" || !Array.isArray(body.tools) ||
          !body.tools.some(tool => tool?.type === "web_search")) {
        return original(input, init);
      }
      return original(input, {
        ...init,
        body: JSON.stringify({
          ...body,
          service_tier: "priority",
          reasoning: { ...body.reasoning, effort: "xhigh" },
        }),
      });
    };
    globalThis[key] = state;
    globalThis.fetch = state.fetch;
  }
  state.users++;
  pi.on("session_shutdown", () => {
    if (--state.users === 0 && globalThis.fetch === state.fetch) {
      globalThis.fetch = state.original;
      delete globalThis[key];
    }
  });
}
