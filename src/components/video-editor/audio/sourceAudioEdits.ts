import { mergeEditRanges, type EditRange } from "../sequenceEdits";
import type { SourceAudioTrackSetting } from "./audioTypes";

export function normalizeSourceAudioDeletedRanges(ranges: EditRange[] = []): EditRange[] {
	return mergeEditRanges(
		ranges
			.filter((range) => Number.isFinite(range?.startMs) && Number.isFinite(range?.endMs))
			.map((range) => ({ startMs: Math.max(0, range.startMs), endMs: range.endMs })),
	);
}

export function isSourceAudioDeleted(
	setting: SourceAudioTrackSetting | undefined,
	sourceMs: number,
): boolean {
	return (
		setting?.deletedRanges?.some(
			(range) => sourceMs >= range.startMs && sourceMs < range.endMs,
		) ?? false
	);
}

export function getAudibleSourceAudioRanges(
	span: EditRange,
	deletedRanges: EditRange[] = [],
): EditRange[] {
	const audible: EditRange[] = [];
	let cursor = span.startMs;
	for (const range of normalizeSourceAudioDeletedRanges(deletedRanges)) {
		if (range.endMs <= cursor || range.startMs >= span.endMs) continue;
		if (range.startMs > cursor) audible.push({ startMs: cursor, endMs: range.startMs });
		cursor = Math.min(span.endMs, range.endMs);
	}
	if (cursor < span.endMs) audible.push({ startMs: cursor, endMs: span.endMs });
	return audible;
}
