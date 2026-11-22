import { captureAppearanceHistory, restoreAppearanceHistory } from "../appearanceHistory";
import type { useAppearanceState } from "../state/useAppearanceState";
import type { AspectRatio } from "@/utils/aspectRatioUtils";
import type { Dispatch, SetStateAction } from "react";
import { emptyChapterProgress } from "../chapterProgress";
import { DEFAULT_KEYSTROKE_OVERLAY } from "../types";
import { emptyChangeLog } from "../changeLog";
import { type MutableRefObject, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
	carryMarkerUndoAcrossReload,
	createEditorHistoryStack,
	type EditorHistorySnapshot,
	getLatestMarkerEdit,
	recordEditorHistorySnapshot,
	redoEditorHistoryStack,
	resetEditorHistoryStack,
	undoEditorHistoryStack,
} from "../editorHistory";
import { deriveNextId } from "../projectPersistence";
import type { useTimelineState } from "../state/useTimelineState";
import { normalizeTimelineMarkers } from "../timeline/core/timelineMarkers";
import { cloneStructured } from "../videoEditorUtils";

type Input = {
	cropEditing?: boolean;
	projectPath: string | null;
	appearance: ReturnType<typeof useAppearanceState>;
	aspectRatio: AspectRatio;
	setAspectRatio: Dispatch<SetStateAction<AspectRatio>>;
	timeline: ReturnType<typeof useTimelineState>;
	nextZoomIdRef: MutableRefObject<number>;
	nextClipIdRef: MutableRefObject<number>;
	nextAnnotationIdRef: MutableRefObject<number>;
	nextAudioIdRef: MutableRefObject<number>;
	nextAnnotationZIndexRef: MutableRefObject<number>;
};

const MARKER_RELOAD_KEY = "leadcut.markerEditBeforeReload";

export function useEditorHistory({
	appearance, aspectRatio, setAspectRatio, cropEditing = false,
	projectPath,
	timeline,
	nextZoomIdRef,
	nextClipIdRef,
	nextAnnotationIdRef,
	nextAudioIdRef,
	nextAnnotationZIndexRef,
}: Input) {
	const {
		zoomRegions,
		clipRegions,
		speedRegions,
		annotationRegions,
		audioRegions,
		autoCaptions,
		selectedZoomId,
		selectedClipId,
		selectedAnnotationId,
		selectedAudioId,
		setZoomRegions,
		setClipRegions,
		setSpeedRegions,
		setAnnotationRegions,
		setAudioRegions,
		setAutoCaptions,
		setSelectedZoomId,
		setSelectedClipId,
		setSelectedAnnotationId,
		setSelectedAudioId,
	} = timeline;
	// biome-ignore lint/correctness/useExhaustiveDependencies: depend on every captured value, not the container recreated on each playback tick.
	const appearanceSnapshot = useMemo(() => captureAppearanceHistory(appearance), [
		appearance.wallpaper,
		appearance.shadowIntensity,
		appearance.backgroundBlur,
		appearance.zoomMotionBlur,
		appearance.zoomMotionBlurTuning,
		appearance.connectZooms,
		appearance.zoomInDurationMs,
		appearance.zoomInOverlapMs,
		appearance.zoomOutDurationMs,
		appearance.connectedZoomGapMs,
		appearance.connectedZoomDurationMs,
		appearance.zoomInEasing,
		appearance.zoomOutEasing,
		appearance.connectedZoomEasing,
		appearance.showCursor,
		appearance.loopCursor,
		appearance.cursorStyle,
		appearance.cursorSize,
		appearance.cursorSmoothing,
		appearance.cursorSpringStiffnessMultiplier,
		appearance.cursorSpringDampingMultiplier,
		appearance.cursorSpringMassMultiplier,
		appearance.cameraSpringStiffnessMultiplier,
		appearance.cameraSpringDampingMultiplier,
		appearance.cameraSpringMassMultiplier,
		appearance.zoomSmoothness,
		appearance.zoomClassicMode,
		appearance.cursorMotionBlur,
		appearance.cursorClickEffect,
		appearance.cursorClickEffectColor,
		appearance.cursorClickEffectScale,
		appearance.cursorClickEffectOpacity,
		appearance.cursorClickEffectDurationMs,
		appearance.cursorClickBounce,
		appearance.cursorClickBounceDuration,
		appearance.cursorSway,
		appearance.borderRadius,
		appearance.padding,
		appearance.cropRegion,
		appearance.webcam,
	]);
	const historyRef = useRef(createEditorHistoryStack());
	useEffect(() => {
		const rememberMarkerEdit = () => {
			try {
				const edit = projectPath ? getLatestMarkerEdit(historyRef.current) : null;
				if (edit) sessionStorage.setItem(MARKER_RELOAD_KEY, JSON.stringify({ projectPath, ...edit }));
				else sessionStorage.removeItem(MARKER_RELOAD_KEY);
			} catch {
				// Session storage can be unavailable without affecting editor history.
			}
		};
		window.addEventListener("pagehide", rememberMarkerEdit);
		return () => window.removeEventListener("pagehide", rememberMarkerEdit);
	}, [projectPath]);
	const applyingRef = useRef(false);
	const sliderGestureRef = useRef({ active: false, recorded: false });
	useEffect(() => {
		const begin = (event: PointerEvent) => {
			sliderGestureRef.current = {
				active: Boolean((event.target as HTMLElement | null)?.closest?.('[role="slider"], input[type="range"], [data-slot="slider-track"], [data-slot="slider-thumb"]')),
				recorded: false,
			};
		};
		const end = () => { sliderGestureRef.current = { active: false, recorded: false }; };
		// Keep the gesture until the next input: React may commit its last value
		// after pointerup, and that value still belongs to the same undo step.
		window.addEventListener("pointerdown", begin, true);
		window.addEventListener("keydown", end, true);
		window.addEventListener("blur", end);
		return () => {
			window.removeEventListener("pointerdown", begin, true);
			window.removeEventListener("keydown", end, true);
			window.removeEventListener("blur", end);
		};
	}, []);
	const [historyFlags, setHistoryFlags] = useState({ canUndo: false, canRedo: false });
	const syncButtons = useCallback(() => {
		const next = {
			canUndo: historyRef.current.past.length > 0,
			canRedo: historyRef.current.future.length > 0,
		};
		setHistoryFlags((current) =>
			current.canUndo === next.canUndo && current.canRedo === next.canRedo ? current : next,
		);
	}, []);
	const buildSnapshot = useCallback(
		(): EditorHistorySnapshot => ({
			appearance: appearanceSnapshot,
			aspectRatio,
			autoCaptionSettings: timeline.autoCaptionSettings,
			sourceAudioTrackSettingsByClip: timeline.sourceAudioTrackSettingsByClip,
			defaultSourceAudioTrackSettings: timeline.defaultSourceAudioTrackSettings,
			chapterProgress: timeline.chapterProgress,
			keystrokeOverlay: timeline.keystrokeOverlay,
			markers: timeline.markers,
			changeLog: timeline.changeLog,
			videoTracks: timeline.videoTracks,
			videoRegions: timeline.videoRegions,
			selectedVideoId: timeline.selectedVideoId,
			zoomRegions,
			clipRegions,
			speedRegions,
			annotationRegions,
			audioRegions,
			autoCaptions,
			selectedZoomId,
			selectedClipId,
			selectedAnnotationId,
			selectedAudioId,
		}),
		[
			appearanceSnapshot, aspectRatio, timeline.autoCaptionSettings, timeline.sourceAudioTrackSettingsByClip, timeline.defaultSourceAudioTrackSettings,
			timeline.chapterProgress,
			timeline.keystrokeOverlay,
			timeline.markers,
			timeline.changeLog,
			timeline.videoTracks,
			timeline.videoRegions,
			timeline.selectedVideoId,
			zoomRegions,
			clipRegions,
			speedRegions,
			annotationRegions,
			audioRegions,
			autoCaptions,
			selectedZoomId,
			selectedClipId,
			selectedAnnotationId,
			selectedAudioId,
		],
	);
	const applySnapshot = useCallback(
		(snapshot: EditorHistorySnapshot) => {
			applyingRef.current = true;
			const cloned = cloneStructured(snapshot);
			if (cloned.appearance) restoreAppearanceHistory(appearance, cloned.appearance);
			if (cloned.aspectRatio) setAspectRatio(cloned.aspectRatio);
			if (cloned.autoCaptionSettings) timeline.setAutoCaptionSettings(cloned.autoCaptionSettings);
			if (cloned.sourceAudioTrackSettingsByClip) timeline.setSourceAudioTrackSettingsByClip(cloned.sourceAudioTrackSettingsByClip);
			if (cloned.defaultSourceAudioTrackSettings) timeline.setDefaultSourceAudioTrackSettings(cloned.defaultSourceAudioTrackSettings);
			timeline.setChapterProgress(cloned.chapterProgress ?? emptyChapterProgress());
			timeline.setKeystrokeOverlay(cloned.keystrokeOverlay ?? DEFAULT_KEYSTROKE_OVERLAY);
			timeline.setMarkers(cloned.markers ?? []);
			timeline.setChangeLog(cloned.changeLog ?? emptyChangeLog());
			timeline.setVideoTracks(cloned.videoTracks ?? []);
			timeline.setVideoRegions(cloned.videoRegions ?? []);
			timeline.setSelectedVideoId(cloned.selectedVideoId ?? null);
			timeline.setSelectedRegionIds([]);
			setZoomRegions(cloned.zoomRegions);
			setClipRegions(cloned.clipRegions);
			setSpeedRegions(cloned.speedRegions);
			setAnnotationRegions(cloned.annotationRegions);
			setAudioRegions(cloned.audioRegions);
			setAutoCaptions(cloned.autoCaptions);
			setSelectedZoomId(cloned.selectedZoomId);
			setSelectedClipId(cloned.selectedClipId);
			setSelectedAnnotationId(cloned.selectedAnnotationId);
			setSelectedAudioId(cloned.selectedAudioId);
			nextZoomIdRef.current = deriveNextId(
				"zoom",
				cloned.zoomRegions.map(({ id }) => id),
			);
			nextClipIdRef.current = deriveNextId(
				"clip",
				cloned.clipRegions.map(({ id }) => id),
			);
			nextAnnotationIdRef.current = deriveNextId(
				"annotation",
				cloned.annotationRegions.map(({ id }) => id),
			);
			nextAudioIdRef.current = deriveNextId(
				"audio",
				cloned.audioRegions.map(({ id }) => id),
			);
			nextAnnotationZIndexRef.current =
				cloned.annotationRegions.reduce((max, region) => Math.max(max, region.zIndex), 0) +
				1;
		},
		[
			appearance, setAspectRatio, timeline.setAutoCaptionSettings, timeline.setSourceAudioTrackSettingsByClip, timeline.setDefaultSourceAudioTrackSettings,
			timeline.setChapterProgress,
			timeline.setKeystrokeOverlay,
			timeline.setMarkers,
			timeline.setChangeLog,
			timeline.setVideoTracks,
			timeline.setVideoRegions,
			timeline.setSelectedVideoId,
			timeline.setSelectedRegionIds,
			setZoomRegions,
			setClipRegions,
			setSpeedRegions,
			setAnnotationRegions,
			setAudioRegions,
			setAutoCaptions,
			setSelectedZoomId,
			setSelectedClipId,
			setSelectedAnnotationId,
			setSelectedAudioId,
			nextZoomIdRef,
			nextClipIdRef,
			nextAnnotationIdRef,
			nextAudioIdRef,
			nextAnnotationZIndexRef,
		],
	);
	const handleUndo = useCallback(() => {
		const previous = undoEditorHistoryStack(historyRef.current, buildSnapshot());
		if (previous) {
			applySnapshot(previous);
			syncButtons();
		}
	}, [applySnapshot, buildSnapshot, syncButtons]);
	const handleRedo = useCallback(() => {
		const next = redoEditorHistoryStack(historyRef.current, buildSnapshot());
		if (next) {
			applySnapshot(next);
			syncButtons();
		}
	}, [applySnapshot, buildSnapshot, syncButtons]);
	const resetHistory = useCallback(() => {
		resetEditorHistoryStack(historyRef.current);
		sliderGestureRef.current = { active: false, recorded: false };
		applyingRef.current = false;
		syncButtons();
	}, [syncButtons]);

	useEffect(() => {
		// Commit the crop dialog as one edit; cancellation restores the baseline.
		if (cropEditing) return;
		const result = recordEditorHistorySnapshot(historyRef.current, buildSnapshot(), {
			applyingHistory: applyingRef.current,
			coalesce: sliderGestureRef.current.active && sliderGestureRef.current.recorded,
		});
		if (result === "initialized" && projectPath && performance.getEntriesByType("navigation").some(
			entry => (entry as PerformanceNavigationTiming).type === "reload",
		)) {
			try {
				const stored = sessionStorage.getItem(MARKER_RELOAD_KEY);
				sessionStorage.removeItem(MARKER_RELOAD_KEY);
				const edit = stored ? JSON.parse(stored) : null;
				if (edit?.projectPath === projectPath && Array.isArray(edit.before) && Array.isArray(edit.after)) {
					carryMarkerUndoAcrossReload(historyRef.current, {
						before: normalizeTimelineMarkers(edit.before),
						after: normalizeTimelineMarkers(edit.after),
					});
				}
			} catch {
				// A missing or malformed checkpoint starts a fresh undo stack.
			}
		}
		if (result === "recorded" && sliderGestureRef.current.active) sliderGestureRef.current.recorded = true;
		if (result === "applied") applyingRef.current = false;
		if (result !== "unchanged") syncButtons();
	}, [buildSnapshot, syncButtons, cropEditing, projectPath]);

	return {
		...historyFlags,
		handleUndo,
		handleRedo,
		resetHistory,
	};
}
