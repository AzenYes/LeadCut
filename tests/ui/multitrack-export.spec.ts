import { test, expect } from "@playwright/test";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { installDesktopBridge } from "./bridge";

for (const backend of ["modern", "legacy"] as const) test(`independent webcam, B-roll and sound survive ${backend} MP4 export`, async ({ page }, testInfo) => {
	test.setTimeout(90000);
	await installDesktopBridge(page, "filmstrip.mp4");
	await page.goto("/?windowType=editor");
	await expect(page.locator('[data-variant="clip"]')).toHaveCount(1, { timeout: 20000 });
	const output = await page.evaluate(async (backend) => {
		const { ModernVideoExporter } = await import("/src/lib/exporter/modernVideoExporter.ts");
		const { VideoExporter } = await import("/src/lib/exporter/videoExporter.ts");
		const { DEFAULT_WEBCAM_OVERLAY } = await import("/src/components/video-editor/types.ts");
		const { getVideoRegionAudio } = await import("/src/components/video-editor/videoTracks.ts");
		const root = `${location.origin}/tests/ui/fixtures/`;
		const tracks = [{ id: "broll", name: "B-roll", kind: "video" as const }, { id: "camera", name: "Camera", kind: "webcam" as const }];
		const regions = [
			{ id: "blue", trackId: "broll", sourcePath: `${root}broll-blue.mp4`, sourceDurationMs: 3000, sourceStartMs: 500, hasAudio: true, startMs: 1000, endMs: 3500, speed: 1, volume: 1 },
			{ id: "red", trackId: "camera", sourcePath: `${root}webcam-red.mp4`, sourceDurationMs: 3000, sourceStartMs: 0, hasAudio: false, startMs: 0, endMs: 2000, speed: 1, volume: 0, muted: true },
		];
		const Exporter = backend === "modern" ? ModernVideoExporter : VideoExporter;
		const exporter = new Exporter({ width: 320, height: 180, frameRate: 15, bitrate: 1500000, codec: "avc1.42001f", backendPreference: "webcodecs", preferredRenderBackend: "webgl", videoUrl: `${root}filmstrip.mp4`, wallpaper: "#000000", showShadow: false, shadowIntensity: 0, backgroundBlur: 0, cropRegion: { x: 0, y: 0, width: 1, height: 1 }, padding: 0, zoomRegions: [], showCursor: false, clipRegions: [{ id: "screen", startMs: 0, endMs: 2000, sourceStartMs: 0, speed: 1 }], videoRegions: regions, videoTracks: tracks, webcam: { ...DEFAULT_WEBCAM_OVERLAY, enabled: true, sourcePath: `${root}webcam-red.mp4`, mirror: false, shadow: 0, reactToZoom: false }, webcamUrl: null, audioRegions: getVideoRegionAudio(regions, tracks) });
		const result = await exporter.export();
		if (!result.success || !result.blob) throw new Error(result.error || "No exported blob");
		return { bytes: Array.from(new Uint8Array(await result.blob.arrayBuffer())), metrics: result.metrics };
	}, backend);
	const destination = testInfo.outputPath(`${backend}-multitrack.mp4`);
	fs.writeFileSync(destination, Buffer.from(output.bytes));
	const ffmpeg = path.resolve("node_modules/ffmpeg-static/ffmpeg.exe");
	const ffprobe = path.resolve("node_modules/ffprobe-static/bin/win32/x64/ffprobe.exe");
	const info = JSON.parse(execFileSync(ffprobe, ["-v", "error", "-show_streams", "-show_format", "-of", "json", destination], { encoding: "utf8", windowsHide: true }));
	expect(Number(info.format.duration)).toBeCloseTo(3.5, 0);
	expect(info.streams.some((stream: { codec_type: string }) => stream.codec_type === "audio")).toBe(true);
	const pixel = (time: number, x: number, y: number) => [...execFileSync(ffmpeg, ["-v", "error", "-ss", String(time), "-i", destination, "-frames:v", "1", "-vf", `crop=2:2:${x}:${y},scale=1:1`, "-f", "rawvideo", "-pix_fmt", "rgb24", "-"], { windowsHide: true })];
	const blue = pixel(1.5, 50, 50), tail = pixel(3, 50, 50), camera = pixel(0.5, 280, 140);
	expect(blue[2]).toBeGreaterThan(200); expect(blue[0]).toBeLessThan(30);
	expect(tail[2]).toBeGreaterThan(200);
	expect(camera[0]).toBeGreaterThan(200); expect(camera[2]).toBeLessThan(30);
	const pcm = execFileSync(ffmpeg, ["-v", "error", "-ss", "1.2", "-t", "0.5", "-i", destination, "-vn", "-ac", "1", "-ar", "48000", "-f", "s16le", "-"], { windowsHide: true });
	let sin = 0, cos = 0; const frames = pcm.length / 2;
	for (let i = 0; i < frames; i++) { const sample = pcm.readInt16LE(i * 2) / 32768; sin += sample * Math.sin(2 * Math.PI * 660 * i / 48000); cos += sample * Math.cos(2 * Math.PI * 660 * i / 48000); }
	expect(2 * Math.hypot(sin, cos) / frames).toBeGreaterThan(0.01);
	fs.writeFileSync(testInfo.outputPath("verification.json"), JSON.stringify({ backend, duration: info.format.duration, blue, tail, camera, toneAmplitude: 2 * Math.hypot(sin, cos) / frames, metrics: output.metrics }, null, 2));
});
