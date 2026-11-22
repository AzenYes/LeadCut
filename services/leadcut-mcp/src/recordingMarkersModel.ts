export type RecordingMarkerKind = "cut" | "highlight";

export interface RecordingMarker {
	id: string;
	timeMs: number;
	kind: RecordingMarkerKind;
	note?: string;
}

export function isRecordingMarkerKind(value: unknown): value is RecordingMarkerKind {
	return value === "cut" || value === "highlight";
}

function isRecordingMarker(value: unknown): value is RecordingMarker {
	if (typeof value !== "object" || !value) return false;
	const marker = value as Partial<RecordingMarker>;
	return typeof marker.id === "string" && marker.id.length > 0 &&
		typeof marker.timeMs === "number" && Number.isFinite(marker.timeMs) && marker.timeMs >= 0 &&
		isRecordingMarkerKind(marker.kind) && (marker.note === undefined || typeof marker.note === "string");
}

export function normalizeRecordingMarkers(value: unknown): RecordingMarker[] {
	if (!value || typeof value !== "object") return [];
	const { version, markers } = value as { version?: unknown; markers?: unknown };
	return version === 1 && Array.isArray(markers) ? markers.filter(isRecordingMarker) : [];
}
