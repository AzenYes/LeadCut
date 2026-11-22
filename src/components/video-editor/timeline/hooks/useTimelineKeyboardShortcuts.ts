import { type RefObject, useCallback, useEffect } from "react";
import { matchesShortcut } from "@/lib/shortcuts";
import { isEditorShortcutBlocked, isShortcutEditingTarget } from "../../editorShortcutScope";
import { resolveDeleteSelectionTarget } from "./utils/timelineSelectionUtils";

interface UseTimelineKeyboardShortcutsParams {
	isMac: boolean;
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
	isMac,
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
	useEffect(() => {
		const handleKeyDown = (e: KeyboardEvent) => {
			if (e.defaultPrevented || e.isComposing || isEditorShortcutBlocked(e.target) || isShortcutEditingTarget(e.target)) return;

			// Selection survives inspector focus; deletion follows the selected block.
			if (
				(e.key === "Delete" || e.key === "Backspace") &&
					!e.ctrlKey &&
					!e.metaKey &&
					!e.altKey &&
					!e.shiftKey
			) {
				if (deleteSelected()) e.preventDefault();
				return;
			}

			if (!isTimelineFocusedRef.current) {
				return;
			}

			if (matchesShortcut(e, { key: "a", ctrl: true }, isMac)) {
				if (!hasAnyZoomBlocks) {
					return;
				}
				e.preventDefault();
				activateSelectAllZooms();
				return;
			}

			if (e.key === "Tab" && annotationCount > 0) {
				if (cycleAnnotationsAtCurrentTime(e.shiftKey)) {
					e.preventDefault();
				}
			}
		};

		window.addEventListener("keydown", handleKeyDown);
		return () => window.removeEventListener("keydown", handleKeyDown);
	}, [
		activateSelectAllZooms,
		annotationCount,
		cycleAnnotationsAtCurrentTime,
		deleteSelected,
		hasAnyZoomBlocks,
		isMac,
		isTimelineFocusedRef,
	]);
	return deleteSelected;
}
