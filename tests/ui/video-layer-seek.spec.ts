import { test, expect } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { installDesktopBridge } from "./bridge";

test("late B-roll in-point seeks to a keyframe with identical decoded output", async ({ page }, testInfo) => {
	const fixture = path.resolve(".code/seek-benchmark.mp4");
	if (!fs.existsSync(fixture)) {
		fs.mkdirSync(path.dirname(fixture), { recursive: true });
		execFileSync(path.resolve("node_modules/ffmpeg-static/ffmpeg.exe"), ["-v", "error", "-y", "-f", "lavfi", "-i", "testsrc2=s=160x90:r=15:d=60", "-c:v", "libx264", "-preset", "ultrafast", "-g", "15", "-pix_fmt", "yuv420p", "-movflags", "+faststart", fixture], { windowsHide: true });
	}
	await installDesktopBridge(page);
	await page.goto("/?windowType=editor");
	const results = await page.evaluate(async () => {
		const { ForwardFrameSource } = await import("/src/lib/exporter/forwardFrameSource.ts");
		const Decoder = window.VideoDecoder;
		let chunks = 0;
		window.VideoDecoder = class extends Decoder { decode(chunk: EncodedVideoChunk) { chunks++; super.decode(chunk); } };
		const sample = async (startTimeSec: number) => {
			chunks = 0; const started = performance.now(); const source = new ForwardFrameSource();
			try {
				await source.initialize(`${location.origin}/.code/seek-benchmark.mp4`, { startTimeSec });
				const frame = (await source.getFrameAtTime(50.2))!;
				const canvas = document.createElement("canvas"); canvas.width = 160; canvas.height = 90;
				canvas.getContext("2d")!.drawImage(frame, 0, 0);
				const result = { chunks, elapsedMs: performance.now() - started, timestamp: frame.timestamp, pixels: canvas.toDataURL() };
				frame.close(); return result;
			} finally { source.cancel(); await source.destroy(); }
		};
		try { return { full: await sample(0), seek: await sample(50) }; }
		finally { window.VideoDecoder = Decoder; }
	});
	expect(results.seek.pixels).toBe(results.full.pixels);
	expect(results.seek.timestamp).toBe(results.full.timestamp);
	expect(results.seek.chunks).toBeLessThan(results.full.chunks / 4);
	fs.writeFileSync(testInfo.outputPath("seek-benchmark.json"), JSON.stringify({ full: { ...results.full, pixels: undefined }, seek: { ...results.seek, pixels: undefined } }, null, 2));
});
