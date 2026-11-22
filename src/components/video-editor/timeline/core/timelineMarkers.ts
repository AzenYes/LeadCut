import {
	MARKER_COLORS,
	mapSourceTimeToTimelineTime,
	type ClipRegion,
	type TimelineMarker,
} from "../../types";

export type ProjectedTimelineMarker = TimelineMarker & { time: number };

export function normalizeTimelineMarkers(value: unknown): TimelineMarker[] {
	if (!Array.isArray(value)) return [];
	const unique = new Map<string, TimelineMarker>();
	for (const entry of value) {
		if (!entry || typeof entry !== "object") continue;
		const { id, sourceTimeMs, note, color, origin } = entry as Partial<TimelineMarker>;
		if (
			typeof id !== "string" || !id.length || unique.has(id) ||
			typeof sourceTimeMs !== "number" || !Number.isFinite(sourceTimeMs) || sourceTimeMs < 0 ||
			(origin !== "editor" && origin !== "recording")
		) continue;
		const marker: TimelineMarker = { id, sourceTimeMs, origin };
		if (typeof note === "string") marker.note = note;
		if (color && MARKER_COLORS.includes(color)) marker.color = color;
		unique.set(id, marker);
	}
	return [...unique.values()];
}

export function projectTimelineMarkers(markers: TimelineMarker[], clips: ClipRegion[]): ProjectedTimelineMarker[] {
	return markers
		.map((marker) => ({ ...marker, time: mapSourceTimeToTimelineTime(marker.sourceTimeMs, clips) }))
		.sort((left, right) => left.time - right.time);
}
