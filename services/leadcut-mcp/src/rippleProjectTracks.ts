import { randomUUID } from "node:crypto";
import { deleteTimelineRanges, type EditRange } from "./timelineRanges.js";

type MediaRegion = EditRange & {
	id: string;
	sourceStartMs?: number;
	speed?: number;
};

type VideoRegion = MediaRegion & { trackId: string };
type AudioRegion = MediaRegion & { trackIndex?: number };
type VideoTrack = { id: string; name?: string; locked?: boolean };

export type TrackEditSummary = {
	track: "primary" | "video" | "audio";
	trackId?: string;
	name?: string;
	locked?: boolean;
	before: number;
	after: number;
	removedMs: number;
};

export function summarizeTrackEdit(
	track: TrackEditSummary["track"],
	before: readonly EditRange[],
	after: readonly EditRange[],
): TrackEditSummary {
	const duration = (ranges: readonly EditRange[]) =>
		ranges.reduce((sum, range) => sum + range.endMs - range.startMs, 0);
	return {
		track,
		before: before.length,
		after: after.length,
		removedMs: Math.max(0, Math.round(duration(before) - duration(after))),
	};
}

function rippleMediaRegion<T extends MediaRegion>(region: T, cuts: readonly EditRange[]): T[] {
	const pieces = deleteTimelineRanges([region], cuts, (original, startMs) => ({
		...original,
		sourceStartMs: Math.round((original.sourceStartMs ?? 0) + (startMs - original.startMs) * (original.speed ?? 1)),
	}), () => randomUUID());
	return pieces.map(piece => piece === region ? piece : {
		...piece,
		startMs: Math.round(piece.startMs),
		endMs: Math.round(piece.endMs),
	}).filter(piece => piece.endMs > piece.startMs);
}

export function rippleProjectTracks(editor: Record<string, unknown>, cuts: readonly EditRange[]) {
	const updates: Record<string, unknown> = {};
	const summaries: TrackEditSummary[] = [];
	const knownVideoTracks = Array.isArray(editor.videoTracks) ? editor.videoTracks as VideoTrack[] : [];
	const video = Array.isArray(editor.videoRegions) ? editor.videoRegions as VideoRegion[] : [];
	const trackIds = new Set([...knownVideoTracks.map(track => track.id), ...video.map(region => region.trackId)]);
	const lockedIds = new Set(knownVideoTracks.filter(track => track.locked).map(track => track.id));
	const nextVideo = video.flatMap(region => lockedIds.has(region.trackId) ? [region] : rippleMediaRegion(region, cuts));
	if (Array.isArray(editor.videoRegions)) updates.videoRegions = nextVideo;
	for (const trackId of trackIds) {
		const track = knownVideoTracks.find(item => item.id === trackId);
		summaries.push({
			...summarizeTrackEdit("video", video.filter(region => region.trackId === trackId), nextVideo.filter(region => region.trackId === trackId)),
			trackId,
			name: track?.name,
			locked: lockedIds.has(trackId),
		});
	}
	if (Array.isArray(editor.audioRegions)) {
		const audio = editor.audioRegions as AudioRegion[];
		const nextAudio = audio.flatMap(region => rippleMediaRegion(region, cuts));
		updates.audioRegions = nextAudio;
		const index = (region: AudioRegion) => region.trackIndex ?? 0;
		for (const trackIndex of new Set(audio.map(index))) {
			summaries.push({
				...summarizeTrackEdit("audio", audio.filter(region => index(region) === trackIndex), nextAudio.filter(region => index(region) === trackIndex)),
				trackId: String(trackIndex),
			});
		}
	}
	return { updates, summaries, lockedTracks: summaries.filter(track => track.locked) };
}
