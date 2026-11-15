import { expect, test } from "bun:test";
import { readFileSync, readdirSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";
import { sweep, transport } from "../../../../src/modules/rqw-windows-pack/vscode/index.js";
import { temp, world, write } from "./helpers.js";

const KEY = "ad591530-694c-42f1-9f01-f03bee4cca1c.txt";

test("the storage keeps its own short list and loses everything else", async () => {
	const dir = temp();
	const own = ["model/model.gguf", "payload/1.0.0/current.json", "runs/7-a/memory.yml", "shell-7.sh", "stt.json", KEY];
	const foreign = ["model/model.gguf.x.tmp", "payload/0.9.0/current.json", "runs/8-b/memory.yml", "runs/junk", "shell-8.sh", "runtime/omp.exe", "leases/7.json", "omp-lite-x.tar.gz", "extract.js"];
	for (const name of [...own, ...foreign]) write(join(dir, name), "x");
	await sweep(dir, "1.0.0", "model.gguf", pid => pid === 7);
	expect(readdirSync(dir, { recursive: true }).filter(name => statSync(join(dir, name)).isFile()).sort()).toEqual([...own].sort());
});

test("a damaged omp.exe stops the tab; the cleanup has already run", async () => {
	const w = world({ files: { "storage/junk.tmp": "x" } });
	write(join(w.ext, "runtime/omp.exe"), "damaged");
	await w.tab();
	expect(w.state.messages).toEqual(["OMP CLI is damaged: omp.exe. Reinstall the extension."]);
	expect(w.state.spawned).toEqual([]);
	expect(readdirSync(w.storage)).toEqual(["model"]);
});

test("the model is the only download: checked, kept, and its failure only turns memory off", async () => {
	const answers = { "https://model": "model-bytes" };
	const w = world({ request: async url => (url === "https://model" ? new Response(answers[url], { status: answers[url] ? 200 : 404 }) : url.endsWith("/health") ? new Response("ok") : Response.json({ data: [{ embedding: Array(768).fill(1) }] })) });
	const model = join(w.storage, "model/model.gguf");
	rmSync(model);
	await w.tab();
	expect(readFileSync(model, "utf8")).toBe("model-bytes");
	expect(w.state.spawned[0].args[3]).toContain(`'--model'' ''${model}'`);
	expect(w.state.messages).toEqual([]);
	const failures = [
		[() => (answers["https://model"] = "wrong-bytes"), "Checksum mismatch: model.gguf"],
		[() => delete answers["https://model"], "OMP CLI could not download model.gguf: OMP download failed: HTTP 404"],
		[() => rmSync(join(w.ext, "runtime/llama/llama-server.exe")), "OMP CLI is damaged: llama-server.exe. Reinstall the extension."],
	];
	for (const [breakIt, reason] of failures) {
		write(model, "damaged");
		breakIt();
		w.state.messages.length = 0;
		await w.tab();
		expect(w.state.messages[0]).toStartWith("OMP CLI: memory is off. " + reason);
		// The tab opened all the same, and no half-downloaded file is left.
		expect(w.state.spawned.at(-1).args[3]).toContain("omp.exe");
		expect(readdirSync(join(w.storage, "model"))).toEqual(["model.gguf"]);
	}
});

test("with a proxy every request goes through curl, the proxy only in its environment", async () => {
	const calls = [];
	const web = transport({ proxy: "http://user:secret@proxy:8080", insecure: true, run: async (args, env) => (calls.push({ args, env }), '{"sha":"x"}') });
	expect(await web.json("https://api", { accept: "json" })).toEqual({ sha: "x" });
	await web.download("https://file", "C:\\out");
	const common = ["--fail", "--silent", "--show-error", "--location", "--insecure"];
	expect(calls.map(call => call.args)).toEqual([[...common, "--header", "accept: json", "https://api"], [...common, "--retry", "3", "--output", "C:\\out", "https://file"]]);
	for (const { env } of calls) expect([env.HTTP_PROXY, env.HTTPS_PROXY, env.ALL_PROXY]).toEqual(Array(3).fill("http://user:secret@proxy:8080"));
});
