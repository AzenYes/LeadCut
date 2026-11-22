import { expect, it, vi } from "vitest";
import { normalizeWaveformPeaks } from "../../../src/lib/normalizeWaveformPeaks";
import { createPeakAccumulator } from "./peaks";

vi.mock("../ffmpeg/binary", () => ({ getFfmpegBinaryPath: () => "ffmpeg" }));
vi.mock("../recording/diagnostics", () => ({ probeMediaDurationSeconds: async () => 0 }));

const createAccumulator = () => createPeakAccumulator({ sampleRate: 8000, peaksPerSecond: 100 });

function silenceThenTone() {
	const input = Buffer.alloc(16_000 * 2);
	for (let offset = 8_000 * 2; offset < input.length; offset += 2) {
		input.writeInt16LE(offset % 4 === 0 ? -32_768 : 32_767, offset);
	}
	return input;
}

it("returns 100 silent and 100 full-scale buckets for two seconds of PCM", () => {
	const accumulator = createAccumulator();
	accumulator.push(silenceThenTone());
	const { durationMs, peaks } = accumulator.finish();
	expect(durationMs).toBe(2000);
	expect(peaks).toHaveLength(200);
	expect(peaks.slice(0, 100).every((peak) => peak === 0)).toBe(true);
	expect(peaks.slice(100).every((peak) => peak === 1)).toBe(true);
});

it("keeps the same samples when chunks split the bytes of a signed sample", () => {
	const input = silenceThenTone();
	const complete = createAccumulator();
	const scattered = createAccumulator();
	complete.push(input);
	for (let offset = 0; offset < input.length; offset += 521) {
		scattered.push(input.subarray(offset, offset + 521));
	}
	expect(scattered.finish()).toEqual(complete.finish());
});

it("includes any last partial bucket", () => {
	const accumulator = createAccumulator();
	accumulator.push(Buffer.alloc(8001 * 2));
	const { durationMs, peaks } = accumulator.finish();
	expect(durationMs).toBe(1000.125);
	expect(peaks).toHaveLength(Math.ceil((durationMs / 1000) * 100));
});

it("uses the same 99.5th-percentile scale and sparse fallback as the previous waveform path", () => {
	const typical = new Float32Array(500).fill(0.25);
	typical[0] = 0.125;
	typical[499] = 1.0;
	const expected = typical.map((peak) => Math.min(1, peak / 0.25));
	expect(normalizeWaveformPeaks(typical)).toEqual(expected);
	const sparse = new Float32Array(500);
	sparse[250] = 0.65;
	expect(normalizeWaveformPeaks(sparse)[250]).toBe(1);
});
