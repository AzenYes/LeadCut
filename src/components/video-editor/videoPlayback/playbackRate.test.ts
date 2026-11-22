import { afterEach, expect, it, vi } from "vitest";
import { REVIEW_RATES } from "./playbackStepping";

afterEach(() => {
	vi.unstubAllGlobals();
	vi.resetModules();
});

it("probes and caches the runtime's accepted rates", async () => {
	const createElement = vi.fn(() => ({
		set playbackRate(rate: number) {
			if (rate > 16) throw new DOMException("Unsupported rate", "NotSupportedError");
		},
	}));
	vi.stubGlobal("document", { createElement });
	const { supportsPreviewPlaybackRate } = await import("./playbackRate");
	for (const speed of [0.25, 1, 3, 15, 16]) expect(supportsPreviewPlaybackRate(speed)).toBe(true);
	for (const speed of [20, 30]) expect(supportsPreviewPlaybackRate(speed)).toBe(false);
	expect(supportsPreviewPlaybackRate(20)).toBe(false);
	expect(createElement).toHaveBeenCalledTimes(7);
	for (const speed of [0, -1, NaN, Infinity])
		expect(supportsPreviewPlaybackRate(speed)).toBe(false);
});

it.each([
	{ lower: 0.25, upper: 16 },
	{ lower: 0.5, upper: 4 },
	{ lower: 1, upper: 30 },
])("exposes only supported steps between $lower and $upper", async ({ lower, upper }) => {
	vi.stubGlobal("document", { createElement: () => ({
		set playbackRate(rate: number) {
			if (rate < lower || rate > upper) throw new DOMException("Unsupported", "NotSupportedError");
		},
	}) });
	const { getPreviewPlaybackRateRange } = await import("./playbackRate");
	expect(getPreviewPlaybackRateRange()).toEqual({ min: lower, max: upper });
});

it("limits an 8× shuttle at 3× review speed to the runtime ceiling", async () => {
	const { applyPreviewPlaybackRate } = await import("./playbackRate");
	let playbackRate = 1;
	const media = {
		get playbackRate() { return playbackRate; },
		set playbackRate(rate: number) {
			if (rate > 16) throw new DOMException("Unsupported", "NotSupportedError");
			playbackRate = rate;
		},
	};
	const reviewRate = REVIEW_RATES[REVIEW_RATES.length - 1];
	expect(reviewRate * 8).toBe(24);
	expect(() => applyPreviewPlaybackRate(media as HTMLMediaElement, reviewRate * 8)).not.toThrow();
	expect(media.playbackRate).toBeLessThanOrEqual(16);
	expect(media.playbackRate).toBeCloseTo(16, 2);
});
