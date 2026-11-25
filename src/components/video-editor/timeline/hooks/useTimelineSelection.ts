import { useCallback, useMemo, useState, type Dispatch, type SetStateAction } from "react";
import { mapTimelineTimeToSourceTime, type ClipRegion, type TimelineMarker } from "../../types";
import { projectTimelineMarkers } from "../core/timelineMarkers";
import type { TimelineRegion } from "../core/timelineTypes";

interface UseTimelineSelectionParams {
	totalMs: number;
	getCurrentTimeMs: () => number;
	zoomRegions: TimelineRegion[];
	clipRegions: ClipRegion[];
	markers: TimelineMarker[];
	onMarkersChange?: Dispatch<SetStateAction<TimelineMarker[]>>;
	annotationRegions: (TimelineRegion & { zIndex: number })[];
	audioRegions: TimelineRegion[];
	selectedZoomId: string | null;
	selectedClipId?: string | null;
	selectedAnnotationId?: string | null;
	selectedAudioId?: string | null;
	selectedCaptionId?: string | null;
	onZoomDelete: (id: string) => void;
	onClipDelete?: (id: string) => void;
	onAnnotationDelete?: (id: string) => void;
	onAudioDelete?: (id: string) => void;
	onCaptionDelete?: (id: string) => void;
	onSelectZoom: (id: string | null) => void;
	onSelectClip?: (id: string | null) => void;
	onSelectAnnotation?: (id: string | null) => void;
	onSelectAudio?: (id: string | null) => void;
	onSelectCaption?: (id: string | null) => void;
}

export function useTimelineSelection({
	totalMs,
	getCurrentTimeMs,
	zoomRegions,
	clipRegions,
	markers,
	onMarkersChange,
	annotationRegions,
	selectedZoomId,
	selectedClipId,
	selectedAnnotationId,
	selectedAudioId,
	selectedCaptionId,
	onZoomDelete,
	onClipDelete,
	onAnnotationDelete,
	onAudioDelete,
	onCaptionDelete,
	onSelectZoom,
	onSelectClip,
	onSelectAnnotation,
	onSelectAudio,
	onSelectCaption,
}: UseTimelineSelectionParams) {
	const keyframes = useMemo(() => projectTimelineMarkers(markers, clipRegions), [markers, clipRegions]);
	const [markerSelection, setSelectedKeyframeId] = useState<string | null>(null);
	const selectedKeyframeId = keyframes.some(({ id }) => id === markerSelection) ? markerSelection : null;
	const [selectAllBlocksActive, setSelectAllBlocksActive] = useState(false);
	const hasAnyZoomBlocks = useMemo(() => zoomRegions.length > 0, [zoomRegions.length]);

	const addKeyframe = useCallback(() => {
		if (!onMarkersChange || totalMs === 0) return;
		const time = Math.max(0, Math.min(getCurrentTimeMs(), totalMs));
		if (keyframes.some((kf) => Math.abs(kf.time - time) < 1)) return;
		const sourceTimeMs = mapTimelineTimeToSourceTime(time, clipRegions);
		const marker: TimelineMarker = { id: globalThis.crypto.randomUUID(), sourceTimeMs, origin: "editor" };
		onMarkersChange((previous) => previous.some((item) => item.sourceTimeMs === sourceTimeMs) ? previous : [...previous, marker]);
	}, [clipRegions, getCurrentTimeMs, totalMs, keyframes, onMarkersChange]);

	const deleteSelectedKeyframe = useCallback(() => {
		if (!onMarkersChange || !selectedKeyframeId) return;
		onMarkersChange((previous) => previous.filter((marker) => marker.id !== selectedKeyframeId));
		setSelectedKeyframeId(null);
	}, [onMarkersChange, selectedKeyframeId]);

	const updateMarker = useCallback((id: string, patch: Partial<Pick<TimelineMarker, "note" | "color" | "sourceTimeMs">>) => {
		onMarkersChange?.((previous) => {
			const index = previous.findIndex((item) => item.id === id);
			if (index === -1) return previous;
			const marker = previous[index];
			if (Object.entries(patch).every(([key, value]) => marker[key as keyof TimelineMarker] === value)) return previous;
			const next = previous.slice();
			next[index] = { ...marker, ...patch };
			return next;
		});
	}, [onMarkersChange]);

	const handleKeyframeMove = useCallback(
		(id: string, newTime: number) => {
			const time = Math.max(0, Math.min(newTime, totalMs));
			updateMarker(id, { sourceTimeMs: mapTimelineTimeToSourceTime(time, clipRegions) });
		},
		[clipRegions, totalMs, updateMarker],
	);

	const deleteSelectedZoom = useCallback(() => {
		if (selectAllBlocksActive) {
			zoomRegions.map((region) => region.id).forEach((id) => onZoomDelete(id));
		} else if (selectedZoomId) {
			onZoomDelete(selectedZoomId);
		} else {
			return;
		}

		onSelectZoom(null);
		onSelectClip?.(null);
		onSelectAnnotation?.(null);
		onSelectAudio?.(null);
		onSelectCaption?.(null);
		setSelectAllBlocksActive(false);
	}, [
		selectAllBlocksActive,
		zoomRegions,
		onZoomDelete,
		selectedZoomId,
		onSelectZoom,
		onSelectClip,
		onSelectAnnotation,
		onSelectAudio,
		onSelectCaption,
	]);

	const deleteSelectedClip = useCallback(() => {
		if (!selectedClipId || !onClipDelete) return;
		onClipDelete(selectedClipId);
		onSelectClip?.(null);
	}, [selectedClipId, onClipDelete, onSelectClip]);

	const deleteSelectedAnnotation = useCallback(() => {
		if (!selectedAnnotationId || !onAnnotationDelete) return;
		onAnnotationDelete(selectedAnnotationId);
		onSelectAnnotation?.(null);
	}, [selectedAnnotationId, onAnnotationDelete, onSelectAnnotation]);

	const deleteSelectedAudio = useCallback(() => {
		if (!selectedAudioId || !onAudioDelete) return;
		onAudioDelete(selectedAudioId);
		onSelectAudio?.(null);
	}, [selectedAudioId, onAudioDelete, onSelectAudio]);

	const deleteSelectedCaption = useCallback(() => {
		if (!selectedCaptionId || !onCaptionDelete) return;
		onCaptionDelete(selectedCaptionId);
		onSelectCaption?.(null);
	}, [selectedCaptionId, onCaptionDelete, onSelectCaption]);

	const clearSelectedBlocks = useCallback(() => {
		setSelectedKeyframeId(null);
		onSelectZoom(null);
		onSelectClip?.(null);
		onSelectAnnotation?.(null);
		onSelectAudio?.(null);
		onSelectCaption?.(null);
		setSelectAllBlocksActive(false);
	}, [onSelectZoom, onSelectClip, onSelectAnnotation, onSelectAudio, onSelectCaption]);

	const activateSelectAllZooms = useCallback(() => {
		onSelectZoom(null);
		onSelectClip?.(null);
		onSelectAnnotation?.(null);
		onSelectAudio?.(null);
		onSelectCaption?.(null);
		setSelectedKeyframeId(null);
		setSelectAllBlocksActive(true);
	}, [onSelectZoom, onSelectClip, onSelectAnnotation, onSelectAudio, onSelectCaption]);

	const handleSelectZoom = useCallback(
		(id: string | null) => {
			setSelectAllBlocksActive(false);
			setSelectedKeyframeId(null);
			onSelectZoom(id);
		},
		[onSelectZoom],
	);

	const handleSelectClip = useCallback(
		(id: string | null) => {
			setSelectAllBlocksActive(false);
			setSelectedKeyframeId(null);
			onSelectClip?.(id);
		},
		[onSelectClip],
	);

	const handleSelectAnnotation = useCallback(
		(id: string | null) => {
			setSelectAllBlocksActive(false);
			setSelectedKeyframeId(null);
			onSelectAnnotation?.(id);
		},
		[onSelectAnnotation],
	);

	const handleSelectAudio = useCallback(
		(id: string | null) => {
			setSelectAllBlocksActive(false);
			setSelectedKeyframeId(null);
			onSelectAudio?.(id);
		},
		[onSelectAudio],
	);

	const handleSelectCaption = useCallback(
		(id: string | null) => {
			setSelectAllBlocksActive(false);
			setSelectedKeyframeId(null);
			onSelectCaption?.(id);
		},
		[onSelectCaption],
	);

	const cycleAnnotationsAtCurrentTime = useCallback(
		(backward = false) => {
			const currentTimeMs = getCurrentTimeMs();
			const overlapping = annotationRegions
				.filter((a) => currentTimeMs >= a.startMs && currentTimeMs <= a.endMs)
				.sort((a, b) => a.zIndex - b.zIndex);
			if (overlapping.length === 0) {
				return false;
			}

			if (!selectedAnnotationId || !overlapping.some((a) => a.id === selectedAnnotationId)) {
				onSelectAnnotation?.(overlapping[0].id);
				return true;
			}

			const currentIndex = overlapping.findIndex((a) => a.id === selectedAnnotationId);
			const nextIndex = backward
				? (currentIndex - 1 + overlapping.length) % overlapping.length
				: (currentIndex + 1) % overlapping.length;
			onSelectAnnotation?.(overlapping[nextIndex].id);
			return true;
		},
		[annotationRegions, getCurrentTimeMs, selectedAnnotationId, onSelectAnnotation],
	);

	return {
		keyframes,
		selectedKeyframeId,
		setSelectedKeyframeId,
		selectAllBlocksActive,
		setSelectAllBlocksActive,
		hasAnyZoomBlocks,
		activateSelectAllZooms,
		addKeyframe,
		deleteSelectedKeyframe,
		handleKeyframeMove,
		updateMarker,
		deleteSelectedZoom,
		deleteSelectedClip,
		deleteSelectedAnnotation,
		deleteSelectedAudio,
		deleteSelectedCaption,
		clearSelectedBlocks,
		handleSelectZoom,
		handleSelectClip,
		handleSelectAnnotation,
		handleSelectAudio,
		handleSelectCaption,
		cycleAnnotationsAtCurrentTime,
	};
}
