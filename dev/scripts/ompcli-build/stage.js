"use strict";

// Staging tree for the VSIX: only explicit manifest entries, and the payload
// keeps the native file list without the persistent memory block, which the
// Windows overlay supplies per window.

const fs = require("node:fs");
const fsp = require("node:fs/promises");
const path = require("node:path");

const OVERLAY_KEYS = ["memory", "mnemopi"];

async function copyEntry(root, target, entry) {
	const source = path.join(root, entry.from);
	if (entry.from.startsWith("dev/") || entry.from.endsWith("README.md")) throw new Error("Development file installed: " + entry.from);
	if (!fs.statSync(source).isFile()) throw new Error("Not a file: " + entry.from);
	await fsp.mkdir(path.dirname(target), { recursive: true });
	await fsp.copyFile(source, target);
}

async function copyConfig(root, payload, entry) {
	const api = globalThis.Bun?.YAML;
	if (!api) throw new Error("Bun YAML is required to stage configuration");
	const value = api.parse(await fsp.readFile(path.join(root, entry.from), "utf8"));
	for (const key of OVERLAY_KEYS) delete value[key];
	const target = path.join(payload, entry.from);
	await fsp.mkdir(path.dirname(target), { recursive: true });
	await fsp.writeFile(target, api.stringify(value, null, 2) + "\n");
}

async function stage(root, dist, manifest, revision) {
	await fsp.rm(dist, { recursive: true, force: true });
	await fsp.mkdir(dist, { recursive: true });
	for (const entry of manifest.vscode.files) await copyEntry(root, path.join(dist, entry.to), entry);
	const payload = path.join(dist, "payload");
	for (const entry of manifest.files) await copyEntry(root, path.join(payload, entry.from), { from: entry.from });
	for (const entry of manifest.config) await copyConfig(root, payload, entry);
	await fsp.copyFile(path.join(root, "install.manifest.json"), path.join(payload, "install.manifest.json"));
	await fsp.writeFile(path.join(payload, ".revision"), revision + "\n");
	return dist;
}

module.exports = { stage, OVERLAY_KEYS };
