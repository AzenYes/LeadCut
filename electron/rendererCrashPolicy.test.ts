import { expect, it } from "vitest";
import { shouldReload } from "./rendererCrashPolicy";

it("allows a single renderer crash to recover", () => {
	expect(shouldReload("crashed", [], 10000)).toBe(true);
});

it("allows only three attempts in a rolling minute", () => {
	expect(shouldReload("oom", [1000, 2000], 3000)).toBe(true);
	expect(shouldReload("killed", [1000, 2000, 3000], 4000)).toBe(false);
	expect(shouldReload("crashed", [1000, 2000, 3000], 62000)).toBe(true);
});

it("ignores a clean exit", () => {
	expect(shouldReload("clean-exit", [], 10000)).toBe(false);
});
