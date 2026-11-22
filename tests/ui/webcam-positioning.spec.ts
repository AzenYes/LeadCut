import { test, expect } from "@playwright/test";
import { installDesktopBridge } from "./bridge";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

test("camera foreground stays inside Recordly's nine anchors with shadow padding", async ({ page }, testInfo) => {
	test.setTimeout(90000);
	await installDesktopBridge(page); await page.goto("/?windowType=editor");
	const results = await page.evaluate(async () => {
		const { Application, Graphics } = await import("/node_modules/.vite/deps/pixi__js.js");
		const { VideoLayerCompositor } = await import("/src/lib/videoLayerCompositor.ts");
		const { DEFAULT_WEBCAM_OVERLAY } = await import("/src/components/video-editor/types.ts");
		const { getWebcamOverlayDimensionsPx, getWebcamOverlayPosition, scaleWebcamOverlayPixels } = await import("/src/components/video-editor/webcamOverlay.ts");
		const app = new Application(); await app.init({ width: 640, height: 360, resolution: 1.25, preference: "webgl", antialias: true });
		const bg = new Graphics().rect(0, 0, 640, 360).fill(0x0000ff); app.stage.addChild(bg);
		const compositor = new VideoLayerCompositor(); app.stage.addChild(compositor.container);
		const base = { width: 640, height: 360, resolution: 1.25, tracks: [{ id: "cam", kind: "webcam" as const, name: "Camera" }], regions: [{ id: "red", trackId: "cam", sourcePath: `${location.origin}/tests/ui/fixtures/webcam-red.mp4`, sourceDurationMs: 3000, sourceStartMs: 0, startMs: 0, endMs: 3000, speed: 1, volume: 0 }] };
		const output = [];
		const cases = [
            { w: 640, h: 360, resolution: 1, width: 40, height: 40, zoom: 1, scale: 0.2 },
            { w: 640, h: 360, resolution: 1, width: 40, height: 40, zoom: 1, scale: 2 },
			{ w: 640, h: 360, resolution: 1.25, width: 40, height: 40, zoom: 1 },
			{ w: 360, h: 640, resolution: 1, width: 40, height: 40, zoom: 1.5 },
			{ w: 400, h: 400, resolution: 2, width: 65, height: 30, zoom: 2 },
			{ w: 320, h: 180, resolution: 1.25, width: 90, height: 10, zoom: 3 },
			{ w: 480, h: 360, resolution: 1, width: 80, height: 20, zoom: 2.5 },
			{ w: 640, h: 360, resolution: 1.25, width: 40, height: 40, zoom: 1.5, crop: { x: 0.1, y: 0.2, width: 0.6, height: 0.4 } },
		];
		const { getCropMatchedWebcamHeightPercent } = await import("/src/components/video-editor/webcamOverlay.ts");
		for (const scenario of cases) {
		app.renderer.resize(scenario.w, scenario.h, scenario.resolution); bg.clear().rect(0, 0, scenario.w, scenario.h).fill(0x0000ff);
		for (const shadow of [0.3, 0, 0.8]) for (const positionPreset of ["top-left", "top-center", "top-right", "center-left", "center", "center-right", "bottom-left", "bottom-center", "bottom-right", "custom"] as const) {
			const webcam = { ...DEFAULT_WEBCAM_OVERLAY, scale: scenario.scale ?? 1, width: scenario.width, height: scenario.height, cropRegion: scenario.crop, enabled: true, shadow, positionPreset, positionX: 0.13, positionY: 0.87, roundness: 100, reactToZoom: true };
			await compositor.syncPreview(500, false, 1, { ...base, width: scenario.w, height: scenario.h, resolution: scenario.resolution, zoomScale: scenario.zoom, webcam }); app.render();
			const c = document.createElement("canvas"); c.width = app.canvas.width; c.height = app.canvas.height; const ctx = c.getContext("2d")!; ctx.drawImage(app.canvas, 0, 0); const data = ctx.getImageData(0, 0, c.width, c.height).data;
			let minX = c.width, minY = c.height, maxX = -1, maxY = -1;
			for (let y = 0; y < c.height; y++) for (let x = 0; x < c.width; x++) if (data[(y * c.width + x) * 4] > 127) { minX = Math.min(minX, x); minY = Math.min(minY, y); maxX = Math.max(maxX, x); maxY = Math.max(maxY, y); }
			const margin = scaleWebcamOverlayPixels(24, scenario.w); const size = getWebcamOverlayDimensionsPx({ scale: scenario.scale ?? 1, containerWidth: scenario.w, containerHeight: scenario.h, widthPercent: scenario.width, heightPercent: getCropMatchedWebcamHeightPercent(scenario.width, scenario.height, 320, 180, scenario.crop), margin, zoomScale: scenario.zoom, reactToZoom: true });
			const position = getWebcamOverlayPosition({ containerWidth: scenario.w, containerHeight: scenario.h, ...size, margin, positionPreset, positionX: 0.13, positionY: 0.87, legacyCorner: "bottom-right" });
			output.push({ scenario, shadow, positionPreset, actual: [minX, minY, maxX + 1, maxY + 1], expected: [position.x * c.width / scenario.w, position.y * c.height / scenario.h, (position.x + size.width) * c.width / scenario.w, (position.y + size.height) * c.height / scenario.h] });
		}
		}
		compositor.destroy(); app.ticker.stop(); return output;
	});
	await testInfo.attach("camera-bounds", { body: JSON.stringify(results, null, 2), contentType: "application/json" });
	fs.writeFileSync(testInfo.outputPath("camera-bounds.json"), JSON.stringify(results, null, 2));
	for (const sample of results) for (let edge = 0; edge < 4; edge++) expect(Math.abs(sample.actual[edge] - sample.expected[edge]), JSON.stringify(sample)).toBeLessThanOrEqual(2);
});

for (const backend of ["modern", "legacy"] as const) test(`bottom-left camera preserves all four edges in ${backend} export`, async ({ page }, testInfo) => {
	test.setTimeout(60000);
	await installDesktopBridge(page, "filmstrip.mp4"); await page.goto("/?windowType=editor");
	const bytes = await page.evaluate(async backend => {
		const { ModernVideoExporter } = await import("/src/lib/exporter/modernVideoExporter.ts");
		const { VideoExporter } = await import("/src/lib/exporter/videoExporter.ts");
		const { DEFAULT_WEBCAM_OVERLAY } = await import("/src/components/video-editor/types.ts");
		const root = `${location.origin}/tests/ui/fixtures/`;
		const Exporter = backend === "modern" ? ModernVideoExporter : VideoExporter;
		const exporter = new Exporter({ width: 320, height: 180, frameRate: 15, bitrate: 2000000, codec: "avc1.42001f", backendPreference: "webcodecs", preferredRenderBackend: "webgl", videoUrl: `${root}broll-blue.mp4`, wallpaper: "#0000ff", showShadow: false, shadowIntensity: 0, backgroundBlur: 0, cropRegion: { x: 0, y: 0, width: 1, height: 1 }, padding: 0, zoomRegions: [], showCursor: false, clipRegions: [{ id: "screen", startMs: 0, endMs: 1000, sourceStartMs: 0, speed: 1 }], videoTracks: [{ id: "camera", name: "Camera", kind: "webcam" }], videoRegions: [{ id: "red", trackId: "camera", sourcePath: `${root}webcam-red.mp4`, sourceDurationMs: 3000, sourceStartMs: 0, startMs: 0, endMs: 1000, speed: 1, volume: 0, muted: true }], webcam: { ...DEFAULT_WEBCAM_OVERLAY, enabled: true, width: 40, height: 40, shadow: 0.3, positionPreset: "bottom-left", mirror: false, reactToZoom: false }, webcamUrl: null });
		const result = await exporter.export(); if (!result.success || !result.blob) throw new Error(result.error || "No export");
		return Array.from(new Uint8Array(await result.blob.arrayBuffer()));
	}, backend);
	const destination = testInfo.outputPath(`${backend}-bottom-left.mp4`); fs.writeFileSync(destination, Buffer.from(bytes));
	const frame = execFileSync(path.resolve("node_modules/ffmpeg-static/ffmpeg.exe"), ["-v", "error", "-ss", "0.5", "-i", destination, "-frames:v", "1", "-f", "rawvideo", "-pix_fmt", "rgb24", "-"], { windowsHide: true });
	let left = 320, top = 180, right = -1, bottom = -1;
	for (let y = 0; y < 180; y++) for (let x = 0; x < 320; x++) { const p = (y * 320 + x) * 3; if (frame[p] > 180 && frame[p + 1] < 70 && frame[p + 2] < 70) { left = Math.min(left, x); top = Math.min(top, y); right = Math.max(right, x); bottom = Math.max(bottom, y); } }
	for (const [actual, expected] of [[left, 4], [top, 104], [right + 1, 76], [bottom + 1, 176]]) expect(Math.abs(actual - expected), JSON.stringify({ left, top, right, bottom })).toBeLessThanOrEqual(3);
});
