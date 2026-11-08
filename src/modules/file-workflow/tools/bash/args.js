import { dropEmpty } from "../../shared/data.js";

const DEFAULT_BLOCK_MS = 60_000;

/**
 * The call as it reaches the native bash tool: empty optional fields are dropped, `timeout: 0` means no deadline and
 * reads as absent, and a ready block with neither a log nor a port counts as absent.
 */
export function cleanBashParams(raw) {
	const params = dropEmpty({ ...raw });
	if (params.timeout === 0) delete params.timeout;
	if (params.ready) {
		const ready = dropEmpty({ ...params.ready });
		if (ready.port === 0) delete ready.port;
		if (ready.timeout === 0) delete ready.timeout;
		if (ready.log === undefined && ready.port === undefined) delete params.ready;
		else params.ready = ready;
	}
	return params;
}

/** A pty command owns the terminal for interactive input, so it runs alone. */
export function chooseConcurrency(args) {
	return args?.pty === true ? "exclusive" : "shared";
}

/** How long a call waits before it moves to the background; 60 seconds unless the model asks otherwise. */
export function blockThreshold(ms) {
	return Math.max(0, Math.floor(ms ?? DEFAULT_BLOCK_MS));
}

/**
 * The native arguments and the blocking threshold: a zero block_until_ms on a plain command starts the job in the
 * background at once, and a pty or named service goes straight through without a threshold.
 */
export function mapBashArgs(params) {
	const { block_until_ms: blockUntilMs, ...rest } = params;
	const args = Object.fromEntries(Object.entries(rest).filter(([, value]) => value !== undefined));
	if (params.name === undefined && params.timeout === undefined) args.timeout = 0;
	if (blockUntilMs === 0 && params.pty !== true && params.name === undefined) return { args: { ...args, async: true }, threshold: undefined };
	if (args.async === true || params.pty === true || params.name !== undefined) return { args, threshold: undefined };
	return { args, threshold: blockThreshold(blockUntilMs) };
}
