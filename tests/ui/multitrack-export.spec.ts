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

test("modern export preserves cover and contain across a different output aspect ratio", async ({ page }) => {
	await installDesktopBridge(page, "broll-blue.mp4");
	await page.goto("/?windowType=editor");
	const pixels = await page.evaluate(async () => {
		const { FrameRenderer } = await import("/src/lib/exporter/modernFrameRenderer.ts");
		const region = {
			trackId: "broll", sourcePath: `${location.origin}/tests/ui/fixtures/broll-blue.mp4`,
			sourceDurationMs: 3000, sourceStartMs: 0, speed: 1, volume: 0,
		};
		const renderer = new FrameRenderer({
			width: 180, height: 240, videoWidth: 320, videoHeight: 180, preferredRenderBackend: "webgl",
			wallpaper: "#ff0000", showShadow: false, shadowIntensity: 0, backgroundBlur: 0, zoomRegions: [],
			cropRegion: { x: 0, y: 0, width: 1, height: 1 }, showCursor: false,
			videoTracks: [{ id: "broll", name: "B-roll", kind: "video" }],
			videoRegions: [
				{ ...region, id: "cover", startMs: 0, endMs: 1000, fit: "cover" },
				{ ...region, id: "contain", startMs: 1000, endMs: 2000, fit: "contain" },
			],
		});
		const readback = new OffscreenCanvas(180, 240).getContext("2d")!;
		const samples = async (timestamp: number) => {
			await renderer.renderFrame(null, timestamp);
			readback.drawImage(renderer.getCanvas(), 0, 0);
			return [[1, 1], [90, 120], [178, 238]].map(([x, y]) => Array.from(readback.getImageData(x, y, 1, 1).data));
		};
		try {
			await renderer.initialize();
			return { cover: await samples(500_000), contain: await samples(1_500_000) };
		} finally {
			renderer.destroy();
		}
	});
	for (const [red, , blue] of [...pixels.cover, pixels.contain[1]]) {
		expect(red).toBeLessThan(30);
		expect(blue).toBeGreaterThan(200);
	}
	for (const [red, , blue] of [pixels.contain[0], pixels.contain[2]]) {
		expect(red).toBeGreaterThan(200);
		expect(blue).toBeLessThan(30);
	}
});

for (const [frameRate, loop] of [[15, false], [30, true]] as const) test(`GIF preserves the sequence duration and loop setting at ${frameRate} fps`, async ({ page }, testInfo) => {
	test.setTimeout(90_000);
	await installDesktopBridge(page, "broll-blue.mp4");
	await page.goto("/?windowType=editor");
	const bytes = await page.evaluate(async ({ frameRate, loop }) => {
		const { GifExporter } = await import("/src/lib/exporter/gifExporter.ts");
		const root = `${location.origin}/tests/ui/fixtures/`;
		const exporter = new GifExporter({
			videoUrl: `${root}broll-blue.mp4`, width: 320, height: 180, frameRate, loop, sizePreset: "original",
			wallpaper: "#008800", cropRegion: { x: 0, y: 0, width: 1, height: 1 }, padding: 0, zoomRegions: [],
			showCursor: false, showShadow: false, shadowIntensity: 0, backgroundBlur: 0,
			clipRegions: [{ id: "picture", startMs: 0, endMs: 1000, sourceStartMs: 0, speed: 1 }],
			audioRegions: [{ id: "tail", audioPath: `${root}waveform.mp4`, startMs: 1000, endMs: 3000, volume: 1 }],
		});
		const result = await exporter.export();
		if (!result.success || !result.blob) throw new Error(result.error || "GIF not exported");
		return Array.from(new Uint8Array(await result.blob.arrayBuffer()));
	}, { frameRate, loop });
	const destination = testInfo.outputPath("audio-tail.gif");
	const gif = Buffer.from(bytes);
	expect(gif.at(-1)).toBe(0x3b);
	fs.writeFileSync(destination, gif);
	const ffprobe = path.resolve("node_modules/ffprobe-static/bin/win32/x64/ffprobe.exe");
	const transcript = JSON.parse(execFileSync(ffprobe, [
		"-v", "error", "-ignore_loop", "1", "-count_frames", "-show_entries", "stream=codec_type,nb_read_frames:packet=pts_time,duration_time", "-of", "json", destination,
	], { encoding: "utf8", windowsHide: true }));
	expect(transcript.streams).toEqual([{ codec_type: "video", nb_read_frames: String(3 * frameRate) }]);
	const lastFrame = transcript.packets.at(-1);
	expect(Number(lastFrame.pts_time) + Number(lastFrame.duration_time)).toBeCloseTo(3, 2);
	const repeatExtension = gif.indexOf("NETSCAPE2.0");
	if (loop) {
		expect(repeatExtension).toBeGreaterThan(0);
		expect([...gif.subarray(repeatExtension + 11, repeatExtension + 16)]).toEqual([3, 1, 0, 0, 0]);
	} else {
		expect(repeatExtension).toBe(-1);
	}
	const ffmpeg = path.resolve("node_modules/ffmpeg-static/ffmpeg.exe");
	const firstPixel = (seconds: string) => execFileSync(ffmpeg, [
		"-v", "error", "-ignore_loop", "1", "-ss", seconds, "-i", destination, "-frames:v", "1",
		"-vf", "crop=2:2:160:90,scale=1:1", "-f", "rawvideo", "-pix_fmt", "rgb24", "-",
	], { windowsHide: true });
	expect(firstPixel("0.5")[2]).toBeGreaterThan(200);
	const tail = firstPixel("2.4");
	expect(tail[1]).toBeGreaterThan(110);
	expect(tail[2]).toBeLessThan(20);
});
