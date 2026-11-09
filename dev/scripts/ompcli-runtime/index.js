"use strict";

// Build-time loader for the pinned Windows files. Not installed with the product.
// Pins live in the product resource named by install.manifest.json.

const { createHash, randomUUID } = require("node:crypto");
const { createReadStream, createWriteStream, readFileSync } = require("node:fs");
const fs = require("node:fs/promises");
const path = require("node:path");
const { Readable, Transform } = require("node:stream");
const { pipeline } = require("node:stream/promises");

const root = path.resolve(__dirname, "../../..");

async function checksum(file) {
	const hash = createHash("sha256");
	for await (const chunk of createReadStream(file)) hash.update(chunk);
	return hash.digest("hex");
}

function resourcePath(name) {
	const manifest = JSON.parse(readFileSync(path.join(root, "install.manifest.json"), "utf8"));
	const entry = (manifest.vscode?.files ?? []).find(item => item.to === name);
	if (!entry) throw new Error("install.manifest.json has no " + name + " entry");
	return path.join(root, entry.from);
}

function pins() {
	return JSON.parse(readFileSync(resourcePath("runtime.json"), "utf8"));
}

async function fetchRuntime(file, asset, request = fetch) {
	try {
		const size = await fs.stat(file).then(stat => stat.size);
		const sized = asset.size === undefined || size === asset.size;
		if (sized && (await checksum(file)) === asset.sha256) return "cached";
	} catch (error) {
		if (error.code !== "ENOENT") throw error;
	}
	await fs.mkdir(path.dirname(file), { recursive: true });
	const temporary = file + "." + randomUUID() + ".tmp";
	try {
		const response = await request(asset.url);
		if (!response.ok || !response.body) throw new Error("OMP download failed: HTTP " + response.status);
		const hash = createHash("sha256");
		let written = 0;
		const tap = new Transform({
			transform(chunk, encoding, callback) {
				hash.update(chunk);
				written += chunk.length;
				callback(null, chunk);
			},
		});
		await pipeline(Readable.fromWeb(response.body), tap, createWriteStream(temporary, { flags: "wx" }));
		if (asset.size !== undefined && written !== asset.size) throw new Error("OMP size mismatch: " + path.basename(file));
		if (hash.digest("hex") !== asset.sha256) throw new Error("OMP checksum mismatch");
		await fs.rename(temporary, file);
		return "downloaded";
	} finally {
		await fs.rm(temporary, { force: true });
	}
}

if (require.main === module) {
	const asset = process.argv[3] ?? "omp";
	const file = process.argv[2] || path.resolve(root, "dist/ompcli/runtime", asset);
	fetchRuntime(file, pins().assets[asset])
		.then(result => console.log("OMP " + asset + ": " + result + " " + file))
		.catch(error => {
			console.error(error.message);
			process.exitCode = 1;
		});
}

module.exports = { fetchRuntime, pins, resourcePath, root };
