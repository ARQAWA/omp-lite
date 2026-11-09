import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { curlTransport, ensureRuntime, proxiedRequest, runtimeId, verifyRuntime, zipEntry } from "../../../../src/modules/ompcli/index.js";

const dirs = [];

function temporary() {
	const dir = mkdtempSync(join(tmpdir(), "ompcli-runtime-"));
	dirs.push(dir);
	return dir;
}

// Stored (uncompressed) zip: the reader must locate the entry by its central directory.
function zipOf(entries) {
	const locals = [];
	const central = [];
	let offset = 0;
	for (const [name, content] of Object.entries(entries)) {
		const data = Buffer.from(content);
		const nameBytes = Buffer.from(name);
		const local = Buffer.alloc(30);
		local.writeUInt32LE(0x04034b50, 0);
		local.writeUInt16LE(20, 4);
		local.writeUInt32LE(data.length, 18);
		local.writeUInt32LE(data.length, 22);
		local.writeUInt16LE(nameBytes.length, 26);
		locals.push(local, nameBytes, data);
		const entry = Buffer.alloc(46);
		entry.writeUInt32LE(0x02014b50, 0);
		entry.writeUInt16LE(20, 4);
		entry.writeUInt16LE(20, 6);
		entry.writeUInt32LE(data.length, 20);
		entry.writeUInt32LE(data.length, 24);
		entry.writeUInt16LE(nameBytes.length, 28);
		entry.writeUInt32LE(offset, 42);
		central.push(Buffer.concat([entry, nameBytes]));
		offset += 30 + nameBytes.length + data.length;
	}
	const directory = Buffer.concat(central);
	const end = Buffer.alloc(22);
	end.writeUInt32LE(0x06054b50, 0);
	end.writeUInt16LE(Object.keys(entries).length, 8);
	end.writeUInt16LE(Object.keys(entries).length, 10);
	end.writeUInt32LE(directory.length, 12);
	end.writeUInt32LE(offset, 16);
	return Buffer.concat([...locals, directory, end]);
}

afterEach(() => {
	for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

test("the pinned entry is read out of a zip archive", () => {
	const archive = zipOf({ "bun-windows-x64-baseline/bun.exe": "binary", "other.txt": "x" });
	expect(zipEntry(archive, "bun-windows-x64-baseline/bun.exe").toString()).toBe("binary");
	expect(() => zipEntry(archive, "missing.exe")).toThrow("missing.exe");
});

test("a ready marker does not hide a missing runtime file", async () => {
	const extensionPath = temporary();
	const storageDir = temporary();
	const dir = join(storageDir, "runtime", runtimeId());
	mkdirSync(join(dir, "llama"), { recursive: true });
	writeFileSync(join(dir, ".ready"), runtimeId() + "\n");
	mkdirSync(join(extensionPath, "runtime", "llama"), { recursive: true });
	let requests = 0;
	const request = async () => {
		requests++;
		return new Response("wrong bytes");
	};
	await expect(ensureRuntime({ extensionPath, storageDir, request })).rejects.toThrow("Checksum mismatch");
	expect(requests).toBe(1);
});

test("a configured proxy is used for downloads", async () => {
	const seen = [];
	const request = proxiedRequest("http://user:secret@proxy.local:8080", {
		run: async (file, args, input, options) => {
			seen.push({ file, args, options });
			return Buffer.from("{}");
		},
	});
	const response = await request("https://example.invalid/file", { headers: { accept: "application/json" } });
	expect(await response.json()).toEqual({});
	expect(seen[0].options.env.HTTPS_PROXY).toBe("http://user:secret@proxy.local:8080");
	expect(seen[0].options.env.HTTP_PROXY).toBe("http://user:secret@proxy.local:8080");
	expect(seen[0].args.join(" ")).not.toContain("secret");
	expect(seen[0].args).toContain("accept: application/json");
	expect(seen[0].args).toContain("https://example.invalid/file");
	expect(seen[0].args).not.toContain("--insecure");
});

test("strict TLS stays on unless the user turned it off", async () => {
	const seen = [];
	const request = proxiedRequest("http://proxy.local:8080", {
		insecure: true,
		run: async (file, args) => {
			seen.push(args);
			return Buffer.from("{}");
		},
	});
	await request("https://example.invalid/file");
	expect(seen[0]).toContain("--insecure");
});

test("a cached runtime is verified by content, not by the ready marker", async () => {
	const dir = temporary();
	expect(await verifyRuntime(dir)).toBe(false);
	mkdirSync(join(dir, "llama"), { recursive: true });
	writeFileSync(join(dir, "omp.exe"), "not the pinned binary");
	expect(await verifyRuntime(dir)).toBe(false);
});

test("proxied assets stream to a file instead of memory", async () => {
	const seen = [];
	const download = curlTransport("http://user:secret@proxy.local:8080", {
		run: async (file, args, input, options) => {
			seen.push({ file, args, options });
			return Buffer.alloc(0);
		},
	});
	await download("https://example.invalid/model.gguf", "/tmp/model.part");
	expect(seen[0].args).toContain("--output");
	expect(seen[0].args).toContain("/tmp/model.part");
	expect(seen[0].args).toContain("--location");
	expect(seen[0].args.join(" ")).not.toContain("secret");
	expect(seen[0].options.env.HTTPS_PROXY).toContain("secret");
});
