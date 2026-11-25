import { Graphics, Sprite } from "pixi.js";
import { describe, expect, it, vi } from "vitest";

import { ADVANCED_VERTICAL_PADDING_MAX } from "../types";
import { computePaddedLayout, layoutVideoContent, scalePreviewBorderRadius } from "./layoutUtils";

const BASE_LAYOUT_PARAMS = {
	width: 1000,
	height: 1000,
	cropRegion: { x: 0, y: 0, width: 1, height: 1 },
	videoWidth: 1000,
	videoHeight: 1000,
};

describe("computePaddedLayout", () => {
	it("allows advanced bottom padding to pin the video to the top edge", () => {
		const layout = computePaddedLayout({
			...BASE_LAYOUT_PARAMS,
			padding: {
				top: 0,
				bottom: ADVANCED_VERTICAL_PADDING_MAX,
				left: 0,
				right: 0,
				linked: false,
			},
		});

		expect(layout.centerOffsetY).toBeCloseTo(0);
	});

	it("allows advanced top padding to pin the video to the bottom edge", () => {
		const layout = computePaddedLayout({
			...BASE_LAYOUT_PARAMS,
			padding: {
				top: ADVANCED_VERTICAL_PADDING_MAX,
				bottom: 0,
				left: 0,
				right: 0,
				linked: false,
			},
		});

		expect(layout.centerOffsetY + layout.croppedDisplayHeight).toBeCloseTo(
			BASE_LAYOUT_PARAMS.height,
		);
	});

	it("preserves linked padding centering behavior", () => {
		const layout = computePaddedLayout({
			...BASE_LAYOUT_PARAMS,
			padding: { top: 20, bottom: 20, left: 20, right: 20, linked: true },
		});

		expect(layout.centerOffsetY).toBeCloseTo(40);
		expect(layout.centerOffsetY + layout.croppedDisplayHeight).toBeCloseTo(960);
	});
});

describe("scalePreviewBorderRadius", () => {
	it("uses a percentage of the content's shorter side", () => {
		expect(scalePreviewBorderRadius(1920, 1080, 8)).toBeCloseTo(86.4, 6);
		expect(scalePreviewBorderRadius(960, 540, 8)).toBeCloseTo(43.2, 6);
		expect(scalePreviewBorderRadius(500, 1000, 8)).toBeCloseTo(40, 6);
	});

	it("clamps invalid or empty preview sizes to zero", () => {
		expect(scalePreviewBorderRadius(0, 540, 16)).toBe(0);
		expect(scalePreviewBorderRadius(960, 0, 16)).toBe(0);
		expect(scalePreviewBorderRadius(960, 540, -8)).toBe(0);
	});
});

describe("preview mask layout", () => {
	function createLayout(width: number, height: number) {
		const maskGraphics = new Graphics();
		const container = { clientWidth: width, clientHeight: height };
		const canvas = { width, height, style: {} };
		const params = {
			container: container as HTMLDivElement,
			app: { canvas, renderer: { resolution: 1, resize: vi.fn() } } as unknown as Parameters<typeof layoutVideoContent>[0]["app"],
			videoSprite: new Sprite(),
			videoElement: { videoWidth: 1920, videoHeight: 1080 } as HTMLVideoElement,
			maskGraphics,
		};
		return { container, params, maskGraphics, clear: vi.spyOn(maskGraphics, "clear") };
	}

	it("transforms the existing geometry when padding changes its scale and position", () => {
		const { params, maskGraphics, clear } = createLayout(960, 540);
		const initial = layoutVideoContent({ ...params, borderRadius: 20 })!;
		const padded = layoutVideoContent({
			...params, borderRadius: 20,
			padding: { left: 40, right: 10, top: 15, bottom: 25, linked: false },
		})!;

		expect(clear).toHaveBeenCalledTimes(1);
		expect(maskGraphics.scale.x).toBeCloseTo(padded.baseScale / initial.baseScale, 10);
		expect(maskGraphics.scale.y).toBe(maskGraphics.scale.x);
		expect(maskGraphics.position.x).toBe(padded.maskRect.x);
		expect(maskGraphics.position.y).toBe(padded.maskRect.y);
	});

	it("rebuilds when rounding begins or the source crop changes", () => {
		const { container, params, maskGraphics, clear } = createLayout(64, 36);
		layoutVideoContent({ ...params, borderRadius: 1 });
		container.clientWidth = 192;
		container.clientHeight = 108;
		layoutVideoContent({ ...params, borderRadius: 1 });
		expect(clear).toHaveBeenCalledTimes(2);

		layoutVideoContent({ ...params, borderRadius: 1, cropRegion: { x: 0.1, y: 0, width: 0.8, height: 1 } });
		expect(clear).toHaveBeenCalledTimes(3);
		expect(maskGraphics.scale.x).toBe(1);
		expect(maskGraphics.scale.y).toBe(1);
	});
});
