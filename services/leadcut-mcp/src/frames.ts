import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { getFfmpegPath } from "./binaries.js";
import { getMediaInfo } from "./media.js";

const execFileAsync = promisify(execFile);

export interface PreviewFrame {
	timestampMs: number;
	jpegBase64: string;
}

/** Samples evenly spaced source frames as resolution- and size-bounded JPEGs. */
export async function extractSampleFrames(
	videoPath: string,
	sampleCount = 4,
	range?: { startMs: number; endMs: number },
	maxWidth = 1280,
	signal?: AbortSignal,
): Promise<PreviewFrame[]> {
	const { durationMs } = await getMediaInfo(videoPath);
	const rangeStartMs = Math.max(0, range?.startMs ?? 0);
	const rangeEndMs = Math.min(durationMs, range?.endMs ?? durationMs);
	if (rangeEndMs <= rangeStartMs) throw new Error("Sample range is outside the source video.");
	const frames: PreviewFrame[] = [];
	const ffmpeg = getFfmpegPath();
	const frameLimitBytes = 70_000;
	for (let i = 0; i < sampleCount; i++) {
		const timestampMs = Math.round(rangeStartMs + ((i + 0.5) / sampleCount) * (rangeEndMs - rangeStartMs));
		let width = maxWidth;
		let buffer: Buffer;
		do {
			const frame = await execFileAsync(ffmpeg, [
				"-hide_banner", "-loglevel", "error", "-nostdin", "-ss", (timestampMs / 1000).toFixed(3),
				"-i", videoPath, "-frames:v", "1", "-vf", `scale='min(${width},iw)':-2`,
				"-c:v", "mjpeg", "-q:v", "5", "-f", "image2pipe", "pipe:1",
			], { encoding: "buffer", maxBuffer: 4 * 1024 * 1024, windowsHide: true, timeout: 30_000, signal });
			buffer = frame.stdout;
			width = Math.floor(width / 2);
		} while (buffer.byteLength > frameLimitBytes && width >= 64);
		if (!buffer.byteLength || buffer.byteLength > frameLimitBytes) {
			throw new Error("Could not produce a sampled frame within the response size budget.");
		}
		frames.push({ timestampMs, jpegBase64: buffer.toString("base64") });
	}
	return frames;
}
