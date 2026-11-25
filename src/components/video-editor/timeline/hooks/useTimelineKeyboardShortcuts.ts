import { type RefObject, useCallback } from "react";
import { resolveDeleteSelectionTarget } from "./utils/timelineSelectionUtils";

interface UseTimelineKeyboardShortcutsParams {
	isTimelineFocusedRef: RefObject<boolean | null>;
	hasAnyZoomBlocks: boolean;
	activateSelectAllZooms: () => void;
	annotationCount: number;
	selectedKeyframeId: string | null;
	selectedZoomId: string | null;
	selectedClipId?: string | null;
	selectedAnnotationId?: string | null;
	selectedAudioId?: string | null;
	selectedCaptionId?: string | null;
	selectAllBlocksActive: boolean;
	deleteSelectedKeyframe: () => void;
	deleteSelectedZoom: () => void;
	deleteSelectedClip: () => void;
	deleteSelectedAnnotation: () => void;
	deleteSelectedAudio: () => void;
	deleteSelectedCaption: () => void;
	cycleAnnotationsAtCurrentTime: (backward?: boolean) => boolean;
}

export function useTimelineKeyboardShortcuts({
	isTimelineFocusedRef,
	hasAnyZoomBlocks,
	activateSelectAllZooms,
	annotationCount,
	selectedKeyframeId,
	selectedZoomId,
	selectedClipId,
	selectedAnnotationId,
	selectedAudioId,
	selectedCaptionId,
	selectAllBlocksActive,
	deleteSelectedKeyframe,
	deleteSelectedZoom,
	deleteSelectedClip,
	deleteSelectedAnnotation,
	deleteSelectedAudio,
	deleteSelectedCaption,
	cycleAnnotationsAtCurrentTime,
}: UseTimelineKeyboardShortcutsParams) {
	const deleteSelected = useCallback(() => {
		const target = resolveDeleteSelectionTarget({
			selectAllBlocksActive,
			selectedKeyframeId,
			selectedZoomId,
			selectedClipId,
			selectedAnnotationId,
			selectedAudioId,
			selectedCaptionId,
		});
		if (target === "none") return false;
		const remove = {
			keyframe: deleteSelectedKeyframe,
			zoom: deleteSelectedZoom,
			clip: deleteSelectedClip,
			annotation: deleteSelectedAnnotation,
			audio: deleteSelectedAudio,
			caption: deleteSelectedCaption,
		};
		remove[target]();
		return true;
	}, [
		selectAllBlocksActive,
		selectedKeyframeId, selectedZoomId, selectedClipId, selectedAnnotationId, selectedAudioId, selectedCaptionId,
		deleteSelectedKeyframe, deleteSelectedZoom, deleteSelectedClip, deleteSelectedAnnotation, deleteSelectedAudio, deleteSelectedCaption,
	]);
	const selectAllZooms = useCallback(() => {
		if (!isTimelineFocusedRef.current || !hasAnyZoomBlocks) return false;
		activateSelectAllZooms();
		return true;
	}, [activateSelectAllZooms, hasAnyZoomBlocks, isTimelineFocusedRef]);
	const cycleAnnotations = useCallback((backward: boolean) =>
		Boolean(isTimelineFocusedRef.current && annotationCount > 0 && cycleAnnotationsAtCurrentTime(backward)),
	[annotationCount, cycleAnnotationsAtCurrentTime, isTimelineFocusedRef]);
	return { deleteSelected, selectAllZooms, cycleAnnotations };
}
