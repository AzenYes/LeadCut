import { captionWordsToText } from "./captionEditing";
import { projectCaptionCues } from "./captionTimeline";
import { intersectCutWithClip } from "./changeLog";
import {
	type AnnotationRegion, type AudioRegion, type CaptionCue, type ClipRegion,
	type SourceAudioTrackSettings, type ZoomRegion, getClipSourceStartMs,
} from "./types";
import type { VideoRegion, VideoTrack } from "./videoTracks";
import { deleteTimelineRanges, mergeEditRanges, type EditRange } from "../../../services/leadcut-mcp/src/timelineRanges";
export { deleteTimelineRanges, mergeEditRanges, type EditRange } from "../../../services/leadcut-mcp/src/timelineRanges";

const CAPTION_WORD_CUT_PADDING_MS = 40;

export function getCaptionWordCutRange(
	row: ReturnType<typeof projectCaptionCues>[number],
	textStart: number,
	textEnd: number,
	timelineDurationMs: number,
): EditRange | null {
	if (textStart >= textEnd || !row.sourceCue.words?.length) return null;
	const clip = row.clip;
	const toTimeline = (time: number) => clip
		? clip.startMs + (time - getClipSourceStartMs(clip)) / clip.speed : time;
	let offset = 0;
	let startMs = Infinity;
	let endMs = -Infinity;
	for (const word of row.sourceCue.words) {
		const token = word.text.trim();
		if (!token) continue;
		const at = row.text.indexOf(token, offset);
		if (at === -1) continue;
		offset = at + token.length;
		if (at >= textEnd || offset <= textStart) continue;
		if (word.timingUnreliable) return null;
		const start = Math.max(row.startMs, toTimeline(word.startMs));
		const end = Math.min(row.endMs, toTimeline(word.endMs));
		if (end <= start) continue;
		startMs = Math.min(startMs, start);
		endMs = Math.max(endMs, end);
	}
	if (startMs >= endMs) return null;
	startMs = Math.max(0, clip?.startMs ?? 0, Math.floor(startMs - CAPTION_WORD_CUT_PADDING_MS));
	endMs = Math.min(timelineDurationMs, clip?.endMs ?? Infinity, Math.ceil(endMs + CAPTION_WORD_CUT_PADDING_MS));
	return endMs > startMs ? { startMs, endMs } : null;
}

export function timelineRangesToSourceRanges(ranges: readonly EditRange[], clips: readonly ClipRegion[]) {
	return ranges.flatMap((range, rangeIndex) => clips.flatMap(clip => {
		const piece = intersectCutWithClip(range, clip, "timeline");
		return piece ? [{ ...piece, rangeIndex }] : [];
	}));
}

/** Do not invent word boundaries for imported captions with no word timing. */
export function trimCaption(cue: CaptionCue, startMs: number, endMs: number): CaptionCue {
	if (!cue.words?.length) return { ...cue, startMs, endMs };
	const words = cue.words
		.filter((word) => word.endMs > startMs && word.startMs < endMs)
		.map((word) => ({
			...word,
			startMs: Math.max(startMs, word.startMs),
			endMs: Math.min(endMs, word.endMs),
		}));
	return { ...cue, startMs, endMs, words, text: captionWordsToText(words) };
}

export function deleteTimelineCaptionRanges(cues: CaptionCue[], ranges: EditRange[]): CaptionCue[] {
	return cues.flatMap((cue) => {
		// Source-timed captions follow the surviving primary clips through projection.
		if (cue.timeBasis !== "timeline") return [cue];
		return deleteTimelineRanges([cue], ranges, (original, start, end) => {
			const trimmed = trimCaption(original, start, end);
			const shift = mergeEditRanges(ranges).reduce(
				(sum, cut) => sum + Math.max(0, Math.min(start, cut.endMs) - cut.startMs),
				0,
			);
			return {
				...trimmed,
				...(trimmed.words
					? {
							words: trimmed.words.map((word) => ({
								...word,
								startMs: word.startMs - shift,
								endMs: word.endMs - shift,
							})),
						}
					: {}),
			};
		});
	});
}

type RippleDeleteState = {
	clipRegions: ClipRegion[];
	videoTracks: VideoTrack[];
	videoRegions: VideoRegion[];
	audioRegions: AudioRegion[];
	annotationRegions: AnnotationRegion[];
	zoomRegions: ZoomRegion[];
	autoCaptions: CaptionCue[];
	sourceAudioTrackSettingsByClip: Record<string, SourceAudioTrackSettings>;
};

export function planRippleDelete(
	state: RippleDeleteState,
	ranges: EditRange[],
	createClipId = () => `clip-${crypto.randomUUID()}`,
) {
	const locked = new Set(state.videoTracks.filter(track => track.locked).map(track => track.id));
	const sourceAudioTrackSettingsByClip = { ...state.sourceAudioTrackSettingsByClip };
	const clipRegions = deleteTimelineRanges(state.clipRegions, ranges, (region, startMs) => ({
		...region, sourceStartMs: getClipSourceStartMs(region) + (startMs - region.startMs) * region.speed,
	}), (region) => {
		const id = createClipId();
		const sourceSettings = sourceAudioTrackSettingsByClip[region.id];
		if (sourceSettings) sourceAudioTrackSettingsByClip[id] = structuredClone(sourceSettings);
		return id;
	});
	return {
		clipRegions,
		sourceAudioTrackSettingsByClip,
		videoRegions: state.videoRegions.flatMap(region => locked.has(region.trackId) ? [region] :
			deleteTimelineRanges([region], ranges, (original, startMs) => ({
				...original, sourceStartMs: original.sourceStartMs + (startMs - original.startMs) * original.speed,
			}))),
		audioRegions: deleteTimelineRanges(state.audioRegions, ranges, (region, startMs) => ({
			...region, sourceStartMs: (region.sourceStartMs ?? 0) + (startMs - region.startMs) * (region.speed ?? 1),
		})),
		annotationRegions: deleteTimelineRanges(state.annotationRegions, ranges),
		zoomRegions: deleteTimelineRanges(state.zoomRegions, ranges),
		autoCaptions: deleteTimelineCaptionRanges(state.autoCaptions, ranges),
	};
}

/** F2 is a frame-exact cut, including single-word/Chinese captions. */
export function splitTimelineCaptions(
	cues: CaptionCue[],
	clips: ClipRegion[],
	atMs: number,
	selected?: Set<string>,
): CaptionCue[] {
	const splits = new Map<string, number>();
	for (const fragment of projectCaptionCues(cues, clips)) {
		if (selected?.size && !selected.has(fragment.id) && !selected.has(fragment.sourceCueId))
			continue;
		if (atMs <= fragment.startMs || atMs >= fragment.endMs) continue;
		const sourceTime = fragment.clip
			? getClipSourceStartMs(fragment.clip) +
				(atMs - fragment.clip.startMs) * fragment.clip.speed
			: atMs;
		splits.set(fragment.sourceCueId, sourceTime);
	}
	return cues.flatMap((cue) => {
		const time = splits.get(cue.id);
		if (time === undefined) return [cue];
		return [
			trimCaption(cue, cue.startMs, time),
			{ ...trimCaption(cue, time, cue.endMs), id: `caption-${crypto.randomUUID()}` },
		];
	});
}
