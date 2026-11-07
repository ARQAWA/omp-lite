// Full Responses: preserve effort; use priority for Luna; leave Lite unchanged.
export default function codexParallel(pi) {
  pi.on("before_provider_request", (event, ctx) => {
    if (ctx.model?.api !== "openai-codex-responses") return;
    const body = event.payload;
    if (!body || typeof body !== "object" || !Array.isArray(body.tools)) return;

    return {
      ...body,
      parallel_tool_calls: true,
      reasoning: { ...body.reasoning, context: "all_turns" },
      text: { ...body.text, verbosity: "low" },
      ...(/luna/i.test(ctx.model.id) ? { service_tier: "priority" } : {}),
    };
  });
}
