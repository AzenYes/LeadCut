import { describe, expect, it, vi } from "vitest";
import {
	drawCaptionText,
	getCaptionAnchor,
	getCaptionEffectPadding,
	getCaptionFontStack,
	getCaptionPreviewTextStyle,
	getCaptionTextEffects,
} from "./captionStyle";
import { DEFAULT_AUTO_CAPTION_SETTINGS } from "./types";

const settings = {
	...DEFAULT_AUTO_CAPTION_SETTINGS,
	fontSize: 40,
	fontWeight: "bold" as const,
	strokeWidth: 4,
	strokeColor: "#112233",
	shadowEnabled: true,
	shadowColor: "#334455",
	shadowOpacity: 0.5,
	shadowBlur: 8,
	shadowOffsetX: -2,
	shadowOffsetY: 6,
};

it("anchors the caption consistently inside the frame using percentages", () => {
	const anchor = getCaptionAnchor({ bottomOffset: 3 }, 1920, 1080, 100);
	expect(anchor.centerX).toBe(960);
	expect(anchor.centerY).toBeCloseTo(1080 - 32.4 - 50);
	expect(getCaptionAnchor({ bottomOffset: 3, horizontalOffset: 10 }, 1920, 1080, 100).centerX).toBe(1152);
});

describe("caption text appearance", () => {
	it("keeps the selected family ahead of the Windows and generic fallbacks", () => {
		expect(getCaptionFontStack({ fontFamily: '\"Example, Caption\", serif' })).toBe(
			'\"Example, Caption\", \"Microsoft YaHei\", sans-serif',
		);
		expect(getCaptionFontStack(settings)).toMatch(/"Microsoft YaHei", sans-serif$/);
	});
	it("scales outline and shadow consistently for preview and export", () => {
		expect(getCaptionTextEffects(settings, 20)).toEqual({
			strokeWidth: 2,
			strokeColor: "#112233",
			shadowColor: "rgba(51, 68, 85, 0.5)",
			shadowBlur: 4,
			shadowOffsetX: -1,
			shadowOffsetY: 3,
		});
		expect(getCaptionPreviewTextStyle(settings, 20)).toEqual({
			fontWeight: 700,
			WebkitTextStroke: "2px #112233",
			paintOrder: "stroke fill",
			textShadow: "-1px 3px 4px rgba(51, 68, 85, 0.5)",
		});
		expect(getCaptionEffectPadding(settings, 20)).toBe(13);
	});

	it("draws the outline before the fill and restores the context", () => {
		const calls: string[] = [];
		const context = {
			save: vi.fn(),
			restore: vi.fn(),
			strokeText: vi.fn(() => calls.push("stroke")),
			fillText: vi.fn(() => calls.push("fill")),
		} as unknown as CanvasRenderingContext2D;
		drawCaptionText(context, "阿真", 10, 20, settings, 20);
		expect(calls).toEqual(["stroke", "fill"]);
		expect(context.strokeText).toHaveBeenCalledWith("阿真", 10, 20);
		expect(context.lineWidth).toBe(2);
		expect(context.shadowBlur).toBe(4);
		expect(context.restore).toHaveBeenCalledOnce();
	});

	it("keeps legacy captions free of added outline or shadow", () => {
		expect(getCaptionPreviewTextStyle(DEFAULT_AUTO_CAPTION_SETTINGS, 30)).toMatchObject({
			fontWeight: 400,
			WebkitTextStroke: "0px #000000",
			textShadow: "none",
		});
	});
});
