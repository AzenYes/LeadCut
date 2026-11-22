export type PreviewWindowBounds = { x: number; y: number; width: number; height: number };

export function restorablePreviewWindowBounds(value: unknown, displays: PreviewWindowBounds[]) {
	if (!value || typeof value !== "object") return null;
	const bounds = value as PreviewWindowBounds;
	if (![bounds.x, bounds.y, bounds.width, bounds.height].every(Number.isFinite) ||
		bounds.width < 480 || bounds.height < 320 || bounds.width > 16384 || bounds.height > 16384) return null;
	const visible = displays.some(display =>
		// Keep enough of the title bar on a work area to move the window after restoring.
		bounds.x + 64 > display.x && bounds.x < display.x + display.width - 64 &&
		bounds.y + 24 > display.y && bounds.y < display.y + display.height - 24);
	return visible ? bounds : null;
}
