import { resolveEntryTimelineMs, type ChangeConfidence, type ChangeLogEntry } from "./changeLog";
import { getClipSourceEndMs, sortClipRegions, type CaptionCue, type ClipRegion } from "./types";

export type ChangeReviewMarkers = ReadonlyMap<number, ChangeConfidence | "unknown">;
export const CUT_REVIEW_CONTEXT_MS = 2000;

export function getCutReviewRange(entry: ChangeLogEntry, durationMs: number) {
	if (durationMs <= 0) return null;
	const endOfCut = Math.max(0, Math.min(entry.timelineMs, durationMs));
	const startOfCut = entry.review === "restored" ? endOfCut - entry.durationMs : endOfCut;
	return {
		start: Math.max(0, startOfCut - CUT_REVIEW_CONTEXT_MS),
		end: Math.min(durationMs, endOfCut + CUT_REVIEW_CONTEXT_MS),
	};
}

export function projectChangeLogEntry(entry: ChangeLogEntry, clips: ClipRegion[]) {
	return resolveEntryTimelineMs(entry, clips);
}

export function restoreClipSequence(clips: ClipRegion[], entry: ChangeLogEntry, createId: () => string) {
	if (entry.durationMs <= 0) return clips;
	const sequence = sortClipRegions(clips);
	let index = sequence.length - 1;
	while (index >= 0 && getClipSourceEndMs(sequence[index]) > entry.sourceStartMs) index--;
	const previous = sequence[index];
	const restored: ClipRegion = {
		id: createId(),
		startMs: 0,
		endMs: entry.durationMs,
		sourceStartMs: entry.sourceStartMs,
		speed: entry.speed,
		...(previous?.sourceMinMs !== undefined ? { sourceMinMs: previous.sourceMinMs } : {}),
		...(previous?.sourceMaxMs !== undefined ? { sourceMaxMs: previous.sourceMaxMs } : {}),
	};
	sequence.splice(index + 1, 0, restored);
	return sequence;
}

export function insertTimelineGap(cues: CaptionCue[], atMs: number, durationMs: number) {
	if (durationMs <= 0 || !cues.some(cue => cue.timeBasis === "timeline" && cue.startMs >= atMs)) return cues;
	return cues.map(cue => cue.timeBasis !== "timeline" || cue.startMs < atMs ? cue : {
		...cue,
		startMs: cue.startMs + durationMs,
		endMs: cue.endMs + durationMs,
		...(cue.words ? { words: cue.words.map(word => ({
			...word, startMs: word.startMs + durationMs, endMs: word.endMs + durationMs,
		})) } : {}),
	});
}
