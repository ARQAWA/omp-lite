import { expect, test } from "bun:test";
import { existsSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { gzipSync } from "node:zlib";
import { world, write } from "./helpers.js";

const sha = "b".repeat(40);
const installed = { "ext/runtime.json": "{}", "ext/index.js": "code", "ext/package.json": JSON.stringify({ name: "ompcli", __metadata: { id: "vscode adds this" } }) };

// The archive GitHub serves for a commit: one root folder, ustar headers.
function archive({ runtime = "{}", code = "code", to = "extensions/a.js" } = {}) {
	const files = {
		"install.manifest.json": JSON.stringify({
			version: 1,
			files: [{ from: "src/a.js", to }],
			config: [{ from: "src/config.yml" }],
			vscode: { files: [{ from: "src/vs/runtime.json", to: "runtime.json" }, { from: "src/vs/index.js", to: "index.js" }, { from: "src/vs/package.json", to: "package.json" }] },
		}),
		"src/a.js": "harness",
		"src/config.yml": "b: 2\n",
		"src/vs/runtime.json": runtime,
		"src/vs/index.js": code,
		"src/vs/package.json": JSON.stringify({ name: "ompcli" }),
		"README.md": "not in the manifest",
	};
	const blocks = [];
	for (const [name, text] of Object.entries(files)) {
		const header = Buffer.alloc(512);
		const body = Buffer.from(text);
		header.write("omp-lite-" + sha + "/" + name);
		header.write(body.length.toString(8).padStart(11, "0"), 124);
		header.write("        0", 148);
		header.write(header.reduce((sum, byte) => sum + byte, 0).toString(8).padStart(6, "0") + "\0 ", 148);
		blocks.push(header, body, Buffer.alloc((512 - (body.length % 512)) % 512));
	}
	return gzipSync(Buffer.concat([...blocks, Buffer.alloc(1024)]));
}

// GitHub of this test: the head of main and the archive of that commit.
function github(options) {
	const calls = [];
	const state = { calls, body: () => archive(options) };
	state.request = async (url, init) => {
		calls.push([url, init?.headers]);
		if (url === "https://api.github.com/repos/ARQAWA/omp-lite/commits/main") return Response.json({ sha });
		if (url === "https://codeload.github.com/ARQAWA/omp-lite/tar.gz/" + sha) return new Response(state.body());
		return url.endsWith("/health") ? new Response("ok") : Response.json({ data: [{ embedding: Array(768).fill(1) }] });
	};
	return state;
}

const base = w => join(w.storage, "payload/1.0.0");
const failed = "OMP CLI update failed: ";

test("Update installs the head of main, points to it and drops other revisions", async () => {
	const hub = github();
	const w = world({ request: hub.request, files: { ...installed, "storage/payload/1.0.0/old/x": "x" } });
	await w.run("ompcli.update");
	expect(w.state.messages).toEqual(["omp-lite updated. Open a new tab."]);
	expect(hub.calls[0][1]).toEqual({ accept: "application/vnd.github+json", "user-agent": "arqawa-ompcli" });
	expect(readFileSync(join(w.agent, "extensions/a.js"), "utf8")).toBe("harness");
	expect(readdirSync(base(w)).sort()).toEqual([sha, "current.json"]);
	expect(JSON.parse(readFileSync(join(base(w), "current.json"), "utf8"))).toBe(sha);
	// Only the files the manifest names are unpacked; the archive itself is gone.
	expect(readdirSync(join(base(w), sha), { recursive: true }).filter(name => name.includes(".")).sort()).toEqual(["install.manifest.json", "src/a.js", "src/config.yml"]);
	expect(readdirSync(w.storage).sort()).toEqual(["model", "payload"]);
	// The same revision again: nothing is downloaded, a lost harness file comes back.
	rmSync(join(w.agent, "extensions/a.js"));
	await w.run("ompcli.update");
	expect(hub.calls.filter(([url]) => url.includes("codeload")).length).toBe(1);
	expect(readFileSync(join(w.agent, "extensions/a.js"), "utf8")).toBe("harness");
	// The next tab runs on the new revision.
	await w.tab();
	expect(w.state.spawned.at(-1).options.env.PI_CONFIG_FILES).toStartWith(join(base(w), sha, "src/config.yml") + ";");
});

test("Update is refused with open tabs, with new bundled programs and with a broken pointer", async () => {
	const w = world({ request: github({ runtime: '{"new":1}' }).request, files: installed });
	await w.run("ompcli.update");
	expect(w.state.messages).toEqual([failed + "OMP CLI bootstrap changed. Update OMP CLI in Marketplace."]);
	expect([existsSync(base(w)), existsSync(join(w.agent, "extensions/a.js"))]).toEqual([false, false]);
	const pointer = write(join(base(w), "current.json"), "{broken");
	await w.run("ompcli.update");
	expect(w.state.messages[1]).toBe(failed + "Invalid payload pointer: " + pointer);
	expect(readdirSync(base(w))).toEqual(["current.json"]);
	rmSync(pointer);
	await w.tab();
	await w.run("ompcli.update");
	expect(w.state.messages[2]).toBe(failed + "Close OMP CLI tabs before updating.");
});

test("newer extension code in main: the harness is installed and Marketplace is named", async () => {
	const w = world({ request: github({ code: "newer code" }).request, files: installed });
	await w.run("ompcli.update");
	expect(w.state.messages).toEqual(["omp-lite updated. Open a new tab.", "A newer OMP CLI is in Marketplace."]);
	expect(existsSync(join(w.agent, "extensions/a.js"))).toBe(true);
});

test("a broken download, archive or install leaves nothing behind and does not block the next Update", async () => {
	const hub = github();
	const w = world({ request: hub.request, files: installed });
	const broken = [[() => null, "OMP download failed: HTTP 200"], [() => "not a gzip", "OMP extraction failed: "], [() => archive({ to: "../outside.js" }), "Unsafe path: ../outside.js"]];
	for (const [body, reason] of broken) {
		hub.body = body;
		await w.run("ompcli.update");
		expect(w.state.messages.at(-1)).toStartWith(failed + reason);
		expect(readdirSync(w.storage).filter(name => name !== "payload")).toEqual(["model"]);
		expect([existsSync(join(base(w), "current.json")), existsSync(join(base(w), sha)), existsSync(join(w.root, "outside.js"))]).toEqual([false, false, false]);
	}
	hub.body = () => archive();
	await w.run("ompcli.update");
	expect(w.state.messages.at(-1)).toBe("omp-lite updated. Open a new tab.");
});
