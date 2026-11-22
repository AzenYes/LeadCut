import { test, expect } from "@playwright/test";
import { installDesktopBridge } from "./bridge";
import fs from "node:fs";

test("screen pixels survive pending seeks, texture eviction and WebGL restoration", async ({ page }) => {
	await installDesktopBridge(page, "filmstrip.mp4");
	await page.goto("/?windowType=editor");
	const result = await page.evaluate(async () => {
		const { Application, Sprite, Texture } = await import("/node_modules/.vite/deps/pixi__js.js");
		const { PreviewVideoSource } = await import("/src/components/video-editor/videoPlayback/previewVideoSource.ts");
		const app = new Application(); await app.init({ width: 320, height: 180, preference: "webgl", background: "#ff00ff" });
		document.body.appendChild(app.canvas);
		const video = document.createElement("video"); video.muted = true; video.src = `${location.origin}/tests/ui/fixtures/filmstrip.mp4`; document.body.appendChild(video);
		await new Promise<void>((resolve, reject) => { video.onloadeddata = () => resolve(); video.onerror = () => reject(new Error("fixture load")); });
		let supportsDecodedFrame = false;
		if (typeof VideoFrame === "function") {
			try {
				const frame = new VideoFrame(video, { timestamp: 0 });
				frame.close();
				supportsDecodedFrame = true;
			} catch {
				// Some browser/decoder combinations only allow copying through Canvas 2D.
			}
		}
		const owner = new PreviewVideoSource(); owner.setVideo(video);
		const source = owner.getSource(); const sprite = new Sprite(new Texture({ source })); sprite.width = 320; sprite.height = 180; app.stage.addChild(sprite);
		const pixels = () => { app.render(); const c = document.createElement("canvas"); c.width = 320; c.height = 180; const ctx = c.getContext("2d")!; ctx.drawImage(app.canvas, 0, 0); return [...ctx.getImageData(0, 0, 320, 180).data]; };
		const before = pixels();
		video.currentTime = 2.2; source.unload(); owner.getSource(); const duringSeek = pixels();
		await new Promise<void>(resolve => { if (!video.seeking) resolve(); else video.addEventListener("seeked", () => resolve(), { once: true }); });
		const afterSeek = pixels();
		const gl = (app.renderer as { gl: WebGLRenderingContext }).gl;
		const extension = gl.getExtension("WEBGL_lose_context")!;
		const restored = new Promise<void>(resolve => app.canvas.addEventListener("webglcontextrestored", () => resolve(), { once: true }));
		extension.loseContext(); await new Promise(resolve => setTimeout(resolve, 150)); extension.restoreContext(); await restored;
		const afterRestore = pixels();
		const difference = (a: number[], b: number[]) => a.reduce((sum, n, i) => sum + Math.abs(n - b[i]), 0) / a.length;
		const validResource = supportsDecodedFrame
			? source.resource instanceof VideoFrame
			: source.resource instanceof HTMLCanvasElement;
		const out = { pendingDifference: difference(before, duringSeek), restoredDifference: difference(afterSeek, afterRestore), seekChanged: difference(before, afterSeek), validResource };
		owner.setVideo(null); video.remove(); app.destroy(true, { children: true }); return out;
	});
	expect(result.validResource).toBe(true);
	expect(result.pendingDifference).toBeLessThan(0.01);
	expect(result.restoredDifference).toBeLessThan(0.1);
	expect(result.seekChanged).toBeGreaterThan(5);
});

test("camera keeps Recordly's silhouette and antialiased edges throughout animated scaling", async ({ page }, testInfo) => {
	test.setTimeout(60000);
	await installDesktopBridge(page); await page.goto("/?windowType=editor");
	const result = await page.evaluate(async () => {
		const { Application, Graphics } = await import("/node_modules/.vite/deps/pixi__js.js");
		const { VideoLayerCompositor } = await import("/src/lib/videoLayerCompositor.ts");
		const { DEFAULT_WEBCAM_OVERLAY } = await import("/src/components/video-editor/types.ts");
		const { getWebcamOverlayDimensionsPx, getWebcamCornerRadiusPx } = await import("/src/components/video-editor/webcamOverlay.ts");
		const { getSquircleSvgPath } = await import("/src/lib/geometry/squircle.ts");
		const app = new Application(); await app.init({ width: 400, height: 300, resolution: 2, preference: "webgl", antialias: true }); document.body.appendChild(app.canvas);
		app.stage.addChild(new Graphics().rect(0, 0, 400, 300).fill(0x0000ff));
		const compositor = new VideoLayerCompositor(); app.stage.addChild(compositor.container);
		const options = { width: 400, height: 300, resolution: 2, tracks: [{ id: "cam", kind: "webcam" as const, name: "Camera" }], regions: [{ id: "red", trackId: "cam", sourcePath: `${location.origin}/tests/ui/fixtures/webcam-red.mp4`, sourceDurationMs: 3000, sourceStartMs: 0, startMs: 0, endMs: 3000, speed: 1, volume: 0 }], webcam: { ...DEFAULT_WEBCAM_OVERLAY, enabled: true, width: 60, height: 60, positionPreset: "center" as const, mirror: false, roundness: 100, shadow: 0, reactToZoom: true } };
		await compositor.syncPreview(500, false, 1, options);
		const output = [];
		for (const zoom of [1, 1.125, 1.25, 1.5, 1.8, 2.2, 3, 2.2, 1.8, 1.5, 1.25, 1.125, 1]) {
			compositor.updateViewport({ width: 400, height: 300, resolution: 2, zoomScale: zoom }); app.render();
			const canvas = document.createElement("canvas"); canvas.width = 800; canvas.height = 600; const ctx = canvas.getContext("2d")!; ctx.drawImage(app.canvas, 0, 0);
			const actual = ctx.getImageData(0, 0, 800, 600).data;
			const size = getWebcamOverlayDimensionsPx({ containerWidth: 400, containerHeight: 300, widthPercent: 60, heightPercent: 60, margin: 0, zoomScale: zoom, reactToZoom: true });
			ctx.fillStyle = "blue"; ctx.fillRect(0, 0, 800, 600); ctx.fillStyle = "red";
			ctx.fill(new Path2D(getSquircleSvgPath({ x: (400 - size.width), y: (300 - size.height), width: size.width * 2, height: size.height * 2, radius: getWebcamCornerRadiusPx(100, size.width * 2, size.height * 2) })));
			const reference = ctx.getImageData(0, 0, 800, 600).data;
			let intersection = 0, union = 0, green = 0, smooth = 0, referenceSmooth = 0;
			for (let i = 0; i < actual.length; i += 4) { const a = actual[i] > 127, b = reference[i] > 127; if (a && b) intersection++; if (a || b) union++; green = Math.max(green, actual[i + 1]); if (actual[i] > 8 && actual[i] < 240 && actual[i + 2] > 8) smooth++; if (reference[i] > 8 && reference[i] < 240 && reference[i + 2] > 8) referenceSmooth++; }
			const cameraSprite = compositor.container.children[0].children[0].children.find(node => node.texture);
			output.push({ zoom, silhouetteOverlap: intersection / union, green, smooth, referenceSmooth, surfaceWidth: cameraSprite.texture.source.resource.width, surfaceHeight: cameraSprite.texture.source.resource.height });
		}
		const proof = document.createElement("canvas"); proof.width = 800; proof.height = 600; proof.getContext("2d")!.drawImage(app.canvas, 0, 0); document.body.appendChild(proof); proof.setAttribute("data-camera-verification", "true");
		const topTrack = { id: "top", kind: "video" as const, name: "Above camera" };
		await compositor.syncPreview(500, false, 1, { ...options, tracks: [...options.tracks, topTrack], regions: [...options.regions, { ...options.regions[0], id: "blue", trackId: "top", sourcePath: `${location.origin}/tests/ui/fixtures/broll-blue.mp4` }] });
		await new Promise(resolve => setTimeout(resolve, 150));
		compositor.updateViewport({ width: 400, height: 300, resolution: 2, zoomScale: 1.8 }); app.render();
		const pixelCanvas = document.createElement("canvas"); pixelCanvas.width = pixelCanvas.height = 1; const pixelContext = pixelCanvas.getContext("2d")!; pixelContext.drawImage(app.canvas, 400, 300, 1, 1, 0, 0, 1, 1);
		return { samples: output, topLayerPixel: [...pixelContext.getImageData(0, 0, 1, 1).data] };
	});
	await page.locator("[data-camera-verification]").screenshot({ path: testInfo.outputPath("camera-silhouette.png") });
	await testInfo.attach("pixel-measurements", { body: JSON.stringify(result, null, 2), contentType: "application/json" });
	fs.writeFileSync(testInfo.outputPath("pixel-measurements.json"), JSON.stringify(result, null, 2));
	for (const sample of result.samples) { expect(sample.silhouetteOverlap).toBeGreaterThan(0.985); expect(sample.green).toBeLessThan(4); expect(sample.smooth).toBeGreaterThan(sample.referenceSmooth * 0.5); }
	expect(new Set(result.samples.map(sample => `${sample.surfaceWidth}x${sample.surfaceHeight}`)).size).toBe(1);
	expect(result.topLayerPixel[2]).toBeGreaterThan(240); expect(result.topLayerPixel[0]).toBeLessThan(5);
});
