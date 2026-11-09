import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const config = Bun.YAML.parse(readFileSync(join(import.meta.dir, "../../../../src/modules/runtime-config/config.yml"), "utf8"));
const route = command => config.bashInterceptor.patterns.find(rule => new RegExp(rule.pattern).test(command))?.tool;

test("native bash routing is enabled for file reads and searches", () => {
	expect(config.bashInterceptor.enabled).toBe(true);
	for (const command of ["cat Makefile", "head -3 file", "tail -20 file", "less file", "more file", "sed -n '1,3p' file"]) {
		expect(route(command)).toBe("read");
	}
	for (const command of ["ls", "ls -la", "ls -R src", "tree", "tree rust"]) expect(route(command)).toBe("read");
	for (const command of ["grep -n seller src", "rg seller src", "ag seller src"]) expect(route(command)).toBe("grep");
	for (const command of ["find . -maxdepth 2", "find src -type f", "fd -e rs", "locate file"]) expect(route(command)).toBe("glob");
});

test("custom routing retains native edit, write and managed service rules", () => {
	expect(route("sed -i 's/a/b/' file")).toBe("edit");
	expect(route("perl -pi -e 's/a/b/' file")).toBe("edit");
	expect(route("awk -i inplace '{print}' file")).toBe("edit");
	expect(route("printf 'value' > file")).toBe("write");
	expect(route("cat <<'EOF' > file")).toBe("write");
	expect(route("nohup node server.js")).toBe("bash");
	expect(route("bun run dev")).toBe("bash");
	expect(route("cargo watch --watch src")).toBe("bash");
	for (const command of ["git status", "wc -l file", "echo hi | grep hi"]) expect(route(command)).toBeUndefined();
});
