import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
import ffmpeg from "ffmpeg-static";
import { installDesktopBridge } from "./bridge";

test("compatible MP4, modern MP4 and GIF preserve the same edited sequence", async ({ page }, info) => {
	test.setTimeout(90_000);
	await installDesktopBridge(page, "filmstrip.mp4");
	await page.goto("/?windowType=editor");
	const outputs = await page.evaluate(async () => {
		const { VideoExporter } = await import("/src/lib/exporter/videoExporter.ts");
		const { ModernVideoExporter } = await import("/src/lib/exporter/modernVideoExporter.ts");
		const { GifExporter } = await import("/src/lib/exporter/gifExporter.ts");
		const { confirmChapterProgress, emptyChapterProgress } = await import("/src/components/video-editor/chapterProgress.ts");
		const { DEFAULT_AUTO_CAPTION_SETTINGS } = await import("/src/components/video-editor/types.ts");
		const root = `${location.origin}/tests/ui/fixtures/`;
		const clipRegions = [
			{ id: "first", startMs: 0, endMs: 800, sourceStartMs: 0, speed: 1 },
			{ id: "second", startMs: 1000, endMs: 2000, sourceStartMs: 2000, speed: 1 },
		];
		const videoTracks = [{ id: "broll", kind: "video" as const, name: "B-roll" }];
		const videoRegions = [{
			id: "blue", trackId: "broll", sourcePath: `${root}broll-blue.mp4`,
			startMs: 1400, endMs: 1800, sourceStartMs: 500, sourceDurationMs: 3000,
			speed: 1, fit: "contain" as const, opacity: 0.65, muted: true, volume: 0,
		}];
		const chapterProgress = confirmChapterProgress({
			...emptyChapterProgress(),
			chapters: [
				{ id: "opening", title: "Opening", startMs: 0, endMs: 1000 },
				{ id: "demonstration", title: "Demonstration", startMs: 1000, endMs: 2000 },
			],
		}, { clipRegions, videoRegions });
		const scene = {
			videoUrl: `${root}filmstrip.mp4`, width: 320, height: 180, frameRate: 30 as const,
			wallpaper: "#26344a", showShadow: false, shadowIntensity: 0, backgroundBlur: 0,
			cropRegion: { x: 0, y: 0, width: 1, height: 1 }, padding: 8, borderRadius: 12,
			zoomRegions: [{ id: "zoom", startMs: 250, endMs: 1500, depth: 2 as const, focus: { cx: 0.57, cy: 0.4 } }],
			clipRegions, videoTracks, videoRegions, chapterProgress, zoomClassicMode: true,
			showCursor: true, cursorStyle: "dot", cursorSize: 3,
			cursorTelemetry: [
				{ timeMs: 0, cx: 0.7, cy: 0.2, interactionType: "move" as const },
				{ timeMs: 100, cx: 0.7, cy: 0.2, interactionType: "click" as const },
				{ timeMs: 2000, cx: 0.7, cy: 0.2, interactionType: "move" as const },
			],
			cursorClickEffect: "echo" as const, cursorClickEffectColor: "#0000ff", cursorClickEffectScale: 2,
			autoCaptions: [{ id: "cue", startMs: 100, endMs: 1450, timeBasis: "timeline" as const, text: "Export parity" }],
			autoCaptionSettings: { ...DEFAULT_AUTO_CAPTION_SETTINGS, enabled: true },
		};
		const mp4 = {
			...scene, bitrate: 2_000_000, codec: "avc1.42001f", backendPreference: "webcodecs" as const,
			preferredRenderBackend: "webgl" as const,
		};
		const exporters = {
			"compatible.mp4": new VideoExporter(mp4),
			"modern.mp4": new ModernVideoExporter(mp4),
			"sequence.gif": new GifExporter({ ...scene, loop: false, sizePreset: "original" }),
			"compatible-without-click.mp4": new VideoExporter({ ...mp4, cursorClickEffect: "none" }),
		};
		const files: Record<string, number[]> = {};
		for (const [name, exporter] of Object.entries(exporters)) {
			const result = await exporter.export();
			if (!result.success || !result.blob) throw new Error(`${name}: ${result.error ?? "missing export blob"}`);
			files[name] = Array.from(new Uint8Array(await result.blob.arrayBuffer()));
		}
		return files;
	});
	const directory = info.outputPath();
	expect(ffmpeg).toBeTruthy();
	for (const [name, bytes] of Object.entries(outputs)) {
		writeFileSync(info.outputPath(name), Buffer.from(bytes));
		const hashes = execFileSync(ffmpeg!, [
			"-v", "error", "-i", name, "-map", "0:v:0", "-f", "framehash", "-",
		], { cwd: directory, encoding: "utf8", windowsHide: true });
		const frames = hashes.trim().split(/\r?\n/).filter((line) => !line.startsWith("#"));
		expect(frames, `${name} frame count`).toHaveLength(60);
	}
	const readClickFrames = (name: string) => execFileSync(ffmpeg!, [
		"-v", "error", "-ss", "0.2", "-t", "0.4", "-i", name,
		"-pix_fmt", "rgb24", "-f", "rawvideo", "-",
	], { cwd: directory, maxBuffer: 4 * 1024 * 1024, windowsHide: true });
	const plainFrames = readClickFrames("compatible-without-click.mp4");
	const clickedFrames = readClickFrames("compatible.mp4");
	expect(clickedFrames.length).toBe(12 * 320 * 180 * 3);
	expect(plainFrames.length).toBe(clickedFrames.length);
	let blueEffectPixels = 0;
	for (let offset = 0; offset < clickedFrames.length; offset += 3) {
		if (clickedFrames[offset + 2] - plainFrames[offset + 2] > 30 &&
			plainFrames[offset] - clickedFrames[offset] > 20) blueEffectPixels++;
	}
	expect(blueEffectPixels, "blue click echo rendered into compatible MP4").toBeGreaterThan(150);
	// The indexed GIF palette preserves less color detail than H.264.
	for (const [reference, candidate, minimumMean] of [
		["modern.mp4", "compatible.mp4", 0.98],
		["modern.mp4", "sequence.gif", 0.90],
		["compatible.mp4", "sequence.gif", 0.90],
	] as const) {
		const stats = `ssim-${reference}-${candidate}.txt`;
		// Compare corresponding decoded frames. GIF timestamps have centisecond precision.
		execFileSync(ffmpeg!, [
			"-v", "error", "-i", reference, "-i", candidate,
			"-filter_complex", `[0:v]format=yuv444p,settb=1/30,setpts=N[reference];[1:v]format=yuv444p,settb=1/30,setpts=N[candidate];[reference][candidate]ssim=stats_file=${stats}:shortest=1`,
			"-f", "null", "-",
		], { cwd: directory, windowsHide: true });
		const frames = readFileSync(info.outputPath(stats), "utf8").trim().split(/\r?\n/)
			.map((line) => Number(line.match(/\bAll:([\d.]+)/)?.[1]));
		expect(frames, `${reference} and ${candidate} frame count`).toHaveLength(60);
		expect(Math.min(...frames), `${reference} and ${candidate} worst frame SSIM`).toBeGreaterThan(0.85);
		const mean = frames.reduce((total, value) => total + value, 0) / frames.length;
		expect(mean, `${reference} and ${candidate} mean SSIM`).toBeGreaterThan(minimumMean);
	}
});
