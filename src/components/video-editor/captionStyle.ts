import type { CaptionWordState } from "./captionLayout";
import { fontFamilyDisplayName, localFontCssFamily } from "@/lib/localFonts";
import { DEFAULT_AUTO_CAPTION_SETTINGS, getDefaultCaptionFontFamily, type AutoCaptionSettings } from "./types";

export function getCaptionFontStack(settings?: Pick<AutoCaptionSettings, "fontFamily">) {
	const family = settings?.fontFamily?.trim() || getDefaultCaptionFontFamily();
	const selected = family === getDefaultCaptionFontFamily()
		? family.replace(/,\s*sans-serif$/i, "")
		: localFontCssFamily(fontFamilyDisplayName(family));
	return `${selected}, "Microsoft YaHei", sans-serif`;
}

export const CAPTION_FONT_WEIGHT = 400;
export const CAPTION_LINE_HEIGHT = 1.32;

export type CaptionPosition = Pick<AutoCaptionSettings, "bottomOffset" | "horizontalOffset">;

export function getCaptionAnchor(settings: CaptionPosition, width: number, height: number, boxHeight: number) {
	return {
		centerX: width / 2 + width * (settings.horizontalOffset ?? 0) / 100,
		centerY: height - height * settings.bottomOffset / 100 - boxHeight / 2,
	};
}

export function getCaptionFontWeight(settings: AutoCaptionSettings) {
	return settings.fontWeight === "bold"
		? 700
		: settings.fontWeight === "medium"
			? 500
			: CAPTION_FONT_WEIGHT;
}

export function getCaptionTextEffects(settings: AutoCaptionSettings, fontSize: number) {
	const scale = fontSize / Math.max(1, settings.fontSize);
	const hex = /^#[0-9a-f]{6}$/i.test(settings.shadowColor) ? settings.shadowColor : "#000000";
	const rgb = [1, 3, 5].map((offset) => parseInt(hex.slice(offset, offset + 2), 16));
	return {
		// Paint the inner half beneath the fill, leaving the requested outside width visible.
		strokeWidth:
			(settings.strokeWidth ?? 0) * scale * (settings.strokePosition === "outside" ? 2 : 1),
		strokeColor: settings.strokeColor || "#000000",
		shadowColor: settings.shadowEnabled
			? `rgba(${rgb.join(", ")}, ${settings.shadowOpacity ?? 0.65})`
			: "transparent",
		shadowBlur: settings.shadowEnabled ? (settings.shadowBlur ?? 4) * scale : 0,
		shadowOffsetX: settings.shadowEnabled ? (settings.shadowOffsetX ?? 0) * scale : 0,
		shadowOffsetY: settings.shadowEnabled ? (settings.shadowOffsetY ?? 2) * scale : 0,
	};
}

export function getCaptionPreviewTextStyle(settings: AutoCaptionSettings, fontSize: number) {
	const effects = getCaptionTextEffects(settings, fontSize);
	return {
		fontWeight: getCaptionFontWeight(settings),
		WebkitTextStroke: `${effects.strokeWidth}px ${effects.strokeColor}`,
		paintOrder: "stroke fill" as const,
		textShadow: settings.shadowEnabled
			? `${effects.shadowOffsetX}px ${effects.shadowOffsetY}px ${effects.shadowBlur}px ${effects.shadowColor}`
			: "none",
	};
}

export function getCaptionEffectPadding(settings: AutoCaptionSettings, fontSize: number) {
	const effects = getCaptionTextEffects(settings, fontSize);
	return Math.ceil(
		effects.strokeWidth +
			2 * effects.shadowBlur +
			Math.max(Math.abs(effects.shadowOffsetX), Math.abs(effects.shadowOffsetY)),
	);
}

/** Keep text effects consistent in both canvas export renderers. */
export function drawCaptionText(
	ctx: CanvasRenderingContext2D,
	text: string,
	x: number,
	y: number,
	settings: AutoCaptionSettings,
	fontSize: number,
) {
	const effects = getCaptionTextEffects(settings, fontSize);
	ctx.save();
	ctx.shadowColor = effects.shadowColor;
	ctx.shadowBlur = effects.shadowBlur;
	ctx.shadowOffsetX = effects.shadowOffsetX;
	ctx.shadowOffsetY = effects.shadowOffsetY;
	if (effects.strokeWidth > 0) {
		ctx.strokeStyle = effects.strokeColor;
		// Canvas strokes straddle glyph edges; CSS text-stroke uses the same width.
		ctx.lineWidth = effects.strokeWidth;
		ctx.lineJoin = "round";
		ctx.strokeText(text, x, y);
		ctx.shadowColor = "transparent";
	}
	ctx.fillText(text, x, y);
	ctx.restore();
}

const DEFAULT_CAPTION_REFERENCE_WIDTH = 1920 * (DEFAULT_AUTO_CAPTION_SETTINGS.maxWidth / 100);

export function getCaptionTargetWidth(containerWidth: number, maxWidthPercent: number) {
	return Math.max(1, containerWidth * (maxWidthPercent / 100));
}

export function getCaptionScaledFontSize(
	fontSize: number,
	containerWidth: number,
	maxWidthPercent: number,
) {
	return Math.max(
		14,
		fontSize *
			(getCaptionTargetWidth(containerWidth, maxWidthPercent) /
				DEFAULT_CAPTION_REFERENCE_WIDTH),
	);
}

export function getCaptionPadding(fontSize: number) {
	return {
		x: fontSize * 1.1,
		y: fontSize * 0.78,
	};
}

export function getCaptionScaledRadius(radius: number, fontSize: number) {
	const baseline = Math.max(1, DEFAULT_AUTO_CAPTION_SETTINGS.fontSize);
	return Math.max(0, radius * (fontSize / baseline));
}

export function getCaptionTextMaxWidth(
	containerWidth: number,
	maxWidthPercent: number,
	fontSize: number,
) {
	const padding = getCaptionPadding(fontSize);
	return Math.max(
		fontSize * 4,
		getCaptionTargetWidth(containerWidth, maxWidthPercent) - padding.x * 2,
	);
}

export function getCaptionWordVisualState(_hasWordTimings: boolean, _state: CaptionWordState) {
	// Per-word "spoken" highlighting is disabled: word-level timings from the
	// transcriber are unreliable, so captions render as a single uniform block.
	return {
		isInactive: false,
		opacity: 1,
	};
}
