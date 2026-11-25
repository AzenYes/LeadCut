import { describe, expect, it } from "vitest";
import { buildExportFrameRendererConfig } from "./exportFrameRendererConfig";

describe("Export renderer config", () => {
	it("forwards cursor click-effect settings into the frame renderer config", () => {
		const config = buildExportFrameRendererConfig(
			{
				width: 1920,
				height: 1080,
				wallpaper: "#101010",
				zoomRegions: [],
				showShadow: false,
				shadowIntensity: 0,
				backgroundBlur: 0,
				cropRegion: { x: 0, y: 0, width: 1, height: 1 },
				cursorClickEffect: "echo",
				cursorClickEffectColor: "#22C55E",
				cursorClickEffectScale: 1.4,
				cursorClickEffectOpacity: 0.65,
				cursorClickEffectDurationMs: 720,
			},
			{ width: 1920, height: 1080 },
		);

		expect(config).toMatchObject({
			cursorClickEffect: "echo",
			cursorClickEffectColor: "#22C55E",
			cursorClickEffectScale: 1.4,
			cursorClickEffectOpacity: 0.65,
			cursorClickEffectDurationMs: 720,
		});
	});
});
