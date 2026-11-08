import { readFile, stat } from "node:fs/promises";
import { enclosingBlockBoundaries } from "@oh-my-pi/pi-natives";
import { resolvePath, resolveRealPathStrict } from "../../shared/paging.js";
import { sortedSchema } from "../../shared/data.js";
import { toolText } from "../../shared/tool-text.js";
import { parseReadArgs } from "./args.js";
import description from "./description.md" with { type: "text" };
import { isBinary, readTextRange } from "./lines.js";
import { growToBlocks, renderRead } from "./render.js";

const CODE_EXTENSIONS = /\.(py|pyi|rs|go|java|kt|kts|scala|ts|tsx|js|jsx|mjs|cjs|c|h|cc|cpp|hpp|cs|rb|php|swift)$/i;
// Images and PDF go to omp's native read, which this tool replaces under the same name.
const NATIVE_READ_EXTENSIONS = /\.(png|jpe?g|gif|webp|pdf)$/i;
const UNSUPPORTED_BINARY_EXTENSIONS = /\.(zip|tar|gz|exe|dll|so|dylib|bin|mp4|webm|mov|avi|mkv|wmv|flv|m4v)$/i;
// Internal URLs such as xd:// and local:// are served only by omp's native read.
const INTERNAL_URL = /^[a-z][a-z0-9+.-]*:\/\//i;

const PARAMETERS = {
	type: "object",
	properties: {
		path: { type: "string", description: "Path of the file to read, relative to the workspace root (absolute paths also work)." },
		offset: {
			type: "integer",
			description:
				"The line number to start reading from. Positive values are 1-indexed from the start of the file. Negative values count backwards from the end (e.g. -1 is the last line). Only provide if the file is too large to read at once.",
		},
		limit: { type: "integer", description: "The number of lines to read. Only provide if the file is too large to read at once." },
	},
	required: ["path"],
};

export default function read(pi) {
	pi.registerTool({
		name: "read",
		label: "read",
		loadMode: "essential",
		concurrency: "shared",
		strict: false,
		description: description.trim(),
		parameters: sortedSchema(PARAMETERS),
		async execute(_toolCallId, params, signal, onUpdate, ctx) {
			const path = params?.path;
			if (typeof path === "string" && ctx.invokeTool !== undefined) {
				if (INTERNAL_URL.test(path)) return ctx.invokeTool({ path }, { signal, onUpdate });
				if (NATIVE_READ_EXTENSIONS.test(path)) return ctx.invokeTool({ path: resolvePath(path, ctx.cwd) }, { signal, onUpdate });
			}
			try {
				return toolText(await readPath(params, ctx.cwd));
			} catch (error) {
				return toolText(`Error: ${error instanceof Error ? error.message : String(error)}`, true);
			}
		},
	});
}

async function readPath(params, cwd) {
	const args = parseReadArgs(params);
	if (args.path.trim() === "") throw new Error("path is empty or only whitespace");
	const binary = UNSUPPORTED_BINARY_EXTENSIONS.exec(args.path);
	if (binary !== null) throw new Error(`Cannot read binary files of type ${binary[1].toLowerCase()}`);
	const file = resolvePath(args.path, cwd);
	if ((await resolveRealPathStrict(file)) === null) throw new Error("Permission denied");
	let bytes;
	try {
		const info = await stat(file);
		if (info.isDirectory()) throw new Error(`Path is a directory, not a file: ${args.path}`);
		if (!info.isFile()) throw new Error(`Path is neither a file nor a directory: ${args.path}`);
		bytes = await readFile(file);
	} catch (error) {
		if (error.code === "ENOENT") throw new Error("File not found");
		if (error.code === "EACCES" || error.code === "EPERM") throw new Error("Permission denied");
		throw error;
	}
	if (isBinary(bytes)) throw new Error(`File content is binary data, not text: ${args.path}`);
	const content = bytes.toString("utf8");
	if (CODE_EXTENSIONS.test(file) && args.offset !== undefined && args.offset > 0) return renderAroundBlocks(content, file, args);
	return renderRead(readTextRange(content, args.offset, args.limit), args.offset, args.limit);
}

/** A range in a code file grows to the enclosing blocks tree-sitter reports. */
function renderAroundBlocks(content, file, args) {
	const total = content.split("\n").length;
	const end = Math.min(total, args.limit === undefined ? total : args.offset + args.limit - 1);
	const bounds =
		args.offset > total ? undefined : enclosingBlockBoundaries({ code: content, path: file, ranges: [{ startLine: args.offset, endLine: end }] });
	const grown = growToBlocks(content, bounds, args.offset, args.limit);
	return renderRead(readTextRange(content, grown.offset, grown.limit), grown.offset, grown.limit);
}
