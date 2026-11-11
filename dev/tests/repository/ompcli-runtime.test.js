import { afterEach, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { fetchRuntime, pins, resourcePath, root } from "../../scripts/ompcli-runtime/index.js";

const dirs = [];
const bytes = "verified omp";
const digest = createHash("sha256").update(bytes).digest("hex");
const asset = { url: "https://example.invalid/omp.exe", sha256: digest };

function output() {
	const dir = mkdtempSync(join(tmpdir(), "ompcli-runtime-"));
	dirs.push(dir);
	return join(dir, "omp.exe");
}

afterEach(() => {
	for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

test("downloads the verified binary and reuses it", async () => {
	const file = output();
	let requests = 0;
	const request = async () => {
		requests++;
		return new Response(bytes);
	};
	expect(await fetchRuntime(file, asset, request)).toBe("downloaded");
	expect(readFileSync(file, "utf8")).toBe(bytes);
	expect(await fetchRuntime(file, asset, request)).toBe("cached");
	expect(requests).toBe(1);
});

test("reuses a verified file of the pinned size and rejects a wrong size", async () => {
	const file = output();
	writeFileSync(file, bytes);
	expect(await fetchRuntime(file, { ...asset, size: bytes.length }, async () => {
		throw new Error("must not download");
	})).toBe("cached");
	await expect(fetchRuntime(file, { ...asset, size: bytes.length + 1 }, async () => new Response(bytes))).rejects.toThrow("size mismatch");
	expect(readFileSync(file, "utf8")).toBe(bytes);
});

test("keeps the existing binary when verification fails", async () => {
	const file = output();
	writeFileSync(file, "previous binary");
	await expect(fetchRuntime(file, asset, async () => new Response("wrong"))).rejects.toThrow("checksum mismatch");
	expect(readFileSync(file, "utf8")).toBe("previous binary");
});

test("keeps the existing binary on download errors", async () => {
	const file = output();
	writeFileSync(file, "previous binary");
	await expect(fetchRuntime(file, asset, async () => new Response(null, { status: 503 }))).rejects.toThrow("HTTP 503");
	expect(readFileSync(file, "utf8")).toBe("previous binary");
});

test("an interrupted download keeps the previous file and removes the temporary one", async () => {
	const file = output();
	writeFileSync(file, "previous binary");
	const request = async () => new Response(new ReadableStream({
		start(controller) {
			controller.enqueue(new TextEncoder().encode("partial"));
			controller.error(new Error("aborted"));
		},
	}));
	await expect(fetchRuntime(file, asset, request)).rejects.toThrow();
	expect(readFileSync(file, "utf8")).toBe("previous binary");
	expect(readdirSync(join(file, "..")).filter(name => name.endsWith(".tmp"))).toEqual([]);
});

test("pins are read from the product resource named by the install manifest", () => {
	const manifest = JSON.parse(readFileSync(join(root, "install.manifest.json"), "utf8"));
	const entry = manifest.vscode.files.find(item => item.to === "runtime.json");
	expect(entry).toBeDefined();
	expect(resourcePath("runtime.json")).toBe(join(root, entry.from));
	const values = pins();
	expect(values.version).toBe("18.18.8");
	for (const name of ["omp", "model"]) {
		for (const field of ["url", "sha256", "size", "file"]) expect(values.assets[name][field]).toBeDefined();
	}
	expect(statSync(resourcePath("runtime.json")).isFile()).toBe(true);
	expect(relative(root, resourcePath("runtime.json")).startsWith("src/modules/ompcli/")).toBe(true);
});
