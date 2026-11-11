import { expect, test } from "bun:test";
import descriptions from "../../../../src/modules/base-tools/base-tools.descriptions.json";

const system = await Bun.file(new URL("../../../../src/modules/system-prompt/SYSTEM.md", import.meta.url)).text();

test("the work order lives once, in the system prompt", () => {
	expect(system).toContain("<file_work>");
	expect(system).toContain("First response: `files` for the map, plus 3-6 `files` calls with `pattern`");
	expect(system).toContain("Depth beats token cost");
	expect(system.split("<file_work>").length).toBe(2);
	expect(descriptions.files).not.toContain("3-6");
	expect(descriptions.files).toContain("Wide search pattern:");
});
