import { uiText } from "@/i18n/uiText";
import { Plus } from "@/components/ui/icons";
import type { Range, Span } from "dnd-timeline";
import { forwardRef, memo, useCallback, useEffect, useMemo, useRef, useState, type Dispatch, type RefObject, type SetStateAction } from "react";
import type {
	SourceAudioTrackMeta,
	SourceAudioTrackSettings,
} from "@/components/video-editor/audio/audioTypes";
import { useScopedT } from "@/contexts/I18nContext";
import type { ChangeReviewMarkers } from "../changeLogRestore";
import type { PlaybackClock } from "../videoPlayback/playbackClock";
import type {
	AnnotationRegion,
	AudioRegion,
	CaptionCue,
	ClipRegion,
	CursorTelemetryPoint,
	SpeedRegion,
	TimelineMarker,
	TrimRegion,
	ZoomFocus,
	ZoomRegion,
} from "../types";
import KeyframeMarkers from "./components/markers/KeyframeMarkers";
import { useRecordingMarkers } from "../hooks/useRecordingMarkers";
import type { KeystrokeTrackControls } from "../keystrokes/KeystrokeTrack";
import TimelineCanvas, { type TimelineTimeAtClientX } from "./components/viewport/TimelineCanvas";
import { WaveformLoadStatus } from "./components/waveform/SourceAudioWaveform";
import TimelineWrapper from "./components/wrapper/TimelineWrapper";
import { calculateTimelineScale } from "./core/time";
import { spansOverlap } from "./core/spans";
import type { ClipSequenceSpan } from "./core/timelineTypes";
import { VideoTrackRows, videoRowId, type VideoTrackControls } from "./components/VideoTrackRows";
import { useTimelineAudioPeaks } from "./hooks/useTimelineAudioPeaks";
import { useTimelineEditorRuntime } from "./hooks/useTimelineEditorRuntime";
import { useTimelineRange } from "./hooks/useTimelineRange";
import {
	buildTimelineSourceAudioTracks,
	getSourceSidecarWaveformStartDelayMs,
	getSourceSidecarWaveformPaths,
} from "./sourceAudioTracks";

export interface TimelineEditorProps {
	selectedIds?: string[];
	onSelectRegions?: (ids: string[]) => void;
	forwardSelectionActive?: boolean;
	onForwardSelect?: (timeMs: number) => void;
	onClearSelection?: () => void;
	videoTrackControls?: VideoTrackControls;
	changeMarkers?: ChangeReviewMarkers;
	focusRange?: Range | null;
	videoDuration: number;
	playbackClock: PlaybackClock;
	timeAtClientXRef?: RefObject<TimelineTimeAtClientX | null>;
	onSeek?: (time: number) => void;
	cursorTelemetry?: CursorTelemetryPoint[];
	autoSuggestZoomsTrigger?: number;
	onAutoSuggestZoomsConsumed?: () => void;
	disableSuggestedZooms?: boolean;
	zoomRegions: ZoomRegion[];
	onZoomAdded: (span: Span) => void;
	onZoomSuggested?: (span: Span, focus: ZoomFocus) => void;
	onZoomSpanChange: (id: string, span: Span) => void;
	onZoomDelete: (id: string) => void;
	selectedZoomId: string | null;
	onSelectZoom: (id: string | null) => void;
	trimRegions?: TrimRegion[];
	onTrimSpanChange?: (id: string, span: Span) => void;
	clipRegions?: ClipRegion[];
	markers?: TimelineMarker[];
	keystrokeTrack?: KeystrokeTrackControls;
	onMarkersChange?: Dispatch<SetStateAction<TimelineMarker[]>>;
	onClipSplit?: (splitMs: number) => void;
	onClipSpanChange?: (id: string, span: ClipSequenceSpan) => void;
	onClipDelete?: (id: string) => void;
	selectedClipId?: string | null;
	onSelectClip?: (id: string | null) => void;
	annotationRegions?: AnnotationRegion[];
	onAnnotationAdded?: (span: Span, trackIndex?: number) => void;
	onAnnotationSpanChange?: (id: string, span: Span, trackIndex?: number) => void;
	onAnnotationDelete?: (id: string) => void;
	selectedAnnotationId?: string | null;
	onSelectAnnotation?: (id: string | null) => void;
	speedRegions?: SpeedRegion[];
	onSpeedSpanChange?: (id: string, span: Span) => void;
	audioRegions?: AudioRegion[];
	onAudioAdded?: (span: Span, audioPath: string, trackIndex?: number) => void;
	onAudioSpanChange?: (id: string, span: Span, trackIndex?: number) => void;
	onAudioDelete?: (id: string) => void;
	selectedAudioId?: string | null;
	onSelectAudio?: (id: string | null) => void;
	captionRegions?: CaptionCue[];
	onCaptionSpanChange?: (id: string, span: Span) => void;
	onCaptionDelete?: (id: string) => void;
	onCaptionAdded?: (span: Span) => void;
	captionsEnabled?: boolean;
	captionQuickAddEnabled?: boolean;
	selectedCaptionId?: string | null;
	onSelectCaption?: (id: string | null) => void;
	videoPath?: string | null;
	videoSourcePath?: string | null;
	cursorTelemetrySourcePath?: string | null;
	showSourceAudioTrack?: boolean;
	sourceAudioResourceVersion?: number;
	sourceAudioVideoDuration?: number;
	sourceAudioStartDelayMsByPath?: Readonly<Record<string, number>>;
	sourceAudioSidecarPaths?: readonly string[];
	onSourceAudioAvailabilityChange?: (available: boolean) => void;
	getSourceAudioTrackSettingsForClip?: (clipId: string | null) => SourceAudioTrackSettings;
	onSourceAudioRangeDelete?: (clipId: string, trackId: string, range: { startMs: number; endMs: number }) => void;
	onSourceAudioTracksMetaChange?: (tracks: SourceAudioTrackMeta) => void;
}

export interface TimelineEditorHandle {
	addZoom: () => void;
	addKeyframe: () => void;
	deleteSelected: () => boolean;
	selectAllZooms: () => boolean;
	cycleAnnotations: (backward: boolean) => boolean;
	addCaption: () => void;
	suggestZooms: () => void;
	splitClip: () => void;
	addAnnotation: (trackIndex?: number) => void;
	addAudio: (trackIndex?: number) => Promise<void>;
	keyframes: { id: string; time: number }[];
}

const EMPTY_TIMELINE_ITEMS: [] = [];

const TimelineEditor = forwardRef<TimelineEditorHandle, TimelineEditorProps>(
	function TimelineEditor(
		{
			selectedIds = EMPTY_TIMELINE_ITEMS,
			onSelectRegions,
			forwardSelectionActive,
			onForwardSelect,
			onClearSelection,
			videoTrackControls,
			changeMarkers,
			focusRange,
			videoDuration,
			playbackClock,
			timeAtClientXRef,
			onSeek,
			cursorTelemetry = EMPTY_TIMELINE_ITEMS,
			autoSuggestZoomsTrigger = 0,
			onAutoSuggestZoomsConsumed,
			disableSuggestedZooms = false,
			zoomRegions,
			onZoomAdded,
			onZoomSuggested,
			onZoomSpanChange,
			onZoomDelete,
			selectedZoomId,
			onSelectZoom,
			trimRegions = EMPTY_TIMELINE_ITEMS,
			onTrimSpanChange,
			clipRegions = EMPTY_TIMELINE_ITEMS,
			markers = EMPTY_TIMELINE_ITEMS,
			keystrokeTrack,
			onMarkersChange,
			onClipSplit,
			onClipSpanChange,
			onClipDelete,
			selectedClipId,
			onSelectClip,
			annotationRegions = EMPTY_TIMELINE_ITEMS,
			onAnnotationAdded,
			onAnnotationSpanChange,
			onAnnotationDelete,
			selectedAnnotationId,
			onSelectAnnotation,
			speedRegions = EMPTY_TIMELINE_ITEMS,
			onSpeedSpanChange,
			audioRegions = EMPTY_TIMELINE_ITEMS,
			onAudioAdded,
			onAudioSpanChange,
			onAudioDelete,
			selectedAudioId,
			onSelectAudio,
			captionRegions = EMPTY_TIMELINE_ITEMS,
			onCaptionSpanChange,
			onCaptionDelete,
			onCaptionAdded,
			captionsEnabled = false,
			selectedCaptionId,
			onSelectCaption,
			videoPath,
			videoSourcePath,
			cursorTelemetrySourcePath,
			showSourceAudioTrack = true,
			sourceAudioResourceVersion = 0,
			sourceAudioVideoDuration = videoDuration,
			sourceAudioStartDelayMsByPath,
			sourceAudioSidecarPaths,
			onSourceAudioAvailabilityChange,
			getSourceAudioTrackSettingsForClip,
			onSourceAudioRangeDelete,
			onSourceAudioTracksMetaChange,
		},
		ref,
	) {
		const t = useScopedT("settings");
		const recordingMarkers = useRecordingMarkers(videoSourcePath, clipRegions);
		const totalMs = useMemo(
			() => Math.max(0, Math.round(videoDuration * 1000)),
			[videoDuration],
		);
		const getCurrentTimeMs = useCallback(() => Math.round(playbackClock.getTime() * 1000), [playbackClock]);
		const timelineScale = useMemo(() => calculateTimelineScale(videoDuration), [videoDuration]);
		const safeMinDurationMs = useMemo(
			() =>
				totalMs > 0
					? Math.min(timelineScale.minItemDurationMs, totalMs)
					: timelineScale.minItemDurationMs,
			[timelineScale.minItemDurationMs, totalMs],
		);

		const timelineContainerRef = useRef<HTMLDivElement>(null);
		const isTimelineFocusedRef = useRef(false);
		const { setRange, clampedRange } = useTimelineRange({
			totalMs,
			timelineContainerRef,
			sourceKey: videoSourcePath ?? videoPath,
			focusRange,
		});

		const [liveSpanPreviewById, setLiveSpanPreviewById] = useState<Record<string, Span>>({});
		const [isDragging, setIsDragging] = useState(false);
		const liveZoomPreview = useMemo(() => {
			const previewSpans: Record<string, Span> = { ...liveSpanPreviewById };
			const hiddenZoomIds = new Set<string>();

			for (const [previewId, previewSpan] of Object.entries(liveSpanPreviewById)) {
				const oldClip = clipRegions.find((clip) => clip.id === previewId);
				if (!oldClip) continue;

				const newStart = Math.round(previewSpan.start);
				const newEnd = Math.round(previewSpan.end);
				const removedSegments = [
					...(newStart > oldClip.startMs
						? [{ startMs: oldClip.startMs, endMs: newStart }]
						: []),
					...(newEnd < oldClip.endMs ? [{ startMs: newEnd, endMs: oldClip.endMs }] : []),
				];

				const startDelta = newStart - oldClip.startMs;
				const endDelta = newEnd - oldClip.endMs;
				const isMove = Math.abs(startDelta - endDelta) < 1 && Math.abs(startDelta) > 0;

				if (isMove) {
					const delta = startDelta;
					for (const zoom of zoomRegions) {
						const overlaps =
							zoom.startMs < oldClip.endMs && zoom.endMs > oldClip.startMs;
						if (!overlaps) continue;
						previewSpans[zoom.id] = {
							start: zoom.startMs + delta,
							end: zoom.endMs + delta,
						};
					}
				}

				if (removedSegments.length > 0) {
					for (const zoom of zoomRegions) {
						const removed = removedSegments.some(
							(segment) =>
								zoom.startMs < segment.endMs && zoom.endMs > segment.startMs,
						);
						if (removed) hiddenZoomIds.add(zoom.id);
					}
				}
			}

			return { previewSpans, hiddenZoomIds: [...hiddenZoomIds] };
		}, [clipRegions, liveSpanPreviewById, zoomRegions]);
		const sourceWaveform = useTimelineAudioPeaks(
			videoPath,
			{ resourceVersion: sourceAudioResourceVersion },
		);
		const { peaks: sourceAudioPeaks, loading: sourceAudioLoading } = sourceWaveform;
		const micSidecarPaths = useMemo(
			() => getSourceSidecarWaveformPaths(sourceAudioSidecarPaths ?? [], "mic"),
			[sourceAudioSidecarPaths],
		);
		const micSidecarFallbackPaths = useMemo(() => micSidecarPaths.slice(1), [micSidecarPaths]);
		const systemSidecarPaths = useMemo(
			() => getSourceSidecarWaveformPaths(sourceAudioSidecarPaths ?? [], "system"),
			[sourceAudioSidecarPaths],
		);
		const systemSidecarFallbackPaths = useMemo(
			() => systemSidecarPaths.slice(1),
			[systemSidecarPaths],
		);
		const micWaveform = useTimelineAudioPeaks(
			micSidecarPaths[0] ?? null,
			{
				fallbackResources: micSidecarFallbackPaths,
				optionalSource: true,
				resourceVersion: sourceAudioResourceVersion,
			},
		);
		const systemWaveform = useTimelineAudioPeaks(
			systemSidecarPaths[0] ?? null,
			{
				fallbackResources: systemSidecarFallbackPaths,
				optionalSource: true,
				resourceVersion: sourceAudioResourceVersion,
			},
		);
		const { peaks: micSidecarPeaks, loading: micSidecarLoading, resource: micSidecarResource } = micWaveform;
		const { peaks: systemSidecarPeaks, loading: systemSidecarLoading, resource: systemSidecarResource } = systemWaveform;
		const sourceAudioTracks = useMemo(
			() =>
				buildTimelineSourceAudioTracks({
					sourceAudioPeaks,
					micSidecarPeaks,
					systemSidecarPeaks,
					micStartDelayMs: getSourceSidecarWaveformStartDelayMs({
						resource: micSidecarResource, peaks: micSidecarPeaks, kind: "mic",
						videoDuration: sourceAudioVideoDuration, startDelayMsByPath: sourceAudioStartDelayMsByPath,
					}),
					systemStartDelayMs: getSourceSidecarWaveformStartDelayMs({
						resource: systemSidecarResource, peaks: systemSidecarPeaks, kind: "system",
						videoDuration: sourceAudioVideoDuration, startDelayMsByPath: sourceAudioStartDelayMsByPath,
					}),
					labels: {
						system: t("audio.systemLabel", "Source System"),
						mic: t("audio.micLabel", "Source Mic"),
						mixed: t("audio.mixedLabel", "Source"),
					},
				}),
			[micSidecarPeaks, micSidecarResource, sourceAudioPeaks, systemSidecarPeaks, systemSidecarResource, sourceAudioVideoDuration, sourceAudioStartDelayMsByPath, t],
		);

		const isLoading = useMemo(() => {
			// If we are still actively trying to load audio peaks (main or sidecars)
			if (videoPath && (sourceAudioLoading || micSidecarLoading || systemSidecarLoading))
				return true;

			// Robust telemetry loading detection:
			// If a source path is set but telemetry hasn't arrived (or failed/retried) for it yet.
			if (videoSourcePath && cursorTelemetrySourcePath !== videoSourcePath) return true;

			return false;
		}, [
			videoPath,
			videoSourcePath,
			cursorTelemetrySourcePath,
			sourceAudioLoading,
			micSidecarLoading,
			systemSidecarLoading,
		]);
		useEffect(() => {
			onSourceAudioTracksMetaChange?.(
				sourceAudioTracks.map((t) => ({ id: t.id, label: t.label })),
			);
		}, [onSourceAudioTracksMetaChange, sourceAudioTracks]);
		useEffect(() => {
			onSourceAudioAvailabilityChange?.(sourceAudioTracks.length > 0);
		}, [onSourceAudioAvailabilityChange, sourceAudioTracks.length]);

		const {
			keyframes,
			selectedKeyframeId,
			setSelectedKeyframeId,
			selectAllBlocksActive,
			setSelectAllBlocksActive,
			handleKeyframeMove,
			updateMarker,
			clearSelectedBlocks,
			handleSelectZoom,
			handleSelectClip,
			handleSelectAnnotation,
			handleSelectAudio,
			handleSelectCaption,
			hasOverlap,
			timelineItems,
			allRegionSpans,
			getResolvedDropRowId,
			handleItemSpanChange,
			canPlaceZoomAtMs,
			addZoomAtMs,
			canPlaceCaptionAtMs,
			addCaptionAtMs,
			resolveCaptionSpanAtMs,
		} = useTimelineEditorRuntime({
			ref,
			videoDuration,
			totalMs,
			getCurrentTimeMs,
			safeMinDurationMs,
			cursorTelemetry,
			autoSuggestZoomsTrigger,
			onAutoSuggestZoomsConsumed,
			disableSuggestedZooms,
			zoomRegions,
			onZoomAdded,
			onZoomSuggested,
			onZoomSpanChange,
			onZoomDelete,
			selectedZoomId,
			onSelectZoom,
			trimRegions,
			onTrimSpanChange,
			clipRegions,
			markers,
			onMarkersChange,
			onClipSplit,
			onClipSpanChange,
			onClipDelete,
			selectedClipId,
			onSelectClip,
			annotationRegions,
			onAnnotationAdded,
			onAnnotationSpanChange,
			onAnnotationDelete,
			selectedAnnotationId,
			onSelectAnnotation,
			speedRegions,
			onSpeedSpanChange,
			audioRegions,
			onAudioAdded,
			onAudioSpanChange,
			onAudioDelete,
			selectedAudioId,
			onSelectAudio,
			captionCues: captionRegions,
			onCaptionSpanChange,
			onCaptionDelete,
			onCaptionAdded,
			selectedCaptionId,
			onSelectCaption,
			isTimelineFocusedRef,
		});

		const videoTrackRegions = videoTrackControls?.regions;
		const timelineRegionSpans = useMemo(() => {
			if (!videoTrackRegions?.length) return allRegionSpans;
			return [...allRegionSpans, ...videoTrackRegions.map(region => ({
				id: region.id,
				start: region.startMs,
				end: region.endMs,
				rowId: videoRowId(region.trackId),
			}))];
		}, [allRegionSpans, videoTrackRegions]);
		const hasTimelineOverlap = useCallback((span: Span, id?: string, rowId?: string) => {
			const region = videoTrackRegions?.find(candidate => candidate.id === id);
			if (!region || !videoTrackRegions) return hasOverlap(span, id, rowId);
			const targetRow = rowId ?? videoRowId(region.trackId);
			return videoTrackRegions.some(other =>
				other.id !== id && videoRowId(other.trackId) === targetRow &&
				other.startMs < span.end && other.endMs > span.start,
			);
		}, [hasOverlap, videoTrackRegions]);

		const displayedItems = useMemo(() => focusRange
			? timelineItems.filter(item => spansOverlap(item.span, focusRange))
			: timelineItems, [timelineItems, focusRange]);
		const displayedVideoRegions = useMemo(() => focusRange
			? videoTrackRegions?.filter(region => spansOverlap({ start: region.startMs, end: region.endMs }, focusRange))
			: videoTrackRegions, [videoTrackRegions, focusRange]);
		const videoRows = useMemo(() => videoTrackControls
			? <VideoTrackRows {...videoTrackControls} regions={displayedVideoRegions ?? []} />
			: null, [videoTrackControls, displayedVideoRegions]);
		const onVideoSpanChange = videoTrackControls?.onChangeSpan;
		const applyItemSpan = useCallback((id: string, span: ClipSequenceSpan, rowId?: string) => {
			const region = videoTrackRegions?.find((region) => region.id === id);
			if (region) onVideoSpanChange?.(id, span, rowId?.startsWith("row-video:") ? rowId.slice(10) : region.trackId);
			else handleItemSpanChange(id, span, rowId);
		}, [videoTrackRegions, onVideoSpanChange, handleItemSpanChange]);
		const resolveTargetRowId = useCallback((id: string, proposed: string) => {
			const region = videoTrackRegions?.find((region) => region.id === id);
			return region ? (proposed.startsWith("row-video:") ? proposed : videoRowId(region.trackId)) : getResolvedDropRowId(id, proposed);
		}, [videoTrackRegions, getResolvedDropRowId]);
		const previewItemSpan = useCallback((id: string, span: Span | null) => {
			setLiveSpanPreviewById((previous) => {
				const current = previous[id];
				if (!span) {
					if (!current) return previous;
					const next = { ...previous };
					delete next[id];
					return next;
				}
				if (current?.start === span.start && current.end === span.end) return previous;
				return { ...previous, [id]: span };
			});
		}, []);
		const clearCanvasSelection = useCallback(() => {
			clearSelectedBlocks();
			onClearSelection?.();
		}, [clearSelectedBlocks, onClearSelection]);

		if (!videoDuration || videoDuration === 0) {
			return (
				<div className="flex-1 flex flex-col items-center justify-center rounded-lg bg-editor-surface gap-3">
					<div className="w-12 h-12 rounded-full bg-foreground/5 flex items-center justify-center">
						<Plus className="w-6 h-6 text-muted-foreground" />
					</div>
					<div className="text-center">
						<p className="text-sm font-medium text-muted-foreground">{uiText("noVideoLoaded")}</p>
						<p className="text-xs text-muted-foreground/70 mt-1">
							{uiText("dragAndDropAVideoToStartEditing")}</p>
					</div>
				</div>
			);
		}

		return (
			<div className="flex-1 min-h-0 flex flex-col bg-transparent overflow-hidden">
				{[sourceWaveform, micWaveform, systemWaveform].some((waveform) => waveform.error || (waveform.loading && waveform.progress !== null)) && (
					<div className="flex flex-wrap gap-x-3 px-3 py-1">
						<WaveformLoadStatus {...sourceWaveform} label={t("audio.mixedLabel", "Source")} />
						<WaveformLoadStatus {...micWaveform} label={t("audio.micLabel", "Source Mic")} />
						<WaveformLoadStatus {...systemWaveform} label={t("audio.systemLabel", "Source System")} />
					</div>
				)}
				<div
					ref={timelineContainerRef}
					data-testid="timeline-scroll"
					data-range-start-ms={clampedRange.start}
					data-range-end-ms={clampedRange.end}
					style={{ outline: "none", boxShadow: "none", willChange: "transform" }}
					className="flex-1 min-h-0 overflow-x-hidden overflow-y-auto bg-transparent relative px-3"
					tabIndex={0}
					onFocus={() => {
						isTimelineFocusedRef.current = true;
					}}
					onBlur={() => {
						isTimelineFocusedRef.current = false;
					}}
					onPointerDownCapture={(event) => {
						if ((event.target as HTMLElement).closest("[data-source-audio-editor]")) return;
						timelineContainerRef.current?.focus({ preventScroll: true });
						isTimelineFocusedRef.current = true;
					}}
					onClick={() => {
						setSelectedKeyframeId(null);
						setSelectAllBlocksActive(false);
					}}
				>
					<TimelineWrapper
						range={clampedRange}
						videoDuration={videoDuration}
						hasOverlap={hasTimelineOverlap}
						onRangeChange={setRange}
						minItemDurationMs={timelineScale.minItemDurationMs}
						minVisibleRangeMs={timelineScale.minVisibleRangeMs}
						onItemSpanChange={applyItemSpan}
						resolveTargetRowId={resolveTargetRowId}
						allRegionSpans={timelineRegionSpans}
						onDraggingChange={setIsDragging}
						onLiveSpanPreviewChange={previewItemSpan}
					>
						<KeyframeMarkers
							keyframes={keyframes}
							recordingMarkers={recordingMarkers}
							selectedKeyframeId={selectedKeyframeId}
							setSelectedKeyframeId={setSelectedKeyframeId}
							onKeyframeMove={handleKeyframeMove}
							onMarkerUpdate={onMarkersChange ? updateMarker : undefined}
							videoDurationMs={totalMs}
							timelineRef={timelineContainerRef}
						/>
						<TimelineCanvas
							keystrokeTrack={keystrokeTrack}
							changeMarkers={changeMarkers}
							selectedIds={selectedIds}
							onSelectRegions={onSelectRegions}
							forwardSelectionActive={forwardSelectionActive}
							onForwardSelect={onForwardSelect}
							videoRowCount={videoTrackControls?.tracks.length ?? 0}
							videoRows={videoRows}
							videoPath={videoPath}
							items={displayedItems}
							videoDurationMs={totalMs}
							playbackClock={playbackClock}
							timeAtClientXRef={timeAtClientXRef}
							onSeek={onSeek}
							onAddZoomAtMs={addZoomAtMs}
							canPlaceZoomAtMs={canPlaceZoomAtMs}
							onAddCaptionAtMs={addCaptionAtMs}
							canPlaceCaptionAtMs={canPlaceCaptionAtMs}
							resolveCaptionSpanAtMs={resolveCaptionSpanAtMs}
							captionsEnabled={captionsEnabled}
							captionQuickAddEnabled={false}
							onSelectZoom={handleSelectZoom}
							onSelectClip={handleSelectClip}
							onSelectAnnotation={handleSelectAnnotation}
							onSelectAudio={handleSelectAudio}
							onSelectCaption={handleSelectCaption}
							selectedZoomId={selectedZoomId}
							selectedClipId={selectedClipId}
							selectedAnnotationId={selectedAnnotationId}
							selectedAudioId={selectedAudioId}
							selectedCaptionId={selectedCaptionId}
							selectAllBlocksActive={selectAllBlocksActive}
							onClearBlockSelection={clearCanvasSelection}
							keyframes={keyframes}
							sourceAudioTracks={sourceAudioTracks}
							getSourceAudioTrackSettingsForClip={getSourceAudioTrackSettingsForClip}
							onSourceAudioRangeDelete={onSourceAudioRangeDelete}
							showSourceAudioTrack={showSourceAudioTrack}
							liveSpanPreviewById={liveZoomPreview.previewSpans}
							liveHiddenItemIds={liveZoomPreview.hiddenZoomIds}
							isDragging={isDragging}
							isLoading={isLoading}
						/>
					</TimelineWrapper>
				</div>
			</div>
		);
	},
);

TimelineEditor.displayName = "TimelineEditor";

export default memo(TimelineEditor);
