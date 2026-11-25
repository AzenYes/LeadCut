import { chapterProgressStatus } from "../chapterProgress";
import { useCallback, useLayoutEffect, useMemo, useSyncExternalStore, type ComponentProps, type Dispatch, type RefObject, type SetStateAction } from "react";
import type { AspectRatio } from "@/utils/aspectRatioUtils";
import type { useVideoEditorAudio } from "../audio/useVideoEditorAudio";
import { createExportPreviewRenderer, type ExportPreviewStore } from "../export/pausedExportPreview";
import type { useAppearanceState } from "../state/useAppearanceState";
import type { useTimelineState } from "../state/useTimelineState";
import { setPaddingSide, type CursorTelemetryPoint, type ZoomRegion } from "../types";
import VideoPlayback, { type VideoPlaybackRef } from "../VideoPlayback";
import type { PlaybackClock } from "../videoPlayback/playbackClock";

type PlaybackProps = ComponentProps<typeof VideoPlayback>;
type Handlers = Pick<
	PlaybackProps,
	| "onSelectZoom"
	| "onZoomFocusChange"
	| "onEditAutoCaption"
	| "onSelectAutoCaption"
	| "onCaptionPositionChange"
	| "onSelectAnnotation"
	| "onAnnotationPositionChange"
	| "onAnnotationSizeChange"
>;

type Props = {
	videoPath: string | null;
	previewVersion: number;
	aspectRatio: AspectRatio;
	playbackRef: RefObject<VideoPlaybackRef | null>;
	playbackClock: PlaybackClock;
	isPlaying: boolean;
	previewPlaybackRate?: number;
	timelineDuration?: number;
	previewVolume: number;
	suspendRendering: boolean;
	exportPreview: ExportPreviewStore;
	readOnly: boolean;
	appearance: ReturnType<typeof useAppearanceState>;
	timeline: ReturnType<typeof useTimelineState>;
	audio: ReturnType<typeof useVideoEditorAudio>;
	effectiveZoomRegions: ZoomRegion[];
	effectiveCursorTelemetry: CursorTelemetryPoint[];
	effectiveShowCursor: boolean;
	setDuration: Dispatch<SetStateAction<number>>;
	setIsPreviewReady: (ready: boolean) => void;
	setIsPlaying: Dispatch<SetStateAction<boolean>>;
	setError: (message: string | null) => void;
	handlers: Handlers;
};

export function EditorVideoPreview({
	videoPath,
	previewVersion,
	aspectRatio,
	playbackRef,
	playbackClock,
	isPlaying,
	previewPlaybackRate = 1,
	timelineDuration,
	previewVolume,
	suspendRendering,
	exportPreview,
	readOnly,
	appearance,
	timeline,
	audio,
	effectiveZoomRegions,
	effectiveCursorTelemetry,
	effectiveShowCursor,
	setDuration,
	setIsPreviewReady,
	setIsPlaying,
	setError,
	handlers,
}: Props) {
	const still = useSyncExternalStore(exportPreview.subscribe, exportPreview.get);
	const exportPreviewRenderer = useMemo(() => createExportPreviewRenderer(exportPreview), [exportPreview]);
	useLayoutEffect(() => exportPreviewRenderer.attach(), [exportPreviewRenderer]);
	const handlePreviewReady = useCallback((ready: boolean) => {
		setIsPreviewReady(ready);
		const restored = exportPreview.get();
		if (!ready || !restored || restored.suspended) return;
		const video = playbackRef.current?.video;
		exportPreview.set(null);
		if (restored.resumePlayback && video) {
			// The transport is attached by the preview's remaining effects.
			queueMicrotask(() => {
				const playback = playbackRef.current;
				if (playback?.video === video && !exportPreview.get()) {
					void playback.play().catch(() => undefined);
				}
			});
		}
	}, [exportPreview, playbackRef, setIsPreviewReady]);
	const currentTime = useSyncExternalStore(playbackClock.subscribe, playbackClock.getTime);
	const { autoCaptions } = timeline;
	const paddingDraft = useSyncExternalStore(appearance.paddingDraft.subscribe, appearance.paddingDraft.get);
	const padding = useMemo(() => paddingDraft ? setPaddingSide(appearance.padding, paddingDraft.side, paddingDraft.value)
		: appearance.padding, [appearance.padding, paddingDraft]);
	const visibleCaptions = useMemo(() => autoCaptions.filter(cue => cue.text.trim().length > 0), [autoCaptions]);
	const { activeClipId, currentSourceTimeMs, isCurrentClipMuted } = audio.getSourcePlayback(currentTime);
	const volume = audio.shouldMutePreviewVideo || isCurrentClipMuted ? 0
		: Math.max(0, Math.min(1, previewVolume * audio.getSourceTrackPreviewGain(audio.embeddedTrackId, activeClipId, currentSourceTimeMs)));
	return (<>
		{still && <img data-export-still-preview alt="" src={still.imageUrl}
			className="pointer-events-none absolute inset-0 z-30 h-full w-full" />}
		{!still?.suspended && <VideoPlayback
			exportPreviewRenderer={exportPreviewRenderer}
			clipRegions={timeline.clipRegions}
			videoRegions={timeline.videoRegions}
			videoTracks={timeline.videoTracks}
			timelineDuration={timelineDuration}
			key={`${videoPath || "no-video"}:${previewVersion}:inline`}
			aspectRatio={aspectRatio}
			ref={playbackRef}
			videoPath={videoPath || ""}
			onDurationChange={setDuration}
			onPreviewReadyChange={handlePreviewReady}
			onTimeUpdate={playbackClock.setTime}
			currentTime={currentTime}
			onPlayStateChange={setIsPlaying}
			onError={setError}
			wallpaper={appearance.wallpaper}
			zoomRegions={effectiveZoomRegions}
			selectedZoomId={timeline.selectedZoomId}
			isPlaying={isPlaying}
			previewPlaybackRate={previewPlaybackRate}
			showShadow={appearance.shadowIntensity > 0}
			shadowIntensity={appearance.shadowIntensity}
			backgroundBlur={appearance.backgroundBlur}
			connectZooms={appearance.connectZooms}
			zoomInDurationMs={appearance.zoomInDurationMs}
			zoomInOverlapMs={appearance.zoomInOverlapMs}
			zoomOutDurationMs={appearance.zoomOutDurationMs}
			connectedZoomGapMs={appearance.connectedZoomGapMs}
			connectedZoomDurationMs={appearance.connectedZoomDurationMs}
			zoomInEasing={appearance.zoomInEasing}
			zoomOutEasing={appearance.zoomOutEasing}
			connectedZoomEasing={appearance.connectedZoomEasing}
			borderRadius={appearance.borderRadius}
			padding={padding}
			cropRegion={appearance.cropRegion}
			webcam={appearance.webcam}
			webcamVideoPath={
				appearance.webcam.sourcePath && !timeline.videoTracks.some((track) => track.kind === "webcam") ? appearance.resolvedWebcamVideoUrl : null
			}
			annotationRegions={timeline.annotationRegions}
			chapterProgress={chapterProgressStatus(timeline.chapterProgress, timeline) === "ready" ? timeline.chapterProgress : undefined}
			keystrokes={timeline.recordedKeystrokes.presentation}
			onKeystrokePositionChange={readOnly ? undefined : position => timeline.setKeystrokeOverlay(current => ({
				...current, style: { ...current.style, ...position },
			}))}
			autoCaptions={visibleCaptions}
			autoCaptionSettings={timeline.autoCaptionSettings}
			captionFontSizeDraft={timeline.captionFontSizeDraft}
			selectedAnnotationId={timeline.selectedAnnotationId}
			cursorTelemetry={effectiveCursorTelemetry}
			showCursor={effectiveShowCursor}
			cursorStyle={appearance.cursorStyle}
			cursorSize={appearance.cursorSize}
			cursorSmoothing={appearance.cursorSmoothing}
			cursorSpringStiffnessMultiplier={appearance.cursorSpringStiffnessMultiplier}
			cursorSpringDampingMultiplier={appearance.cursorSpringDampingMultiplier}
			cursorSpringMassMultiplier={appearance.cursorSpringMassMultiplier}
			cameraSpringStiffnessMultiplier={appearance.cameraSpringStiffnessMultiplier}
			cameraSpringDampingMultiplier={appearance.cameraSpringDampingMultiplier}
			cameraSpringMassMultiplier={appearance.cameraSpringMassMultiplier}
			zoomSmoothness={appearance.zoomSmoothness}
			zoomClassicMode={appearance.zoomClassicMode}
			zoomMotionBlur={appearance.zoomMotionBlur}
			zoomMotionBlurTuning={appearance.zoomMotionBlurTuning}
			cursorMotionBlur={appearance.cursorMotionBlur}
			cursorClickEffect={appearance.cursorClickEffect}
			cursorClickEffectColor={appearance.cursorClickEffectColor}
			cursorClickEffectScale={appearance.cursorClickEffectScale}
			cursorClickEffectOpacity={appearance.cursorClickEffectOpacity}
			cursorClickEffectDurationMs={appearance.cursorClickEffectDurationMs}
			cursorClickBounce={appearance.cursorClickBounce}
			cursorClickBounceDuration={appearance.cursorClickBounceDuration}
			cursorSway={appearance.cursorSway}
			volume={volume}
			suspendRendering={suspendRendering}
			{...handlers}
		/>}
	</>);
}
