import { describe, expect, it } from "vitest";
import { resolveCompanionPreviewTargetTime } from "./companionAudioTiming";

const mic = { kind: "mic", durationSec: 2212.7825, audioDurationSec: 2211.48, startDelayMs: 1140 } as const;

describe("companion audio preview timing", () => {
	it("seeks to the original microphone samples at the authored video in-point", () => {
		const timing = resolveCompanionPreviewTargetTime({ ...mic, currentTimeSec: 17.4 });
		expect(timing.targetTimeSec).toBeCloseTo(16.26, 5);
		expect(timing.beforeAudioStart).toBe(false);
	});

	it("holds the microphone silent before its first recorded sample", () => {
		expect(resolveCompanionPreviewTargetTime({ ...mic, currentTimeSec: 0.5 })).toEqual({
			targetTimeSec: 0,
			beforeAudioStart: true,
		});
	});

	it.each([undefined, 3000])("retains the source position for unusable mic delays (%s ms)", startDelayMs => {
		expect(resolveCompanionPreviewTargetTime({
			...mic, durationSec: 60, audioDurationSec: 59.7, currentTimeSec: 17.4, startDelayMs,
		})).toEqual({ targetTimeSec: 17.4, beforeAudioStart: false });
	});

	it.each([
		{ durationSec: 10, audioDurationSec: 9.7, startDelayMs: undefined, expected: 5.7 },
		{ durationSec: 10, audioDurationSec: 8, startDelayMs: 1500, expected: 4.5 },
		{ durationSec: 7, audioDurationSec: 6.8, startDelayMs: 6500, expected: 6 },
		{ durationSec: 10, audioDurationSec: 9.7, startDelayMs: 10000, expected: 6 },
	])("preserves system-audio timing for a $durationSec s video and $startDelayMs ms recorded delay", ({ expected, ...timing }) => {
		const target = resolveCompanionPreviewTargetTime({ ...timing, currentTimeSec: 6, kind: "system" });
		expect(target.targetTimeSec).toBeCloseTo(expected, 5);
		expect(target.beforeAudioStart).toBe(false);
	});
});
