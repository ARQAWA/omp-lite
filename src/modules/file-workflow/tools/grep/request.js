import { toInt32 } from "./args.js";

/** The native search a parsed grep call describes; the output mode picks content, files or counts. */
export function buildSearchRequest(args) {
	return {
		pattern: args.pattern,
		path: args.path,
		glob: args.glob,
		type: args.type,
		outputMode: args.output_mode ?? "content",
		caseInsensitive: args["-i"] === true,
		multiline: args.multiline === true,
		contextBefore: toInt32(args["-B"], Math.ceil),
		contextAfter: toInt32(args["-A"], Math.ceil),
		context: toInt32(args["-C"], Math.ceil),
	};
}
