// Argument mapping and result text of glob: the pattern is normalized, the file list printed with a budget.
import { basename, isAbsolute, relative, resolve } from "node:path";
import { checkType, invalidArguments, optionalString } from "../../shared/args.js";
import { GLOB_CHAR_BUDGET } from "../../shared/search/format.js";

/** glob_pattern is a required non-empty string; target_directory is optional. */
export function parseGlobArgs(params) {
	const issues = [];
	if (!checkType(params, "object", [], issues)) return { error: invalidArguments(issues) };
	const targetDirectory = optionalString(params.target_directory, ["target_directory"], issues);
	const globPattern = checkType(params.glob_pattern, "string", ["glob_pattern"], issues) ? params.glob_pattern : "";
	if (globPattern === "" && !issues.some((issue) => issue.path[0] === "glob_pattern")) {
		issues.push({ path: ["glob_pattern"], message: 'glob_pattern is empty. Pass "*" to match every file.' });
	}
	if (issues.length > 0) return { error: invalidArguments(issues) };
	return { args: { glob_pattern: globPattern, target_directory: targetDirectory } };
}

/** Forward slashes, no leading or trailing slash, and a **\/ prefix unless present. */
export function normalizeGlob(glob) {
	let result = glob.replace(/\\/g, "/");
	if (result.startsWith("/")) result = result.slice(1);
	if (result.endsWith("/")) result = result.slice(0, -1);
	if (!result.startsWith("**/")) result = `**/${result}`;
	return result;
}

/** A file listing of the target directory, newest first; an empty pattern lists every file. */
export function buildGlobRequest(args) {
	return {
		pattern: "",
		path: args.target_directory,
		glob: normalizeGlob(args.glob_pattern),
		outputMode: "files_with_matches",
		caseInsensitive: false,
		multiline: false,
	};
}

/** The files as paths relative to the requested folder; undefined when the search was not a file listing. */
export function mapToGlob(success) {
	if (success.union.mode !== "files_with_matches") return undefined;
	const value = success.union.value;
	const requested = success.path;
	const files =
		requested === undefined || requested === ""
			? value.files
			: value.files.map((file) => {
					const absolute = resolve(success.root, file);
					const target = isAbsolute(requested) ? requested : resolve(success.root, requested);
					return relative(target, absolute) || basename(absolute);
				});
	return { path: requested, files, totalFiles: value.totalFiles, clientTruncated: value.clientTruncated, ripgrepTruncated: value.ripgrepTruncated };
}

function truncationNotice(totalFiles, ripgrepTruncated) {
	const count = `${totalFiles} file${totalFiles === 1 ? "" : "s"}`;
	const total = totalFiles > 0 ? ` ${ripgrepTruncated ? `At least ${count}` : count} in total.` : "";
	return `[Results truncated.${total} Narrow the search with a more specific target_directory or glob_pattern.]\n`;
}

/** The listing of a glob result, cut to the character budget. */
export function formatGlob(result, searchRoot) {
	const normalizedRoot = searchRoot.replace(/\/$/, "");
	const files = normalizedRoot === "." ? result.files.map((file) => file.replace(/^\.\//, "")) : result.files;
	let text = "";
	let listedAll = true;
	if (files.length === 0) {
		text += `Result of search in '${searchRoot}': 0 files found\n`;
	} else {
		text += `Result of search in '${searchRoot}'`;
		if (!result.ripgrepTruncated) text += ` (total ${result.totalFiles} file${result.totalFiles === 1 ? "" : "s"})`;
		text += ":\n";
		for (let i = 0; i < files.length; i++) {
			const file = files[i];
			if (text.length + file.length > GLOB_CHAR_BUDGET) {
				const remaining = Math.max(0, result.totalFiles - i);
				text += result.ripgrepTruncated
					? `... at least ${remaining} more files ... (Do a more specific search if needed)\n`
					: `... ${remaining} more files ... (Do a more specific search if needed)\n`;
				listedAll = false;
				break;
			}
			text += `- ${file}\n`;
		}
	}
	if (listedAll && files.length > 0 && (result.ripgrepTruncated || result.clientTruncated)) {
		text += truncationNotice(result.totalFiles, result.ripgrepTruncated);
	}
	return text;
}
