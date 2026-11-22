import type { RecordingMarker } from "../../../../../electron/ipc/types";
import {
	type ClipRegion,
	getClipSourceEndMs,
	getClipSourceStartMs,
	mapSourceTimeToTimelineTime,
} from "../../types";

export type ProjectedRecordingMarker = RecordingMarker & {
	timelineTimeMs: number;
	clipId?: string;
};

export function mapMarkersToTimeline(
	markers: readonly RecordingMarker[],
	clips: readonly ClipRegion[],
): ProjectedRecordingMarker[] {
	if (clips.length === 0) return markers.map((marker) => ({ ...marker, timelineTimeMs: marker.timeMs }));

	const ranges = clips.map((clip) => ({
		clip,
		startMs: getClipSourceStartMs(clip),
		endMs: getClipSourceEndMs(clip),
	}));
	const projected: ProjectedRecordingMarker[] = [];
	for (const marker of markers) {
		for (const { clip, startMs, endMs } of ranges) {
			if (marker.timeMs < startMs || marker.timeMs >= endMs) continue;
			projected.push({
				...marker,
				clipId: clip.id,
				timelineTimeMs: mapSourceTimeToTimelineTime(marker.timeMs, [clip]),
			});
		}
	}
	return projected.sort((left, right) => left.timelineTimeMs - right.timelineTimeMs);
}
