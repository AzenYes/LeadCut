export interface HudOverlayWorkArea {
	x: number;
	y: number;
	width: number;
	height: number;
}

export type HudSavedPlacement = { displayId: number; xRatio: number; yRatio: number };
export type HudOverlayPlacements = {
	barPlacement?: HudSavedPlacement;
	webcamPreviewPlacement?: HudSavedPlacement;
};
export type HudOverlayPlacementSnapshot = HudOverlayPlacements & { displayId: number };
export type HudDisplayChange = {
	displayId: number;
	workArea: HudOverlayWorkArea;
	cursor?: { x: number; y: number };
};

type Size = Pick<HudOverlayWorkArea, "width" | "height">;

export function normalizeHudPlacement(value: unknown): HudSavedPlacement | undefined {
	if (!value || typeof value !== "object") return;
	const { displayId, xRatio, yRatio } = value as Partial<HudSavedPlacement>;
	if (typeof displayId !== "number" || !Number.isSafeInteger(displayId) || typeof xRatio !== "number" || typeof yRatio !== "number" ||
		!Number.isFinite(xRatio) || !Number.isFinite(yRatio)) return;
	return { displayId, xRatio: clamp(xRatio, 0, 1), yRatio: clamp(yRatio, 0, 1) };
}

export function resolveHudDisplay<T extends { id: number }>(
	saved: Pick<HudSavedPlacement, "displayId"> | undefined,
	displays: readonly T[],
	primary: T,
): T {
	return displays.find((display) => display.id === saved?.displayId) ?? primary;
}

function placementAxis(value: number, viewport: number, size: number, toRatio: boolean) {
	const travel = Math.max(0, viewport - size);
	if (!travel) return 0;
	return toRatio ? clamp(value / travel, 0, 1) : Math.round(clamp(value, 0, 1) * travel);
}

/** Return window-local DIP coordinates. Work-area origins are only needed to place the native window. */
export function placementToOffset(placement: HudSavedPlacement, workArea: Size, barSize: Size) {
	return {
		x: placementAxis(placement.xRatio, workArea.width, barSize.width, false),
		y: placementAxis(placement.yRatio, workArea.height, barSize.height, false),
	};
}

export function offsetToPlacement(offset: { x: number; y: number }, workArea: Size, barSize: Size, displayId: number): HudSavedPlacement {
	return {
		displayId,
		xRatio: placementAxis(offset.x, workArea.width, barSize.width, true),
		yRatio: placementAxis(offset.y, workArea.height, barSize.height, true),
	};
}

const NON_PASSTHROUGH_HUD_WIDTH_DIP = 860;
const NON_PASSTHROUGH_HUD_COMPACT_HEIGHT_DIP = 160;
const NON_PASSTHROUGH_HUD_EXPANDED_HEIGHT_DIP = 540;

function clamp(value: number, min: number, max: number): number {
	return Math.min(Math.max(value, min), max);
}

export function getHudOverlayWindowBounds(
	workArea: HudOverlayWorkArea,
	mousePassthroughSupported: boolean,
	fallbackExpanded = false,
): HudOverlayWorkArea {
	if (mousePassthroughSupported) {
		return { ...workArea };
	}

	const width = Math.min(workArea.width, NON_PASSTHROUGH_HUD_WIDTH_DIP);
	const height = Math.min(
		workArea.height,
		fallbackExpanded
			? NON_PASSTHROUGH_HUD_EXPANDED_HEIGHT_DIP
			: NON_PASSTHROUGH_HUD_COMPACT_HEIGHT_DIP,
	);

	return {
		x: Math.round(workArea.x + (workArea.width - width) / 2),
		y: Math.round(workArea.y + workArea.height - height),
		width,
		height,
	};
}

export function shouldExpandHudOverlayFallback({
	fallbackExpanded,
	recordingActive,
	webcamPreviewVisible,
}: {
	fallbackExpanded: boolean;
	recordingActive: boolean;
	webcamPreviewVisible: boolean;
}): boolean {
	return fallbackExpanded || (recordingActive && webcamPreviewVisible);
}

export function resizeHudOverlayFallbackBounds(
	workArea: HudOverlayWorkArea,
	currentBounds: HudOverlayWorkArea,
	fallbackExpanded: boolean,
): HudOverlayWorkArea {
	const nextBounds = getHudOverlayWindowBounds(workArea, false, fallbackExpanded);
	const maxX = workArea.x + workArea.width - nextBounds.width;
	const maxY = workArea.y + workArea.height - nextBounds.height;

	return {
		...nextBounds,
		x: clamp(currentBounds.x, workArea.x, maxX),
		y: clamp(currentBounds.y + currentBounds.height - nextBounds.height, workArea.y, maxY),
	};
}
