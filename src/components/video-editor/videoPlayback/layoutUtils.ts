import { Application, Graphics, Sprite } from "pixi.js";
import { drawSquircleOnGraphics } from "@/lib/geometry/squircle";
import { ADVANCED_VERTICAL_PADDING_MAX, type CropRegion, type Padding } from "../types";

export const PADDING_SCALE_FACTOR = 0.2;
export const BASE_PREVIEW_WIDTH = 1920;
export const BASE_PREVIEW_HEIGHT = 1080;

export function scalePreviewBorderRadius(
	width: number,
	height: number,
	borderRadiusPercent = 0,
): number {
	if (width <= 0 || height <= 0) {
		return 0;
	}

	return (Math.min(width, height) * Math.min(50, Math.max(0, borderRadiusPercent))) / 100;
}

export function isZeroPadding(padding: Padding | number): boolean {
	if (typeof padding === "number") {
		return padding === 0;
	}
	return padding.top === 0 && padding.bottom === 0 && padding.left === 0 && padding.right === 0;
}

export interface PaddedLayoutResult {
	scale: number;
	centerOffsetX: number;
	centerOffsetY: number;
	spriteX: number;
	spriteY: number;
	fullFrameDisplayW: number;
	fullFrameDisplayH: number;
	fullVideoDisplayWidth: number;
	fullVideoDisplayHeight: number;
	croppedDisplayWidth: number;
	croppedDisplayHeight: number;
	cropStartX: number;
	cropStartY: number;
}

export function computePaddedLayout(params: {
	width: number;
	height: number;
	padding: Padding | number;
	frameInsets?: { top: number; right: number; bottom: number; left: number } | null;
	cropRegion: CropRegion;
	videoWidth: number;
	videoHeight: number;
}): PaddedLayoutResult {
	const { width, height, padding, frameInsets, cropRegion, videoWidth, videoHeight } = params;

	// Apply asymmetrical padding
	const p =
		typeof padding === "number"
			? { top: padding, bottom: padding, left: padding, right: padding }
			: padding;

	// Padding is a percentage. Linked padding keeps the original 0-100 scaling
	// behavior; advanced vertical padding gets extra range for positioning.
	const isAdvancedPadding = typeof padding !== "number" && padding.linked === false;
	const clampPercent = (v: number, max = 100) => Math.min(max, Math.max(0, v));
	const leftPercent = clampPercent(p.left);
	const rightPercent = clampPercent(p.right);
	const topPercent = clampPercent(p.top, isAdvancedPadding ? ADVANCED_VERTICAL_PADDING_MAX : 100);
	const bottomPercent = clampPercent(
		p.bottom,
		isAdvancedPadding ? ADVANCED_VERTICAL_PADDING_MAX : 100,
	);
	const leftPadFrac = (leftPercent / 100) * PADDING_SCALE_FACTOR;
	const rightPadFrac = (rightPercent / 100) * PADDING_SCALE_FACTOR;
	const topPadFrac = (Math.min(topPercent, 100) / 100) * PADDING_SCALE_FACTOR;
	const bottomPadFrac = (Math.min(bottomPercent, 100) / 100) * PADDING_SCALE_FACTOR;

	const availableFracW = Math.max(0, 1.0 - leftPadFrac - rightPadFrac);
	const availableFracH = Math.max(0, 1.0 - topPadFrac - bottomPadFrac);

	const maxDisplayWidth = width * availableFracW;
	const maxDisplayHeight = height * availableFracH;

	const crop = cropRegion;
	const croppedVideoWidth = videoWidth * crop.width;
	const croppedVideoHeight = videoHeight * crop.height;

	const insets = frameInsets;
	const screenFracW = insets ? 1 - insets.left - insets.right : 1;
	const screenFracH = insets ? 1 - insets.top - insets.bottom : 1;

	const fullFrameVideoW = croppedVideoWidth / screenFracW;
	const fullFrameVideoH = croppedVideoHeight / screenFracH;

	const scale = Math.min(
		fullFrameVideoW > 0 ? maxDisplayWidth / fullFrameVideoW : 0,
		fullFrameVideoH > 0 ? maxDisplayHeight / fullFrameVideoH : 0,
	);

	const fullVideoDisplayWidth = videoWidth * scale;
	const fullVideoDisplayHeight = videoHeight * scale;
	const croppedDisplayWidth = croppedVideoWidth * scale;
	const croppedDisplayHeight = croppedVideoHeight * scale;

	const fullFrameDisplayW = fullFrameVideoW * scale;
	const fullFrameDisplayH = fullFrameVideoH * scale;

	const availableCenterX = leftPadFrac * width + maxDisplayWidth / 2;
	const availableCenterY = isAdvancedPadding
		? (() => {
				const verticalTravel = Math.max(0, height - fullFrameDisplayH);
				const centeredOffsetY = verticalTravel / 2;
				const directionalOffsetY =
					centeredOffsetY +
					((topPercent - bottomPercent) / ADVANCED_VERTICAL_PADDING_MAX) *
						centeredOffsetY;
				const frameOffsetY = Math.min(verticalTravel, Math.max(0, directionalOffsetY));
				return frameOffsetY + fullFrameDisplayH / 2;
			})()
		: topPadFrac * height + maxDisplayHeight / 2;

	const frameCenterX = availableCenterX - fullFrameDisplayW / 2;
	const frameCenterY = availableCenterY - fullFrameDisplayH / 2;

	const centerOffsetX = insets ? frameCenterX + insets.left * fullFrameDisplayW : frameCenterX;
	const centerOffsetY = insets ? frameCenterY + insets.top * fullFrameDisplayH : frameCenterY;

	const spriteX = centerOffsetX - crop.x * fullVideoDisplayWidth;
	const spriteY = centerOffsetY - crop.y * fullVideoDisplayHeight;

	return {
		scale,
		centerOffsetX,
		centerOffsetY,
		spriteX,
		spriteY,
		fullFrameDisplayW,
		fullFrameDisplayH,
		fullVideoDisplayWidth,
		fullVideoDisplayHeight,
		croppedDisplayWidth,
		croppedDisplayHeight,
		cropStartX: crop.x * videoWidth,
		cropStartY: crop.y * videoHeight,
	};
}

interface LayoutParams {
	container: HTMLDivElement;
	app: Application;
	videoSprite: Sprite;
	maskGraphics: Graphics;
	videoElement: HTMLVideoElement;
	cropRegion?: CropRegion;
	lockedVideoDimensions?: { width: number; height: number } | null;
	borderRadius?: number;
	padding?: Padding | number;
	/** Screen insets from the active device frame, used to scale/center the full frame */
	frameInsets?: { top: number; right: number; bottom: number; left: number } | null;
}

interface LayoutResult {
	stageSize: { width: number; height: number };
	videoSize: { width: number; height: number };
	baseScale: number;
	baseOffset: { x: number; y: number };
	maskRect: {
		x: number;
		y: number;
		width: number;
		height: number;
		sourceCrop?: CropRegion;
	};
	cropBounds: { startX: number; endX: number; startY: number; endY: number };
}

const previewMaskShapes = new WeakMap<Graphics, {
	width: number;
	height: number;
	borderRadius: number;
	rounded: boolean;
	scale: number;
}>();

function updatePreviewMask(
	graphics: Graphics,
	layout: PaddedLayoutResult,
	width: number,
	height: number,
	borderRadius: number,
) {
	const radius = scalePreviewBorderRadius(layout.croppedDisplayWidth, layout.croppedDisplayHeight, borderRadius);
	const rounded = radius > 0.5;
	const shape = previewMaskShapes.get(graphics);
	if (shape && shape.width === width && shape.height === height && shape.borderRadius === borderRadius &&
		shape.rounded === rounded && shape.scale > 0 && layout.scale > 0) {
		graphics.scale.set(layout.scale / shape.scale);
	} else {
		graphics.clear();
		drawSquircleOnGraphics(graphics, {
			x: 0,
			y: 0,
			width: layout.croppedDisplayWidth,
			height: layout.croppedDisplayHeight,
			radius,
		});
		graphics.fill({ color: 0xffffff });
		previewMaskShapes.set(graphics, { width, height, borderRadius, rounded, scale: layout.scale });
		graphics.scale.set(1);
	}
	graphics.position.set(layout.centerOffsetX, layout.centerOffsetY);
}

export function layoutVideoContent(params: LayoutParams): LayoutResult | null {
	const {
		container,
		app,
		videoSprite,
		maskGraphics,
		videoElement,
		cropRegion,
		lockedVideoDimensions,
		borderRadius = 0,
		padding = 0,
		frameInsets,
	} = params;

	const videoWidth = lockedVideoDimensions?.width || videoElement.videoWidth;
	const videoHeight = lockedVideoDimensions?.height || videoElement.videoHeight;

	if (!videoWidth || !videoHeight) {
		return null;
	}

	const width = container.clientWidth;
	const height = container.clientHeight;

	if (!width || !height) {
		return null;
	}

	const { canvas, renderer } = app;
	const resolution = renderer.resolution;
	if (
		canvas.width !== Math.round(width * resolution) ||
		canvas.height !== Math.round(height * resolution)
	) {
		renderer.resize(width, height);
	}
	canvas.style.width = "100%";
	canvas.style.height = "100%";

	const crop = cropRegion || { x: 0, y: 0, width: 1, height: 1 };
	const layout = computePaddedLayout({
		width,
		height,
		padding,
		frameInsets,
		cropRegion: crop,
		videoWidth,
		videoHeight,
	});

	videoSprite.scale.set(layout.scale);
	videoSprite.position.set(layout.spriteX, layout.spriteY);

	const cropWidth = videoWidth * crop.width;
	const cropHeight = videoHeight * crop.height;
	// Padding changes the displayed size and position without changing the mask's shape.
	updatePreviewMask(maskGraphics, layout, cropWidth, cropHeight, borderRadius);

	return {
		stageSize: { width, height },
		videoSize: { width: cropWidth, height: cropHeight },
		baseScale: layout.scale,
		baseOffset: { x: layout.spriteX, y: layout.spriteY },
		maskRect: {
			x: layout.centerOffsetX,
			y: layout.centerOffsetY,
			width: layout.croppedDisplayWidth,
			height: layout.croppedDisplayHeight,
			sourceCrop: crop,
		},
		cropBounds: {
			startX: layout.cropStartX,
			endX: layout.cropStartX + cropWidth,
			startY: layout.cropStartY,
			endY: layout.cropStartY + cropHeight,
		},
	};
}
