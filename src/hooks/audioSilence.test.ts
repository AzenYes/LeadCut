import { expect, it } from "vitest";
import { createSilenceDetector } from "./audioSilence";

it("reports sustained silence only once until the signal returns", () => {
	const observe = createSilenceDetector({ threshold: 2 });
	expect(observe(0, 100)).toBe(false);
	expect(observe(1, 10099)).toBe(false);
	expect(observe(0, 10100)).toBe(true);
	expect(observe(0, 12000)).toBe(false);
	expect(observe(12, 12500)).toBe(false);
	expect(observe(0, 12600)).toBe(false);
	expect(observe(0, 22600)).toBe(true);
});

it("restarts the silence window when sound returns before the threshold time", () => {
	const observe = createSilenceDetector({ threshold: 2, windowMs: 1000 });
	expect(observe(1, 0)).toBe(false);
	expect(observe(3, 999)).toBe(false);
	expect(observe(1, 1000)).toBe(false);
	expect(observe(1, 1999)).toBe(false);
	expect(observe(1, 2000)).toBe(true);
});
