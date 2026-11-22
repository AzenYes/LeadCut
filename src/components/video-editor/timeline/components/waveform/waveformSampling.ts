import type { Span } from "dnd-timeline";
import type { AudioPeaksData } from "../../core/timelineTypes";

/** Clip the drawing to the viewport, mapping display time back to source audio. */
export function getVisibleWaveformSpan(display: Span, source: Span, range: Span) {
	const start = Math.max(display.start, range.start);
	const end = Math.min(display.end, range.end);
	if (end <= start || display.end <= display.start) return null;
	const scale = (source.end - source.start) / (display.end - display.start);
	return {
		display: { start, end },
		source: {
			start: source.start + (start - display.start) * scale,
			end: source.start + (end - display.start) * scale,
		},
	};
}

/** Preserve short sounds when zoomed out by taking each pixel's maximum peak. */
export function sampleWaveformWindow(
	{ peaks, durationMs }: AudioPeaksData,
	startMs: number,
	endMs: number,
	pixelCount: number,
): Float32Array {
	const result = new Float32Array(Math.max(0, Math.floor(pixelCount)));
	if (durationMs <= 0 || peaks.length === 0 || endMs <= startMs) return result;
	const msPerPixel = (endMs - startMs) / result.length;
	for (let pixel = 0; pixel < result.length; pixel++) {
		const start = startMs + pixel * msPerPixel;
		const end = start + msPerPixel;
		if (end <= 0 || start >= durationMs) continue;
		const first = Math.max(0, Math.floor((start / durationMs) * peaks.length));
		const last = Math.min(peaks.length, Math.ceil((end / durationMs) * peaks.length));
		for (let index = first; index < last; index++) {
			result[pixel] = Math.max(result[pixel], peaks[index]);
		}
	}
	return result;
}
