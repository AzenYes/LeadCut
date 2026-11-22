import { TIMELINE_HEIGHT_STORAGE_KEY } from "@/lib/storageKeys";
import type { Range, Span } from "dnd-timeline";
import { readRendererSetting, writeRendererSetting } from "@/lib/durableRendererSettings";
import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from "react";
import { useI18n } from "@/contexts/I18nContext";
import { useShortcuts } from "@/contexts/ShortcutsContext";
import { formatBinding } from "@/lib/shortcuts";
import type { ChangeReviewMarkers } from "../changeLogRestore";
import { formatTimelineTimecode, parseTimelineTimecode } from "../timeline/core/time";
import type { useVideoEditorAudio } from "../audio/useVideoEditorAudio";
import { retimeCaptionFragment } from "../captionTimeline";
import type { useAnnotationRegionCommands } from "../hooks/useAnnotationRegionCommands";
import type { useAudioRegionCommands } from "../hooks/useAudioRegionCommands";
import type { useCaptionCommands } from "../hooks/useCaptionCommands";
import type { useClipRegionCommands } from "../hooks/useClipRegionCommands";
import type { useVideoTrackCommands } from "../hooks/useVideoTrackCommands";
import type { useSequenceTools } from "../hooks/useSequenceTools";
import type { useEditorPlaybackControls } from "../hooks/useEditorPlaybackControls";
import type { useTimelineProjection } from "../hooks/useTimelineProjection";
import type { useZoomRegionCommands } from "../hooks/useZoomRegionCommands";
import type { useTimelineState } from "../state/useTimelineState";
import TimelineEditor, { type TimelineEditorHandle } from "../timeline/TimelineEditor";

type Props = {
	readOnly?: boolean;
	changeMarkers: ChangeReviewMarkers;
	focusRange: Range | null;
	onReturnToFullTimeline: () => void;
	panelRef?: RefObject<HTMLDivElement | null>;
	timelineRef: RefObject<TimelineEditorHandle | null>;
	timeline: ReturnType<typeof useTimelineState>;
	projection: ReturnType<typeof useTimelineProjection>;
	playback: ReturnType<typeof useEditorPlaybackControls>;
	audio: ReturnType<typeof useVideoEditorAudio>;
	zoomCommands: ReturnType<typeof useZoomRegionCommands>;
	clipCommands: ReturnType<typeof useClipRegionCommands>;
	videoCommands: ReturnType<typeof useVideoTrackCommands>;
	sequenceTools: ReturnType<typeof useSequenceTools>;
	audioCommands: ReturnType<typeof useAudioRegionCommands>;
	captionCommands: ReturnType<typeof useCaptionCommands>;
	annotationCommands: ReturnType<typeof useAnnotationRegionCommands>;
	videoPath: string | null;
	videoSourcePath: string | null;
	cursorTelemetrySourcePath: string | null;
	normalizedCursorTelemetry: ReturnType<typeof useTimelineState>["cursorTelemetry"];
	autoSuggestZoomsTrigger: number;
	handleAutoSuggestZoomsConsumed: () => void;
	disableSuggestedZooms: boolean;
	currentTime: number;
	handleSelectAnnotation: (id: string | null) => void;
};

const clampHeight = (value: number) => Math.max(180, Math.min(window.innerHeight * 0.72, value));

export function EditorTimelinePanel(props: Props) {
	const { t } = useI18n();
	const { shortcuts, isMac } = useShortcuts();
	const [height, setHeight] = useState(() => {
		const saved = Number(readRendererSetting(TIMELINE_HEIGHT_STORAGE_KEY));
		return clampHeight(saved > 0 ? saved : 260);
	});
	const resizeStart = useRef<{ y: number; height: number } | null>(null);
	const [timeDraft, setTimeDraft] = useState<string | null>(null);
	useEffect(() => {
		writeRendererSetting(TIMELINE_HEIGHT_STORAGE_KEY, String(Math.round(height)));
	}, [height]);
	useEffect(() => {
		const resize = () => setHeight((height) => clampHeight(height));
		window.addEventListener("resize", resize);
		return () => window.removeEventListener("resize", resize);
	}, []);
	const {
		timelineRef,
		timeline,
		projection,
		playback,
		audio,
		zoomCommands,
		clipCommands,
		audioCommands,
		captionCommands,
		annotationCommands,
		videoPath,
		videoSourcePath,
		cursorTelemetrySourcePath,
		normalizedCursorTelemetry,
		autoSuggestZoomsTrigger,
		handleAutoSuggestZoomsConsumed,
		disableSuggestedZooms,
		currentTime,
		handleSelectAnnotation,
	} = props;
	const captionById = useMemo(() => new Map(projection.effectiveCaptionRegions.map((cue) => [cue.id, cue])), [projection.effectiveCaptionRegions]);
	const selectedCaptionFragments = useMemo(() => timeline.selectedCaptionId
		? projection.effectiveCaptionRegions.filter((cue) => cue.sourceCueId === timeline.selectedCaptionId)
		: [], [projection.effectiveCaptionRegions, timeline.selectedCaptionId]);
	const selectedIds = useMemo(() => {
		const selected = new Set(timeline.selectedRegionIds);
		if (!selected.size) return timeline.selectedRegionIds;
		return [...selected, ...projection.effectiveCaptionRegions.filter((cue) => selected.has(cue.sourceCueId)).map((cue) => cue.id)];
	}, [timeline.selectedRegionIds, projection.effectiveCaptionRegions]);
	const handleSelectCaption = useCallback((id: string | null) => {
		const fragment = id === null ? undefined : captionById.get(id);
		captionCommands.handleSelectCaption(fragment?.sourceCueId ?? null, fragment?.startMs);
	}, [captionById, captionCommands.handleSelectCaption]);
	const handleCaptionSpanChange = useCallback((id: string, span: Span) => {
		const fragment = captionById.get(id);
		if (fragment) captionCommands.handleCaptionRetime(fragment.sourceCueId, retimeCaptionFragment(fragment, span));
	}, [captionById, captionCommands.handleCaptionRetime]);
	const handleCaptionDelete = useCallback((id: string) => {
		const fragment = captionById.get(id);
		if (fragment) captionCommands.handleCaptionDelete(fragment.sourceCueId);
	}, [captionById, captionCommands.handleCaptionDelete]);
	const clearSelection = useCallback(() => {
		timeline.setSelectedRegionIds([]);
		timeline.setSelectedVideoId(null);
	}, [timeline.setSelectedRegionIds, timeline.setSelectedVideoId]);
	const { select, changeSpan, importVideo } = props.videoCommands;
	const videoTrackControls = useMemo(() => ({
		tracks: timeline.videoTracks,
		regions: timeline.videoRegions,
		selectedIds: timeline.selectedRegionIds.length ? timeline.selectedRegionIds : timeline.selectedVideoId ? [timeline.selectedVideoId] : [],
		onSelect: select,
		onChangeSpan: changeSpan,
		onImport: (id: string) => void importVideo(id),
		onTrackChange: (id: string, patch: Partial<(typeof timeline.videoTracks)[number]>) =>
			timeline.setVideoTracks((tracks) => tracks.map((track) => track.id === id ? { ...track, ...patch } : track)),
	}), [timeline.videoTracks, timeline.videoRegions, timeline.selectedRegionIds, timeline.selectedVideoId, timeline.setVideoTracks, select, changeSpan, importVideo]);

	return (
		<div
			ref={props.panelRef}
			inert={props.readOnly}
			tabIndex={-1}
			data-timeline-panel
			data-cut-focused={props.focusRange ? true : undefined}
			className="outline-none flex flex-shrink-0 flex-col bg-transparent px-4 pb-4 pt-2"
			style={{
				height: props.focusRange ? `max(${height}px, min(72vh, calc(100% - 220px)))` : height,
				minHeight: 180, maxHeight: "72vh",
			}}
		>
			{props.focusRange ? <div className="-mx-4 -mt-2 mb-1 border-t border-foreground/10" /> : <div
				role="separator"
				tabIndex={0}
				aria-orientation="horizontal"
				aria-label={t("editor.timeline.resize", "Resize timeline")}
				aria-valuemin={180}
				aria-valuemax={Math.round(window.innerHeight * 0.72)}
				aria-valuenow={Math.round(height)}
				className="group -mx-4 -mt-2 mb-1 flex h-3 shrink-0 cursor-ns-resize touch-none items-center justify-center border-t border-foreground/10 hover:bg-accent/10 focus:bg-accent/10"
				onPointerDown={(event) => {
					resizeStart.current = { y: event.clientY, height };
					event.currentTarget.setPointerCapture(event.pointerId);
				}}
				onPointerMove={(event) => {
					const start = resizeStart.current;
					if (start) setHeight(clampHeight(start.height + start.y - event.clientY));
				}}
				onPointerUp={() => { resizeStart.current = null; }}
				onLostPointerCapture={() => { resizeStart.current = null; }}
				onKeyDown={(event) => {
					if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
					event.preventDefault();
					setHeight(clampHeight(height + (event.key === "ArrowUp" ? 24 : -24)));
				}}
			>
				<span className="h-0.5 w-12 rounded bg-foreground/25 group-hover:bg-accent" />
			</div>}
			<div className="mb-1 flex min-h-8 shrink-0 flex-wrap items-center gap-x-3 gap-y-1 border-b border-foreground/10 px-2 pb-1 whitespace-nowrap">
				{props.focusRange && <button type="button" className="rounded px-2 py-1 text-xs text-accent hover:bg-accent/10"
					onClick={props.onReturnToFullTimeline}>{t("common.interface.reviewReturnToFull")}</button>}
				<input
					aria-label={t("editor.timeline.timecode", "Timeline timecode")}
					className="w-32 rounded bg-foreground/5 px-2 py-1 font-mono text-xs tabular-nums text-accent outline-none focus:ring-1 focus:ring-accent"
					value={timeDraft ?? formatTimelineTimecode(currentTime * 1000)}
					onChange={(event) => setTimeDraft(event.target.value)}
					onFocus={(event) => { setTimeDraft(event.target.value); event.target.select(); }}
					onBlur={() => setTimeDraft(null)}
					onKeyDown={(event) => {
						if (event.key === "Escape") event.currentTarget.blur();
						if (event.key !== "Enter") return;
						const timeMs = parseTimelineTimecode(timeDraft ?? "");
						if (timeMs !== null) playback.handleTimelineSeek(Math.min(timeMs / 1000, projection.timelineDuration));
						event.currentTarget.blur();
					}}
				/>
				<span className="font-mono text-xs tabular-nums text-muted-foreground">/ {formatTimelineTimecode(projection.timelineDuration * 1000)}</span>
				<button type="button" className="rounded px-2 py-1 text-xs hover:bg-foreground/10" onClick={props.sequenceTools.split}>{t("editor.timeline.quickCut", "Split")} <kbd className="ml-1 text-muted-foreground">{formatBinding(shortcuts.splitClip, isMac)}</kbd></button>
				<button type="button" className="rounded px-2 py-1 text-xs hover:bg-foreground/10 disabled:opacity-40" disabled={!props.sequenceTools.hasSelection} onClick={props.sequenceTools.rippleDelete}>{t("editor.timeline.rippleDelete", "Ripple delete")} <kbd className="ml-1 text-muted-foreground">{formatBinding(shortcuts.rippleDelete, isMac)}</kbd></button>
				<button type="button" aria-pressed={props.sequenceTools.forwardSelectionActive} className={`rounded px-2 py-1 text-xs hover:bg-foreground/10 ${props.sequenceTools.forwardSelectionActive ? "bg-accent/20 text-accent" : ""}`} onClick={() => props.sequenceTools.setForwardSelectionActive((active) => !active)}>{t("editor.timeline.selectForward", "Select forward")} <kbd className="ml-1 text-muted-foreground">{formatBinding(shortcuts.selectForward, isMac)}</kbd></button>
				<button type="button" className="rounded px-2 py-1 text-xs hover:bg-foreground/10" onClick={() => timelineRef.current?.addCaption()}>{t("editor.timeline.addCaption", "Add caption")}</button>
				<button type="button" className="ml-auto rounded px-2 py-1 text-xs hover:bg-foreground/10" onClick={() => props.videoCommands.addTrack()}>{t("editor.tracks.add", "+ Video track")}</button>
				<button type="button" className="rounded px-2 py-1 text-xs hover:bg-foreground/10" disabled={props.videoCommands.importing} onClick={() => void props.videoCommands.importVideo()}>{t("editor.tracks.import", "Import B-roll")}</button>
			</div>
			<TimelineEditor
				focusRange={props.focusRange}
				changeMarkers={props.changeMarkers}
				selectedIds={selectedIds}
				onSelectRegions={props.sequenceTools.selectRegions}
				forwardSelectionActive={props.sequenceTools.forwardSelectionActive}
				onForwardSelect={props.sequenceTools.selectForward}
				onClearSelection={clearSelection}
				videoTrackControls={videoTrackControls}
				ref={timelineRef}
				videoDuration={projection.timelineDuration}
				currentTime={currentTime}
				playheadTime={projection.timelinePlayheadTime}
				onSeek={playback.handleTimelineSeek}
				videoPath={videoPath}
				videoSourcePath={videoSourcePath}
				cursorTelemetrySourcePath={cursorTelemetrySourcePath}
				cursorTelemetry={normalizedCursorTelemetry}
				autoSuggestZoomsTrigger={autoSuggestZoomsTrigger}
				onAutoSuggestZoomsConsumed={handleAutoSuggestZoomsConsumed}
				disableSuggestedZooms={disableSuggestedZooms}
				zoomRegions={timeline.zoomRegions}
				onZoomAdded={zoomCommands.handleZoomAdded}
				onZoomSuggested={zoomCommands.handleZoomSuggested}
				onZoomSpanChange={zoomCommands.handleZoomSpanChange}
				onZoomDelete={zoomCommands.handleZoomDelete}
				selectedZoomId={timeline.selectedZoomId}
				onSelectZoom={zoomCommands.handleSelectZoom}
				trimRegions={timeline.trimRegions}
				clipRegions={timeline.clipRegions}
				markers={timeline.markers}
				keystrokeTrack={timeline.recordedKeystrokes.hasEvents ? {
					items: timeline.recordedKeystrokes.items,
					enabled: timeline.keystrokeOverlay.enabled,
					onToggle: props.readOnly ? undefined : () => timeline.setKeystrokeOverlay(current => ({ ...current, enabled: !current.enabled })),
					onHide: props.readOnly ? undefined : (id) => timeline.setKeystrokeOverlay(current => current.hiddenIds.includes(id)
						? current : { ...current, hiddenIds: [...current.hiddenIds, id] }),
				} : undefined}
				onMarkersChange={props.readOnly ? undefined : timeline.setMarkers}
				onClipSplit={() => props.sequenceTools.split()}
				onClipDelete={clipCommands.handleClipDelete}
				onClipSpanChange={clipCommands.handleClipSpanChange}
				selectedClipId={timeline.selectedClipId}
				onSelectClip={clipCommands.handleSelectClip}
				audioRegions={timeline.audioRegions}
				onAudioAdded={audioCommands.handleAudioAdded}
				onAudioSpanChange={audioCommands.handleAudioSpanChange}
				onAudioDelete={audioCommands.handleAudioDelete}
				selectedAudioId={timeline.selectedAudioId}
				onSelectAudio={audioCommands.handleSelectAudio}
				captionRegions={projection.effectiveCaptionRegions}
				onCaptionSpanChange={handleCaptionSpanChange}
				selectedCaptionId={
					selectedCaptionFragments.find(
						(cue) =>
							currentTime * 1000 >= cue.startMs &&
							currentTime * 1000 < cue.endMs,
					)?.id ??
					selectedCaptionFragments[0]?.id ??
					null
				}
				onSelectCaption={handleSelectCaption}
				onCaptionDelete={handleCaptionDelete}
				onCaptionAdded={captionCommands.handleCaptionAdded}
				captionsEnabled={timeline.autoCaptionSettings.enabled}
				captionQuickAddEnabled={timeline.autoCaptionSettings.timelineQuickAdd}
				annotationRegions={timeline.annotationRegions}
				onAnnotationAdded={annotationCommands.handleAnnotationAdded}
				onAnnotationSpanChange={annotationCommands.handleAnnotationSpanChange}
				onAnnotationDelete={annotationCommands.handleAnnotationDelete}
				selectedAnnotationId={timeline.selectedAnnotationId}
				onSelectAnnotation={handleSelectAnnotation}
				showSourceAudioTrack
				sourceAudioResourceVersion={timeline.sourceAudioFallbackRefreshKey}
				sourceAudioVideoDuration={audio.sourceDurationSeconds}
				sourceAudioStartDelayMsByPath={audio.sourceAudioFallbackStartDelayMsByPath}
				sourceAudioTrackSettings={audio.activeSourceAudioTrackSettings}
				getSourceAudioTrackSettingsForClip={audio.getSourceAudioTrackSettingsForClip}
				onSourceAudioRangeDelete={audio.onSourceAudioRangeDelete}
				onSourceAudioAvailabilityChange={timeline.setHasClipSourceAudio}
				onSourceAudioTracksMetaChange={audio.onSourceAudioTracksMetaChange}
			/>
		</div>
	);
}
