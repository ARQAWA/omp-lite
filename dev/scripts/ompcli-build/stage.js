"use strict";

// Staging tree for the VSIX: only explicit manifest entries. Config fragments are
// copied as they are: OMP reads them as overlays, and the memory overlay of the window comes last.

const fs = require("node:fs");
const fsp = require("node:fs/promises");
const path = require("node:path");

async function copyEntry(root, target, entry) {
	const source = path.join(root, entry.from);
	if (entry.from.startsWith("dev/") || entry.from.endsWith("README.md")) throw new Error("Development file installed: " + entry.from);
	if (!fs.statSync(source).isFile()) throw new Error("Not a file: " + entry.from);
	await fsp.mkdir(path.dirname(target), { recursive: true });
	await fsp.copyFile(source, target);
}

async function stage(root, dist, manifest, revision) {
	await fsp.rm(dist, { recursive: true, force: true });
	await fsp.mkdir(dist, { recursive: true });
	for (const entry of manifest.vscode.files) await copyEntry(root, path.join(dist, entry.to), entry);
	const payload = path.join(dist, "payload");
	for (const entry of [...manifest.files, ...manifest.config]) await copyEntry(root, path.join(payload, entry.from), { from: entry.from });
	await fsp.copyFile(path.join(root, "install.manifest.json"), path.join(payload, "install.manifest.json"));
	await fsp.writeFile(path.join(payload, ".revision"), revision + "\n");
	return dist;
}

module.exports = { stage };
