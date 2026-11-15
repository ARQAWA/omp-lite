"use strict";

// Build-time loader for the pinned Windows files of RQW Windows Pack. Not installed with the product.
// The pins live in the product resource `runtime.json`, found through install.manifest.json.

const { createHash, randomUUID } = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "../../../..");

function pins() {
	const manifest = JSON.parse(fs.readFileSync(path.join(root, "install.manifest.json"), "utf8"));
	return JSON.parse(fs.readFileSync(path.join(root, manifest.vscode.files.find(entry => entry.to === "runtime.json").from), "utf8"));
}

async function matches(file, asset) {
	const stat = await fs.promises.stat(file).catch(() => null);
	if (!stat || (asset.size !== undefined && stat.size !== asset.size)) return false;
	const hash = createHash("sha256");
	for await (const chunk of fs.createReadStream(file)) hash.update(chunk);
	return hash.digest("hex") === asset.sha256;
}

// Downloads next to the target and renames only a file with the pinned size and SHA-256:
// an error leaves the previous file in place.
async function fetchPinned(file, asset, request = fetch) {
	if (await matches(file, asset)) return "cached";
	await fs.promises.mkdir(path.dirname(file), { recursive: true });
	const temporary = file + "." + randomUUID() + ".tmp";
	try {
		const response = await request(asset.url);
		if (!response.ok || !response.body) throw new Error("Download failed: HTTP " + response.status);
		await fs.promises.writeFile(temporary, response.body);
		if (!(await matches(temporary, asset))) throw new Error("Checksum mismatch: " + path.basename(file));
		await fs.promises.rename(temporary, file);
		return "downloaded";
	} finally {
		await fs.promises.rm(temporary, { force: true });
	}
}

module.exports = { fetchPinned, pins, root };
