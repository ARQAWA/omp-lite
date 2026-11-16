import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { stage } from "../../scripts/rqw-windows-pack/build/index.js";
import { fetchPinned, pins } from "../../scripts/rqw-windows-pack/runtime/index.js";

const temp = () => mkdtempSync(join(tmpdir(), "rqw-windows-pack-build-"));

function write(file, data) {
	mkdirSync(dirname(file), { recursive: true });
	writeFileSync(file, data);
	return file;
}

test("staging copies only the manifest entries and refuses a development file", async () => {
	const root = temp();
	const dist = join(root, "dist");
	const manifest = { version: 1, files: [{ from: "src/a.js", to: "extensions/a.js" }], config: [{ from: "src/config.yml" }], vscode: { files: [{ from: "src/vs/index.js", to: "index.js" }] } };
	for (const name of ["install.manifest.json", "src/a.js", "src/config.yml", "src/vs/index.js", "src/secret.js", "dev/tool.js"]) write(join(root, name), name);
	await stage(root, dist, manifest, "f".repeat(40));
	const files = readdirSync(dist, { recursive: true }).filter(name => statSync(join(dist, name)).isFile()).sort();
	expect(files).toEqual(["index.js", "payload/.revision", "payload/install.manifest.json", "payload/src/a.js", "payload/src/config.yml"]);
	expect(readFileSync(join(dist, "payload/.revision"), "utf8")).toBe("f".repeat(40) + "\n");
	await expect(stage(root, dist, { ...manifest, files: [{ from: "dev/tool.js", to: "extensions/tool.js" }] }, "f".repeat(40))).rejects.toThrow("Development file installed: dev/tool.js");
});

test("a pinned file is downloaded once and only with the pinned size and hash", async () => {
	const file = join(temp(), "omp.exe");
	const asset = { url: "https://pin", size: 3, sha256: createHash("sha256").update("omp").digest("hex") };
	let body = "bad";
	const request = async () => new Response(body);
	await expect(fetchPinned(file, asset, request)).rejects.toThrow("Checksum mismatch: omp.exe");
	expect(existsSync(file)).toBe(false);
	body = "omp";
	expect([await fetchPinned(file, asset, request), await fetchPinned(file, asset, () => Promise.reject(new Error("no network")))]).toEqual(["downloaded", "cached"]);
	expect(readdirSync(dirname(file))).toEqual(["omp.exe"]);
});

test("the pins name every bundled program of OMP 18.21.0", () => {
	const pin = pins();
	expect([pin.version, pin.assets.omp.file, pin.assets.model.file, pin.ffmpeg.file]).toEqual(["18.21.0", "omp.exe", "embeddinggemma-2-Q8_0.gguf", "ffmpeg.exe"]);
	for (const name of ["llama-server.exe", "msvcp140.dll", "vcruntime140.dll", "vcruntime140_1.dll"]) expect({ ...pin.llama.files, ...pin.vc.files }[name]).toMatch(/^[a-f0-9]{64}$/);
});
