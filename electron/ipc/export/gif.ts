import fs from "node:fs/promises";
import { getGifFrameDelayMs } from "../../../src/lib/exporter/gifTiming";
import { getFfmpegBinaryPath } from "../ffmpeg/binary";
import { runExportProcess } from "./runExportProcess";

export interface GifConversionRequest {
	runId: string;
	videoPath: string;
	fps: number;
	width: number;
	height: number;
	loop: boolean;
	frameCount?: number;
}

export async function convertVideoToGif({
	videoPath, outputPath, fps, width, height, loop, frameCount, signal,
}: Omit<GifConversionRequest, "runId"> & { outputPath: string; signal?: AbortSignal }) {
	const palette = `${outputPath}.palette.png`;
	const filter = `fps=${fps},scale=${width}:${height}:flags=lanczos`;
	const options = { windowsHide: true, signal, timeout: 30 * 60_000, maxBuffer: 4 * 1024 * 1024 };
	const base = ["-hide_banner", "-loglevel", "error", "-nostdin", "-y", "-filter_threads", "2"];
	// Otherwise the GIF muxer reuses the prior frame's delay for the last frame.
	const finalDelay = frameCount !== undefined ? getGifFrameDelayMs(frameCount - 1, fps) / 10 : -1;
	try {
		const ffmpeg = getFfmpegBinaryPath();
		// Count persistent backgrounds in every frame so brief motion cannot dominate the palette.
		await runExportProcess(ffmpeg, [
			...base, "-i", videoPath, "-vf", `${filter},palettegen=stats_mode=full`, "-frames:v", "1", "-update", "1", palette,
		], options);
		await runExportProcess(ffmpeg, [
			...base, "-i", videoPath, "-i", palette, "-filter_complex_threads", "2",
			"-filter_complex", `[0:v]${filter}[video];[video][1:v]paletteuse=dither=sierra2_4a:diff_mode=rectangle`,
			"-an", "-loop", loop ? "0" : "-1", "-final_delay", String(finalDelay), outputPath,
		], options);
	} finally {
		await fs.rm(palette, { force: true }).catch(() => undefined);
	}
}
