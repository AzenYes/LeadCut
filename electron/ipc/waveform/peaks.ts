import { spawn } from "node:child_process";
import { normalizeWaveformPeaks } from "../../../src/lib/normalizeWaveformPeaks";
import { getFfmpegBinaryPath } from "../ffmpeg/binary";
import { probeMediaDurationSeconds } from "../recording/diagnostics";

export const WAVEFORM_SAMPLE_RATE = 8000;
export const WAVEFORM_PEAKS_PER_SECOND = 100;

export interface WaveformPeaks {
	durationMs: number;
	peaks: Float32Array;
}

export type WaveformPeaksResponse =
	| ({ success: true } & WaveformPeaks)
	| { success: true; noAudio: true }
	| { success: false; error: string; unavailable?: boolean };

export function createPeakAccumulator({
	sampleRate,
	peaksPerSecond,
}: {
	sampleRate: number;
	peaksPerSecond: number;
}) {
	if (
		!Number.isSafeInteger(sampleRate) ||
		!Number.isSafeInteger(peaksPerSecond) ||
		peaksPerSecond <= 0 ||
		sampleRate < peaksPerSecond
	) {
		throw new Error("Invalid waveform sample or peak rate");
	}
	const completed: number[] = [];
	let samples = 0;
	let peak = 0;
	let trailingByte: number | undefined;
	let nextBucketEnd = Math.ceil(sampleRate / peaksPerSecond);

	const acceptSample = (sample: number) => {
		peak = Math.max(peak, Math.abs(sample) / 32_768);
		samples++;
		if (samples >= nextBucketEnd) {
			completed.push(peak);
			nextBucketEnd = Math.ceil(((completed.length + 1) * sampleRate) / peaksPerSecond);
			peak = 0;
		}
	};
	return {
		get durationMs() {
			return (samples * 1000) / sampleRate;
		},
		push(bytes: Buffer) {
			if (bytes.length === 0) return;
			let offset = 0;
			if (trailingByte !== undefined) {
				acceptSample((bytes.readInt8(0) << 8) | trailingByte);
				offset = 1;
			}
			for (; offset + 1 < bytes.length; offset += 2) {
				acceptSample(bytes.readInt16LE(offset));
			}
			trailingByte = offset < bytes.length ? bytes[offset] : undefined;
		},
		finish(): WaveformPeaks {
			const count = Math.ceil((samples * peaksPerSecond) / sampleRate);
			const peaks = new Float32Array(count);
			peaks.set(completed);
			if (count > completed.length) peaks[count - 1] = peak;
			return { durationMs: (samples * 1000) / sampleRate, peaks };
		},
	};
}

export async function generateWaveformPeaks(
	filePath: string,
	onProgress: (ratio: number) => void,
): Promise<WaveformPeaks | null> {
	const estimateMs = (await probeMediaDurationSeconds(filePath)) * 1000;
	const sampleRate = WAVEFORM_SAMPLE_RATE;
	const accumulator = createPeakAccumulator({
		sampleRate,
		peaksPerSecond: WAVEFORM_PEAKS_PER_SECOND,
	});
	const decoder = spawn(
		getFfmpegBinaryPath(),
		[
			"-v",
			"error",
			"-nostdin",
			"-i",
			filePath,
			"-map",
			"0:a:0",
			"-vn",
			"-ac",
			"1",
			"-ar",
			String(sampleRate),
			"-f",
			"s16le",
			"pipe:1",
		],
		{
			stdio: ["ignore", "pipe", "pipe"],
			windowsHide: true,
		},
	);
	let diagnostics = "";
	let lastRatio = 0;
	decoder.stdout.on("data", (chunk: Buffer) => {
		accumulator.push(chunk);
		const ratio = estimateMs > 0 ? Math.min(0.99, accumulator.durationMs / estimateMs) : 0;
		if (ratio - lastRatio >= 0.01) {
			lastRatio = ratio;
			onProgress(ratio);
		}
	});
	decoder.stderr.on("data", (chunk: Buffer) => {
		diagnostics = (diagnostics + chunk.toString("utf8")).slice(-8192);
	});
	return new Promise((resolve, reject) => {
		decoder.once("error", reject);
		decoder.once("close", (code) => {
			if (code !== 0) {
				if (/stream map ['"]0:a:0['"] matches no streams/i.test(diagnostics)) resolve(null);
				else
					reject(
						new Error(
							diagnostics.trim() || `Waveform decoding stopped (exit code ${code})`,
						),
					);
				return;
			}
			const result = accumulator.finish();
			normalizeWaveformPeaks(result.peaks);
			onProgress(1);
			resolve(result.peaks.length > 0 ? result : null);
		});
	});
}
