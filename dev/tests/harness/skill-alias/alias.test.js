import { expect, test } from "bun:test";
import skillAlias from "../../../../src/modules/skill-alias/index.js";

function handler(names) {
	let registered;
	skillAlias({ on: (_event, fn) => (registered = fn), getCommands: () => names.map(name => ({ name })) });
	return registered;
}

const skillCommands = ["skill:probe", "skill:review", "model"];

test("rewrites a skill name to the native form", () => {
	expect(handler(skillCommands)({ text: "/probe" })).toEqual({ text: "/skill:probe" });
	expect(handler(skillCommands)({ text: "/probe два слова" })).toEqual({ text: "/skill:probe два слова" });
});

test("leaves unknown names and real commands alone", () => {
	const run = handler(skillCommands);
	expect(run({ text: "/nope" })).toBeUndefined();
	expect(run({ text: "/model" })).toBeUndefined();
	expect(run({ text: "/skill:probe" })).toBeUndefined();
	expect(run({ text: "просто текст" })).toBeUndefined();
});

test("does not shadow a command with the same name", () => {
	expect(handler(["skill:model", "model"])({ text: "/model" })).toBeUndefined();
});
