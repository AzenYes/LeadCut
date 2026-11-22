import { describe, expect, it } from "vitest";
import { getVisibleWaveformSpan, sampleWaveformWindow } from "./waveformSampling";

describe("waveform viewport mapping", () => {
	it("maps a moved, trimmed, accelerated clip back to its original audio", () => {
		expect(
			getVisibleWaveformSpan(
				{ start: 1000, end: 3000 },
				{ start: 8000, end: 12000 },
				{ start: 1500, end: 2500 },
			),
		).toEqual({
			display: { start: 1500, end: 2500 },
			source: { start: 9000, end: 11000 },
		});
	});

	it("does not allocate a canvas for offscreen or empty clips", () => {
		for (const display of [
			{ start: 0, end: 1000 },
			{ start: 2500, end: 2500 },
		]) {
			expect(getVisibleWaveformSpan(display, display, { start: 2000, end: 3000 })).toBeNull();
		}
	});
});

describe("waveform sampling", () => {
	it("keeps a brief sound visible when multiple peaks share a pixel", () => {
		const audio = { durationMs: 800, peaks: new Float32Array([0, 0, 1, 0, 0, 0, 0, 0]) };
		expect([...sampleWaveformWindow(audio, 0, 800, 2)]).toEqual([1, 0]);
	});

	it("shows genuine silence as zero without inventing an interpolated sound", () => {
		const audio = { durationMs: 400, peaks: new Float32Array([1, 0, 0, 1]) };
		expect([...sampleWaveformWindow(audio, 100, 300, 4)]).toEqual([0, 0, 0, 0]);
	});

	it("samples a cropped source region rather than the clip's timeline position", () => {
		const audio = { durationMs: 400, peaks: new Float32Array([0, 0.25, 0.5, 1]) };
		expect([...sampleWaveformWindow(audio, 200, 400, 2)]).toEqual([0.5, 1]);
	});

	it("keeps time outside the audio duration flat", () => {
		const audio = { durationMs: 200, peaks: new Float32Array([1, 1]) };
		expect([...sampleWaveformWindow(audio, -100, 300, 4)]).toEqual([0, 1, 1, 0]);
	});
});
