// OMP extension for scan, verify and probe. TAP_LOG: every request is appended there.
// TAP_OUT: the first request is written there and the process ends before anything is sent.
import { appendFileSync, writeFileSync } from "node:fs";

export default function tap(pi) {
	pi.on("before_provider_request", (event, ctx) => {
		const record = { model: `${ctx.model?.provider}/${ctx.model?.id}`, api: ctx.model?.api, agent: ctx.agent?.kind, payload: event.payload };
		try {
			record.models = ctx.modelRegistry.getAll().map(model => `${model.provider}/${model.id}`);
		} catch {}
		if (process.env.TAP_LOG) appendFileSync(process.env.TAP_LOG, `${JSON.stringify(record)}\n`);
		if (process.env.TAP_OUT) {
			writeFileSync(process.env.TAP_OUT, JSON.stringify(record));
			setTimeout(() => process.exit(0), 50);
		}
		return event.payload;
	});
}
