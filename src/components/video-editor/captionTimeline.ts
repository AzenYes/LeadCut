import {
	type CaptionCue,
	type ClipRegion,
	getClipSourceEndMs,
	getClipSourceStartMs,
	sortClipRegions,
} from "./types";

export function captionSpanToSource(clip: ClipRegion, span: { start: number; end: number }) {
	const sourceTime = (time: number) =>
		Math.round(
			getClipSourceStartMs(clip) +
				(Math.max(clip.startMs, Math.min(clip.endMs, time)) - clip.startMs) * clip.speed,
		);
	return { startMs: sourceTime(span.start), endMs: sourceTime(span.end) };
}

export function projectCaptionCues(cues: CaptionCue[], clips: ClipRegion[]) {
	const imported = cues.filter((cue) => cue.timeBasis === "timeline").map((cue) => ({
		...cue, sourceCueId: cue.id, sourceCue: cue, clip: null as ClipRegion | null,
	}));
	const generated = sortClipRegions(clips).flatMap((clip) => {
		const sourceStart = getClipSourceStartMs(clip);
		const sourceEnd = getClipSourceEndMs(clip);
		return cues.flatMap((cue) => {
			if (cue.timeBasis === "timeline") return [];
			const start = Math.max(cue.startMs, sourceStart);
			const end = Math.min(cue.endMs, sourceEnd);
			if (start >= end) return [];
			return [
				{
					...cue,
					id: JSON.stringify([cue.id, clip.id]),
					sourceCueId: cue.id,
					sourceCue: cue,
					clip,
					startMs: clip.startMs + (start - sourceStart) / clip.speed,
					endMs: clip.startMs + (end - sourceStart) / clip.speed,
				},
			];
		});
	});
	return [...generated, ...imported].sort((a, b) => a.startMs - b.startMs || a.endMs - b.endMs);
}

/** Import/generation replaces the track, so every cue shares the same clock. */
export function getCaptionTimeMs(cues: CaptionCue[], sourceTimeMs: number, timelineTimeMs: number) {
	return cues[0]?.timeBasis === "timeline" ? timelineTimeMs : sourceTimeMs;
}

export function retimeCaptionFragment(
	fragment: ReturnType<typeof projectCaptionCues>[number],
	span: { start: number; end: number },
) {
	if (fragment.sourceCue.timeBasis === "timeline") return { startMs: span.start, endMs: span.end };
	if (!fragment.clip) return { startMs: fragment.startMs, endMs: fragment.endMs };
	const mapped = captionSpanToSource(fragment.clip, span);
	// An unchanged clipped edge must not truncate the rest of the source cue.
	return {
		startMs: span.start === fragment.startMs ? fragment.sourceCue.startMs : mapped.startMs,
		endMs: span.end === fragment.endMs ? fragment.sourceCue.endMs : mapped.endMs,
	};
}
