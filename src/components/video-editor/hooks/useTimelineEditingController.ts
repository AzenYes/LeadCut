import { useUiText } from "@/i18n/useUiText";
import { loadAppSetting } from "@/lib/appSettings";
import { REVIEW_RATE_SETTING_KEY } from "@/lib/storageKeys";
import { REPEATING_SHORTCUT_ACTIONS } from "@/lib/shortcuts";
import type { Dispatch, MutableRefObject, RefObject, SetStateAction } from "react";
import { useCallback, useState, useMemo } from "react";
import { getVideoRegionAudio } from "../videoTracks";
import { toast } from "@/components/ui/toast";
import type { useI18n } from "@/contexts/I18nContext";
import type { useShortcuts } from "@/contexts/ShortcutsContext";
import { useVideoEditorAudio } from "../audio/useVideoEditorAudio";
import type { useAppearanceState } from "../state/useAppearanceState";
import type { useTimelineState } from "../state/useTimelineState";
import type { TimelineEditorHandle } from "../timeline/TimelineEditor";
import type { EditorEffectSection } from "../types";
import type { VideoPlaybackRef } from "../VideoPlayback";
import { REVIEW_RATES, type ReviewRate } from "../videoPlayback/playbackStepping";
import type { PlaybackClock } from "../videoPlayback/playbackClock";
import { getErrorMessage, summarizeErrorMessage } from "../videoEditorUtils";
import { useAnnotationRegionCommands } from "./useAnnotationRegionCommands";
import { useAudioRegionCommands } from "./useAudioRegionCommands";
import { useCaptionCommands } from "./useCaptionCommands";
import { useChangeReview } from "./useChangeReview";
import { useClipRegionCommands } from "./useClipRegionCommands";
import { useVideoTrackCommands } from "./useVideoTrackCommands";
import { useSequenceTools } from "./useSequenceTools";
import { useCursorTelemetry } from "./useCursorTelemetry";
import { useEditorGlobalInteractions } from "./useEditorGlobalInteractions";
import { useEditorShortcuts } from "./useEditorShortcuts";
import { useEditorPlaybackControls } from "./useEditorPlaybackControls";
import { useFreshRecordingAutoZoom } from "./useFreshRecordingAutoZoom";
import { useTimelineProjection } from "./useTimelineProjection";
import { useZoomRegionCommands } from "./useZoomRegionCommands";

type Input = {
	t: ReturnType<typeof useI18n>["t"];
	shortcuts: ReturnType<typeof useShortcuts>["shortcuts"];
	isMac: boolean;
	appPlatform: string;
	timeline: ReturnType<typeof useTimelineState>;
	appearance: ReturnType<typeof useAppearanceState>;
	videoPath: string | null;
	videoSourcePath: string | null;
	currentSourcePath: string | null;
	duration: number;
	frameRate: number;
	playbackClock: PlaybackClock;
	isPlaying: boolean;
	previewVolume: number;
	loading: boolean;
	isPreviewReady: boolean;
	activeEffectSection: EditorEffectSection;
	setActiveEffectSection: Dispatch<SetStateAction<EditorEffectSection>>;
	setAutoSuggestZoomsTrigger: Dispatch<SetStateAction<number>>;
	videoPlaybackRef: RefObject<VideoPlaybackRef | null>;
	timelineRef: RefObject<TimelineEditorHandle | null>;
	nextZoomIdRef: MutableRefObject<number>;
	nextClipIdRef: MutableRefObject<number>;
	nextAudioIdRef: MutableRefObject<number>;
	nextAnnotationIdRef: MutableRefObject<number>;
	nextAnnotationZIndexRef: MutableRefObject<number>;
	clipInitializedRef: MutableRefObject<boolean>;
	autoFullTrackClipIdRef: MutableRefObject<string | null>;
	autoFullTrackClipEndMsRef: MutableRefObject<number | null>;
	autoSuggestedVideoPathRef: MutableRefObject<string | null>;
	pendingFreshRecordingAutoZoomPathRef: MutableRefObject<string | null>;
	pendingFreshRecordingAutoSuggestTimeoutRef: MutableRefObject<number | null>;
	pendingFreshRecordingAutoSuggestTelemetryCountRef: MutableRefObject<number>;
	handleUndo: () => void;
	handleRedo: () => void;
};

export function useTimelineEditingController(input: Input) {
	const [reviewRate, setReviewRateState] = useState<ReviewRate>(() => {
		const saved = loadAppSetting<number>(REVIEW_RATE_SETTING_KEY);
		return REVIEW_RATES.find(rate => rate === saved) ?? 1;
	});
	const [shuttleMultiplier, setShuttleMultiplier] = useState(1);
	const previewPlaybackRate = reviewRate * shuttleMultiplier;
	const uiText = useUiText();
	const { timeline, playbackClock } = input;
	const videoCommands = useVideoTrackCommands({ timeline, appearance: input.appearance, sourceDuration: input.duration, getCurrentTime: playbackClock.getTime });
	const handleSourceFallbackLoadError = useCallback((error: unknown) => {
		toast.warning(
			uiText("couldNotLoadCompanionAudioSourceValue", { value0: summarizeErrorMessage(getErrorMessage(error)) }),
			{ duration: 10000 },
		);
	}, [uiText]);
	const cursor = useCursorTelemetry({
		videoPath: input.videoPath,
		videoSourcePath: input.videoSourcePath,
		duration: input.duration,
		loopCursor: input.appearance.loopCursor,
		timeline,
		pendingFreshRecordingAutoZoomPathRef: input.pendingFreshRecordingAutoZoomPathRef,
		autoSuggestedVideoPathRef: input.autoSuggestedVideoPathRef,
	});
	const projection = useTimelineProjection({
		timeline,
		duration: input.duration,
		nextClipIdRef: input.nextClipIdRef,
		initializedRef: input.clipInitializedRef,
		autoFullTrackIdRef: input.autoFullTrackClipIdRef,
		autoFullTrackEndRef: input.autoFullTrackClipEndMsRef,
	});
	const audio = useVideoEditorAudio({
		currentSourcePath: input.currentSourcePath,
		selectedClipId: timeline.selectedClipId,
		clipRegions: timeline.clipRegions,
		audioRegions: useMemo(() => [...timeline.audioRegions, ...getVideoRegionAudio(timeline.videoRegions, timeline.videoTracks)], [timeline.audioRegions, timeline.videoRegions, timeline.videoTracks]),
		sourceAudioTrackSettingsByClip: timeline.sourceAudioTrackSettingsByClip,
		setSourceAudioTrackSettingsByClip: timeline.setSourceAudioTrackSettingsByClip,
		defaultSourceAudioTrackSettings: timeline.defaultSourceAudioTrackSettings,
		setDefaultSourceAudioTrackSettings: timeline.setDefaultSourceAudioTrackSettings,
		playbackClock,
		mapTimelineTimeToSourceTime: projection.mapTimelineTimeToSourceTime,
		duration: input.duration,
		isPlaying: input.isPlaying,
		previewPlaybackRate,
		previewVolume: input.previewVolume,
		sourceAudioFallbackRefreshKey: timeline.sourceAudioFallbackRefreshKey,
		summarizeErrorMessage,
		onSourceFallbackLoadError: handleSourceFallbackLoadError,
	});
	const playback = useEditorPlaybackControls({
		videoPlaybackRef: input.videoPlaybackRef,
		timelineRef: input.timelineRef,
		playSourceAudioPreview: audio.playSourceAudioPreview,
		getCurrentTime: playbackClock.getTime,
		timelineDuration: projection.timelineDuration,
		previewPlaybackRate,
		reviewRate,
		setReviewRateState,
		setShuttleMultiplier,
		frameRate: input.frameRate,
		videoPath: input.videoPath,
		clipRegions: timeline.clipRegions,
	});
	const captionCommands = useCaptionCommands({
		clipRegions: timeline.clipRegions,
		autoCaptions: timeline.autoCaptions,
		setAutoCaptions: timeline.setAutoCaptions,
		setAutoCaptionSettings: timeline.setAutoCaptionSettings,
		setSelectedCaptionId: timeline.setSelectedCaptionId,
		setSelectedZoomId: timeline.setSelectedZoomId,
		setSelectedClipId: timeline.setSelectedClipId,
		setSelectedAnnotationId: timeline.setSelectedAnnotationId,
		setSelectedAudioId: timeline.setSelectedAudioId,
		setActiveEffectSection: input.setActiveEffectSection,
		videoPlaybackRef: input.videoPlaybackRef,
		mapSourceTimeToTimelineTime: projection.mapSourceTimeToTimelineTime,
		handleSeek: playback.handleSeek,
	});
	const zoomCommands = useZoomRegionCommands({
		setSelectedClipId: timeline.setSelectedClipId,
		videoPath: input.videoPath,
		setZoomRegions: timeline.setZoomRegions,
		selectedZoomId: timeline.selectedZoomId,
		setSelectedZoomId: timeline.setSelectedZoomId,
		setSelectedAnnotationId: timeline.setSelectedAnnotationId,
		setSelectedAudioId: timeline.setSelectedAudioId,
		setSelectedCaptionId: timeline.setSelectedCaptionId,
		setActiveEffectSection: input.setActiveEffectSection,
		nextZoomIdRef: input.nextZoomIdRef,
		autoSuggestedVideoPathRef: input.autoSuggestedVideoPathRef,
		pendingFreshRecordingAutoZoomPathRef: input.pendingFreshRecordingAutoZoomPathRef,
	});
	const handleSelectAnnotation = useCallback(
		(id: string | null) => {
			timeline.setSelectedAnnotationId(id);
			if (id) {
				timeline.setSelectedClipId(null);
				timeline.setSelectedZoomId(null);
				timeline.setSelectedAudioId(null);
				timeline.setSelectedCaptionId(null);
			}
		},
		[
			timeline.setSelectedAnnotationId,
			timeline.setSelectedClipId,
			timeline.setSelectedZoomId,
			timeline.setSelectedAudioId,
			timeline.setSelectedCaptionId,
		],
	);
	const freshZoom = useFreshRecordingAutoZoom({
		appPlatform: input.appPlatform,
		videoPath: input.videoPath,
		loading: input.loading,
		isPreviewReady: input.isPreviewReady,
		duration: input.duration,
		cursorTelemetryCount: timeline.cursorTelemetry.length,
		normalizedCursorTelemetry: cursor.normalizedCursorTelemetry,
		zoomRegions: timeline.zoomRegions,
		setZoomRegions: timeline.setZoomRegions,
		setAutoSuggestZoomsTrigger: input.setAutoSuggestZoomsTrigger,
		videoPlaybackRef: input.videoPlaybackRef,
		autoSuggestedVideoPathRef: input.autoSuggestedVideoPathRef,
		pendingFreshRecordingAutoZoomPathRef: input.pendingFreshRecordingAutoZoomPathRef,
		pendingFreshRecordingAutoSuggestTimeoutRef:
			input.pendingFreshRecordingAutoSuggestTimeoutRef,
		pendingFreshRecordingAutoSuggestTelemetryCountRef:
			input.pendingFreshRecordingAutoSuggestTelemetryCountRef,
	});
	const clipCommands = useClipRegionCommands({
		setSourceAudioTrackSettingsByClip: timeline.setSourceAudioTrackSettingsByClip,
		videoTracks: timeline.videoTracks,
		setVideoRegions: timeline.setVideoRegions,
		setAnnotationRegions: timeline.setAnnotationRegions,
		setAudioRegions: timeline.setAudioRegions,
		sourceDurationMs: input.duration * 1000,
		clipRegions: timeline.clipRegions,
		setClipRegions: timeline.setClipRegions,
		zoomRegions: timeline.zoomRegions,
		setZoomRegions: timeline.setZoomRegions,
		selectedClipId: timeline.selectedClipId,
		setSelectedClipId: timeline.setSelectedClipId,
		setSelectedZoomId: timeline.setSelectedZoomId,
		setSelectedAnnotationId: timeline.setSelectedAnnotationId,
		setSelectedAudioId: timeline.setSelectedAudioId,
		setSelectedCaptionId: timeline.setSelectedCaptionId,
		setActiveEffectSection: input.setActiveEffectSection,
		nextClipIdRef: input.nextClipIdRef,
		t: input.t,
	});
	const audioCommands = useAudioRegionCommands({
		setSelectedClipId: timeline.setSelectedClipId,
		setAudioRegions: timeline.setAudioRegions,
		selectedAudioId: timeline.selectedAudioId,
		setSelectedAudioId: timeline.setSelectedAudioId,
		setSelectedZoomId: timeline.setSelectedZoomId,
		setSelectedAnnotationId: timeline.setSelectedAnnotationId,
		setSelectedCaptionId: timeline.setSelectedCaptionId,
		setActiveEffectSection: input.setActiveEffectSection,
		nextAudioIdRef: input.nextAudioIdRef,
	});
	const annotationCommands = useAnnotationRegionCommands({
		onSelectAnnotation: handleSelectAnnotation,
		setAnnotationRegions: timeline.setAnnotationRegions,
		selectedAnnotationId: timeline.selectedAnnotationId,
		setSelectedAnnotationId: timeline.setSelectedAnnotationId,
		setSelectedZoomId: timeline.setSelectedZoomId,
		nextAnnotationIdRef: input.nextAnnotationIdRef,
		nextAnnotationZIndexRef: input.nextAnnotationZIndexRef,
	});

	const sequenceTools = useSequenceTools({ timeline, clipCommands, videoCommands, getCurrentTime: playbackClock.getTime });
	const changeReview = useChangeReview({
		timeline,
		sourceDurationMs: input.duration * 1000,
		webcam: input.appearance.webcam,
		playbackClock,
		durationSeconds: projection.timelineDuration,
		isPlaying: input.isPlaying,
		applySequence: clipCommands.applySequence,
		seek: playback.handleTimelineSeek,
		startPlayback: playback.startPlayback,
		pause: playback.pauseOnly,
		setActiveSection: input.setActiveEffectSection,
	});
	useEditorGlobalInteractions(timeline);
	const stepReviewRate = (direction: -1 | 1) => {
		const next = REVIEW_RATES[REVIEW_RATES.indexOf(reviewRate) + direction];
		if (next !== undefined) playback.setReviewRate(next);
	};
	const deleteSelection = () => sequenceTools.deleteGroupedSelection() ||
		(input.timelineRef.current?.deleteSelected() ?? false);
	useEditorShortcuts(input.shortcuts, input.isMac, {
		addZoom: () => input.timelineRef.current?.addZoom(),
		splitClip: sequenceTools.split,
		addAnnotation: () => input.timelineRef.current?.addAnnotation(),
		addKeyframe: () => input.timelineRef.current?.addKeyframe(),
		deleteSelected: deleteSelection,
		playPause: playback.togglePlayPause,
		rippleDelete: sequenceTools.rippleDelete,
		selectForward: () => sequenceTools.setForwardSelectionActive(active => !active),
		shuttleForward: playback.shuttleForward,
		undo: input.handleUndo,
		redo: input.handleRedo,
		redoAlt: input.handleRedo,
		stepFrameBack: () => playback.stepFrames(-1),
		stepFrameForward: () => playback.stepFrames(1),
		seekBackSecond: () => playback.seekBy(-1),
		seekForwardSecond: () => playback.seekBy(1),
		prevCut: () => playback.seekToCut("previous"),
		nextCut: () => playback.seekToCut("next"),
		seekToStart: playback.seekToStart,
		seekToEnd: playback.seekToEnd,
		shuttleReverse: playback.shuttleReverse,
		pauseOnly: playback.pauseOnly,
		reviewRateUp: () => stepReviewRate(1),
		reviewRateDown: () => stepReviewRate(-1),
		prevChange: () => changeReview.goToEntry(-1),
		nextChange: () => changeReview.goToEntry(1),
		auditionChange: () => changeReview.audition(),
		acceptChange: () => changeReview.accept(),
		restoreChange: () => changeReview.restore(),
	}, {
		repeatable: REPEATING_SHORTCUT_ACTIONS,
		canHandle: action => (
			action !== "acceptChange" && action !== "restoreChange" && action !== "auditionChange" ||
			(input.activeEffectSection === "review" && changeReview.entries.length > 0)
		),
		onEscape: sequenceTools.clearForwardSelection,
		fixedActions: {
			deleteSelection,
			selectAllZooms: () => input.timelineRef.current?.selectAllZooms() ?? false,
			nextAnnotation: () => input.timelineRef.current?.cycleAnnotations(false) ?? false,
			previousAnnotation: () => input.timelineRef.current?.cycleAnnotations(true) ?? false,
		},
	});

	return {
		sequenceTools,
		changeReview,
		videoCommands,
		cursor,
		projection,
		audio,
		playback,
		captionCommands,
		zoomCommands,
		clipCommands,
		audioCommands,
		annotationCommands,
		handleSelectAnnotation,
		handleAutoSuggestZoomsConsumed: freshZoom.handleAutoSuggestZoomsConsumed,
	};
}
