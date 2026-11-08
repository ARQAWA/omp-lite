import { expect, test } from "bun:test";
import backgroundJobs, { jobsText } from "../../../../src/modules/background-jobs/index.js";

function mount(running, mode = "tui") {
	const handlers = {};
	const painted = [];
	const pi = { on: (event, handler) => (handlers[event] = handler) };
	backgroundJobs(pi);
	const ctx = {
		mode,
		hasUI: true,
		agent: { kind: "main" },
		ui: { setStatus: (key, text) => painted.push([key, text]) },
		getAsyncJobSnapshot: () => ({ running }),
		setInterval: () => {},
	};
	handlers.session_start({}, ctx);
	return painted;
}

test("counts running jobs", () => {
	expect(jobsText(3)).toBe("⚙ 3");
	expect(jobsText(0)).toBeUndefined();
});

test("paints the count and clears at idle", () => {
	expect(mount([{}, {}])).toEqual([["50-jobs", "⚙ 2"]]);
	expect(mount([])).toEqual([["50-jobs", undefined]]);
});

test("paints nothing outside the main TUI", () => {
	expect(mount([{}], "print")).toEqual([]);
});
