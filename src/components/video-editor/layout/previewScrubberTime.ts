export function scrubberTimeAtPosition(offset: number, width: number, duration: number) {
	if (width <= 0 || duration <= 0) return 0;
	return Math.max(0, Math.min(1, offset / width)) * duration;
}
