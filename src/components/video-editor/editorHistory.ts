import type { AppearanceHistorySnapshot } from "./appearanceHistory";
import type { AspectRatio } from "@/utils/aspectRatioUtils";
import type {
	AnnotationRegion,
	AudioRegion,
	CaptionCue,
	ClipRegion,
	SpeedRegion,
	TimelineMarker,
	ZoomRegion,
} from "./types";
import type { VideoRegion, VideoTrack } from "./videoTracks";

export type EditorHistorySnapshot = {
	appearance?: AppearanceHistorySnapshot;
	aspectRatio?: AspectRatio;
	autoCaptionSettings?: import("./types").AutoCaptionSettings;
	transcript?: import("./transcript").ProjectTranscript | null;
	sourceAudioTrackSettingsByClip?: Record<string, import("./types").SourceAudioTrackSettings>;
	defaultSourceAudioTrackSettings?: import("./types").SourceAudioTrackSettings;
	chapterProgress?: import("./chapterProgress").ChapterProgress;
	keystrokeOverlay?: import("./types").KeystrokeOverlaySettings;
	markers?: TimelineMarker[];
	changeLog?: import("./changeLog").ChangeLog;
	videoTracks?: VideoTrack[];
	videoRegions?: VideoRegion[];
	selectedVideoId?: string | null;
	zoomRegions: ZoomRegion[];
	clipRegions: ClipRegion[];
	speedRegions: SpeedRegion[];
	annotationRegions: AnnotationRegion[];
	audioRegions: AudioRegion[];
	autoCaptions: CaptionCue[];
	selectedZoomId: string | null;
	selectedClipId: string | null;
	selectedAnnotationId: string | null;
	selectedAudioId: string | null;
};

export type EditorHistoryStack = {
	past: EditorHistorySnapshot[];
	current: EditorHistorySnapshot | null;
	future: EditorHistorySnapshot[];
};

export type EditorHistoryRecordResult = "initialized" | "applied" | "recorded" | "unchanged";

export const MAX_EDITOR_HISTORY_ENTRIES = 100;

export function createEditorHistoryStack(): EditorHistoryStack {
	return {
		past: [],
		current: null,
		future: [],
	};
}

export function resetEditorHistoryStack(stack: EditorHistoryStack): void {
	stack.past = [];
	stack.current = null;
	stack.future = [];
}

export function cloneEditorHistorySnapshot(snapshot: EditorHistorySnapshot): EditorHistorySnapshot {
	return globalThis.structuredClone(snapshot);
}

function isComparableObject(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}

function areDeepEqual(left: unknown, right: unknown): boolean {
	if (Object.is(left, right)) {
		return true;
	}

	if (Array.isArray(left) || Array.isArray(right)) {
		if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) {
			return false;
		}

		return left.every((value, index) => areDeepEqual(value, right[index]));
	}

	if (!isComparableObject(left) || !isComparableObject(right)) {
		return false;
	}

	const leftKeys = Object.keys(left);
	const rightKeys = Object.keys(right);
	if (leftKeys.length !== rightKeys.length) {
		return false;
	}

	return leftKeys.every((key) => key in right && areDeepEqual(left[key], right[key]));
}

export function areEditorHistorySnapshotsEqual(
	left: EditorHistorySnapshot,
	right: EditorHistorySnapshot,
): boolean {
	return areDeepEqual(left, right);
}

function withoutSelection(value: EditorHistorySnapshot) {
	return {
		...value, selectedZoomId: null, selectedClipId: null, selectedAnnotationId: null,
		selectedAudioId: null, selectedVideoId: null,
		// Track discovery populates implicit unity gains; it isn't a user edit.
		defaultSourceAudioTrackSettings: Object.fromEntries(Object.entries(value.defaultSourceAudioTrackSettings ?? {})
			.filter(([, setting]) => setting.volume !== 1 || setting.normalize)),
	};
}

export function getLatestMarkerEdit(stack: EditorHistoryStack) {
	const current = stack.current;
	const previous = stack.past[stack.past.length - 1];
	if (!current || !previous || areDeepEqual(current.markers, previous.markers)) return null;
	const { markers: before, ...previousEditor } = withoutSelection(previous);
	const { markers: after, ...currentEditor } = withoutSelection(current);
	return areDeepEqual(previousEditor, currentEditor) ? { before: before ?? [], after: after ?? [] } : null;
}

export function carryMarkerUndoAcrossReload(stack: EditorHistoryStack, edit: { before: TimelineMarker[]; after: TimelineMarker[] }) {
	const current = stack.current;
	if (!current || !areDeepEqual(current.markers, edit.after)) return;
	stack.past.push({ ...current, markers: edit.before });
}

export function recordEditorHistorySnapshot(
	stack: EditorHistoryStack,
	snapshot: EditorHistorySnapshot,
	options: {
		applyingHistory?: boolean;
		maxEntries?: number;
		coalesce?: boolean;
	} = {},
): EditorHistoryRecordResult {
	// Snapshot fields come from immutable React state. Each edit replaces the affected fields.
	if (!stack.current) {
		stack.current = snapshot;
		return "initialized";
	}

	if (options.applyingHistory) {
		stack.current = snapshot;
		return "applied";
	}

	if (areEditorHistorySnapshotsEqual(withoutSelection(stack.current), withoutSelection(snapshot))) {
		stack.current = snapshot;
		return "unchanged";
	}

	if (!options.coalesce) stack.past.push(stack.current);
	const maxEntries = options.maxEntries ?? MAX_EDITOR_HISTORY_ENTRIES;
	if (stack.past.length > maxEntries) {
		stack.past.shift();
	}

	stack.current = snapshot;
	stack.future = [];
	return "recorded";
}

export function undoEditorHistoryStack(
	stack: EditorHistoryStack,
	fallbackCurrent: EditorHistorySnapshot,
): EditorHistorySnapshot | null {
	if (stack.past.length === 0) {
		return null;
	}

	const current = stack.current ?? fallbackCurrent;
	const previous = stack.past.pop();
	if (!previous) {
		return null;
	}

	stack.future.push(current);
	stack.current = previous;
	return cloneEditorHistorySnapshot(previous);
}

export function redoEditorHistoryStack(
	stack: EditorHistoryStack,
	fallbackCurrent: EditorHistorySnapshot,
): EditorHistorySnapshot | null {
	if (stack.future.length === 0) {
		return null;
	}

	const current = stack.current ?? fallbackCurrent;
	const next = stack.future.pop();
	if (!next) {
		return null;
	}

	stack.past.push(current);
	stack.current = next;
	return cloneEditorHistorySnapshot(next);
}
