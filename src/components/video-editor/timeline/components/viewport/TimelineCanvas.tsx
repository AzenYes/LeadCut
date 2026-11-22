import { uiText } from "@/i18n/uiText";
import type { ChangeReviewMarkers } from "../../../changeLogRestore";
import { useTimelinePresentation } from "../../core/TimelinePresentation";
import { Plus } from "@/components/ui/icons";
import { useDndMonitor } from "@dnd-kit/core";
import { useTimelineContext } from "dnd-timeline";
import {
	type MouseEvent,
	type ReactNode,
	type MouseEventHandler,
	type RefObject,
	memo,
	useCallback,
	useEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import type {
	SourceAudioTrackSettings,
	SourceAudioTrackWithPeaks,
} from "@/components/video-editor/audio/audioTypes";
import { cn } from "@/lib/utils";
import {
	CAPTION_ROW_ID,
	CLIP_ROW_ID,
	SOURCE_AUDIO_ROW_ID,
	ZOOM_ROW_ID,
} from "../../core/constants";
import {
	getAnnotationTrackIndex,
	getAnnotationTrackRowId,
	getAudioTrackIndex,
	getAudioTrackRowId,
	isAnnotationTrackRowId,
	isAudioTrackRowId,
} from "../../core/rows";
import type { TimelineRenderItem } from "../../core/timelineTypes";
import { filterItemsInRange } from "../../core/spans";
import { DEFAULT_CAPTION_DURATION_MS } from "../../hooks/actions/useTimelineCaptionActions";
import { useTimelineAudioPeaks } from "../../hooks/useTimelineAudioPeaks";
import Item from "../../Item";
import glassStyles from "../../ItemGlass.module.css";
import Row from "../../Row";
import {
	type ClipPresentation,
	getEmbeddedCaptionSpan,
	getTimeAtClipSeam,
	getRegionDisplaySpan,
	getPlayheadDisplayTime,
} from "../../core/clipPresentation";
import {
	getTimelineContentMinHeightPx,
	getTimelineRowsMinHeightPx,
	TIMELINE_AXIS_HEIGHT_PX,
} from "../../timelineLayout";
import PlaybackCursor from "../playhead/PlaybackCursor";
import { SourceAudioWaveformLane, WaveformLoadStatus } from "../waveform/SourceAudioWaveform";
import { CaptionOverview, type CaptionOverviewMark, type CaptionOverviewSelection } from "./CaptionOverview";





interface TimelineCanvasProps {
	keystrokeTrack?: KeystrokeTrackControls;
	changeMarkers?: ChangeReviewMarkers;
	onSourceAudioRangeDelete?: (clipId: string, trackId: string, range: { startMs: number; endMs: number }) => void;
	onSelectRegions?: (ids: string[]) => void;
	videoRowCount?: number;
	selectedIds?: string[];
	forwardSelectionActive?: boolean;
	onForwardSelect?: (timeMs: number) => void;
	videoRows?: ReactNode;
	videoPath?: string | null;
	items: TimelineRenderItem[];
	videoDurationMs: number;
	currentTimeMs: number;
	onSeek?: (time: number) => void;
	canPlaceZoomAtMs?: (startMs: number) => boolean;
	onSelectZoom?: (id: string | null) => void;
	onSelectClip?: (id: string | null) => void;
	onSelectAnnotation?: (id: string | null) => void;
	onSelectAudio?: (id: string | null) => void;
	onSelectCaption?: (id: string | null) => void;
	onAddZoomAtMs?: (startMs: number) => void;
	onAddCaptionAtMs?: (startMs: number) => void;
	canPlaceCaptionAtMs?: (startMs: number) => boolean;
	resolveCaptionSpanAtMs?: (startMs: number) => { start: number; end: number } | null;
	captionsEnabled?: boolean;
	captionQuickAddEnabled?: boolean;
	selectedZoomId: string | null;
	selectedClipId?: string | null;
	selectedAnnotationId?: string | null;
	selectedAudioId?: string | null;
	selectedCaptionId?: string | null;
	selectAllBlocksActive?: boolean;
	onClearBlockSelection?: () => void;
	keyframes?: { id: string; time: number }[];
	sourceAudioTracks?: SourceAudioTrackWithPeaks[];
	getSourceAudioTrackSettingsForClip?: (clipId: string | null) => SourceAudioTrackSettings;
	showSourceAudioTrack?: boolean;
	liveSpanPreviewById?: Record<string, { start: number; end: number }>;
	liveHiddenItemIds?: string[];
	isDragging?: boolean;
	isLoading?: boolean;
}

interface LaneHoverParams {
	clipPresentation?: ClipPresentation[];
	direction: string;
	rangeStart: number;
	visibleDurationMs: number;
	videoDurationMs: number;
	valueToPixels: (value: number) => number;
	// Ghost block length to preview under the cursor.
	ghostDurationMs: number;
	// Whether the lane currently accepts adds (e.g. captions only when shown).
	enabled: boolean;
	// Suppress the ghost while a drag/resize is in progress.
	isDragging: boolean;
	onAddAtMs?: (startMs: number) => void;
	canPlaceAtMs?: (startMs: number) => boolean;
	// When set, the ghost previews the exact span an add would produce (clamped to
	// neighbors/end) instead of a fixed ghostDurationMs. Returns null when no add fits.
	resolveGhostSpanMs?: (startMs: number) => { start: number; end: number } | null;
}

/**
 * Hover + click-to-add behaviour for a single timeline lane (zoom, captions, …).
 * Tracks the pointer position over the row and derives the translucent "add"
 * ghost geometry. Lanes differ only by their ghost duration, enabled flag and
 * add/can-place callbacks.
 */
function useTimelineLaneHover({
	clipPresentation,
	direction,
	rangeStart,
	visibleDurationMs,
	videoDurationMs,
	valueToPixels,
	ghostDurationMs,
	enabled,
	isDragging,
	onAddAtMs,
	canPlaceAtMs,
	resolveGhostSpanMs,
}: LaneHoverParams) {
	const [isHovered, setIsHovered] = useState(false);
	const [hoverMs, setHoverMs] = useState<number | null>(null);

	const updateHoverTime = useCallback(
		(clientX: number, rect: DOMRect) => {
			if (rect.width <= 0) return;
			const position =
				direction === "rtl"
					? Math.max(0, Math.min(rect.right - clientX, rect.width))
					: Math.max(0, Math.min(clientX - rect.left, rect.width));
			const ratio = position / rect.width;
			const nextMs = rangeStart + ratio * visibleDurationMs;
			setHoverMs(
				getTimeAtClipSeam(
					Math.max(0, Math.min(nextMs, videoDurationMs)),
					clipPresentation ?? [],
				),
			);
		},
		[direction, rangeStart, videoDurationMs, visibleDurationMs, clipPresentation],
	);

	const onMouseEnter = useCallback(
		(event: MouseEvent<HTMLDivElement>) => {
			setIsHovered(true);
			updateHoverTime(event.clientX, event.currentTarget.getBoundingClientRect());
		},
		[updateHoverTime],
	);

	const onMouseMove = useCallback(
		(event: MouseEvent<HTMLDivElement>) => {
			setIsHovered(true);
			updateHoverTime(event.clientX, event.currentTarget.getBoundingClientRect());
		},
		[updateHoverTime],
	);

	const onMouseLeave = useCallback(() => {
		setIsHovered(false);
		setHoverMs(null);
	}, []);

	const onMouseDown = useCallback((event: MouseEvent<HTMLDivElement>) => {
		event.stopPropagation();
	}, []);

	const onClick = useCallback(
		(event: MouseEvent<HTMLDivElement>) => {
			event.stopPropagation();
			// Respect the lane's enabled flag so a hidden ghost can't still add on click.
			if (!enabled || isDragging || !onAddAtMs || event.button !== 0) return;
			if ((event.target as HTMLElement).closest("[data-timeline-item]")) return;
			const rect = event.currentTarget.getBoundingClientRect();
			if (rect.width <= 0) return;
			const x = direction === "rtl" ? rect.right - event.clientX : event.clientX - rect.left;
			const startMs = getTimeAtClipSeam(
				Math.max(
					0,
					Math.min(rangeStart + (x / rect.width) * visibleDurationMs, videoDurationMs),
				),
				clipPresentation ?? [],
			);
			if (canPlaceAtMs && !canPlaceAtMs(startMs)) return;
			onAddAtMs(startMs);
		},
		[
			clipPresentation,
			enabled,
			isDragging,
			direction,
			rangeStart,
			visibleDurationMs,
			canPlaceAtMs,
			onAddAtMs,
			videoDurationMs,
		],
	);

	const reset = useCallback(() => {
		setIsHovered(false);
		setHoverMs(null);
	}, []);

	const clampedHoverMs =
		hoverMs === null ? null : Math.max(0, Math.min(hoverMs, videoDurationMs));
	// When a resolver is supplied, preview the exact span the add would create (clamped to
	// the next item / end of timeline); otherwise fall back to a fixed-length ghost.
	const resolvedSpan =
		resolveGhostSpanMs && clampedHoverMs !== null ? resolveGhostSpanMs(clampedHoverMs) : null;
	const ghostStartMs =
		clampedHoverMs === null ? null : resolvedSpan ? resolvedSpan.start : clampedHoverMs;
	const ghostEndMs =
		ghostStartMs === null
			? null
			: resolvedSpan
				? resolvedSpan.end
				: Math.max(ghostStartMs, Math.min(videoDurationMs, ghostStartMs + ghostDurationMs));
	const ghostStartOffsetPx =
		ghostStartMs === null ? 0 : valueToPixels(Math.max(0, ghostStartMs - rangeStart));
	const ghostEndOffsetPx =
		ghostEndMs === null ? 0 : valueToPixels(Math.max(0, ghostEndMs - rangeStart));
	const ghostWidthPx = Math.max(18, ghostEndOffsetPx - ghostStartOffsetPx);
	const canShowGhost =
		!isDragging &&
		enabled &&
		isHovered &&
		ghostStartMs !== null &&
		(resolveGhostSpanMs
			? resolvedSpan !== null
			: onAddAtMs
				? (canPlaceAtMs?.(ghostStartMs) ?? true)
				: false);

	return {
		reset,
		ghostStartMs,
		ghostWidthPx,
		canShowGhost,
		onMouseEnter,
		onMouseMove,
		onMouseLeave,
		onMouseDown,
		onClick,
	};
}

interface TimelineHoverParams {
	clipPresentation: ClipPresentation[];
	direction: string;
	sidebarWidth: number;
	rangeStart: number;
	rangeEnd: number;
	videoDurationMs: number;
	onAddZoomAtMs?: (startMs: number) => void;
	canPlaceZoomAtMs?: (startMs: number) => boolean;
	onAddCaptionAtMs?: (startMs: number) => void;
	canPlaceCaptionAtMs?: (startMs: number) => boolean;
	resolveCaptionSpanAtMs?: (startMs: number) => { start: number; end: number } | null;
	captionsEnabled?: boolean;
	captionQuickAddEnabled?: boolean;
	isDragging: boolean;
	valueToPixels: (value: number) => number;
}

function useTimelineHover({
	clipPresentation,
	direction,
	sidebarWidth,
	rangeStart,
	rangeEnd,
	videoDurationMs,
	onAddZoomAtMs,
	canPlaceZoomAtMs,
	onAddCaptionAtMs,
	canPlaceCaptionAtMs,
	resolveCaptionSpanAtMs,
	captionsEnabled,
	captionQuickAddEnabled = true,
	isDragging,
	valueToPixels,
}: TimelineHoverParams) {
	const [isTimelineHovered, setIsTimelineHovered] = useState(false);
	const [timelineHoverMs, setTimelineHoverMs] = useState<number | null>(null);

	const visibleDurationMs = Math.max(1, rangeEnd - rangeStart);

	const updateTimelineHoverTime = useCallback(
		(clientX: number, rect: DOMRect) => {
			const contentWidth = Math.max(1, rect.width - sidebarWidth);
			const contentX =
				direction === "rtl"
					? rect.right - sidebarWidth - clientX
					: clientX - rect.left - sidebarWidth;
			const clampedX = Math.max(0, Math.min(contentX, contentWidth));
			const ratio = clampedX / contentWidth;
			const nextMs = rangeStart + ratio * visibleDurationMs;
			setTimelineHoverMs(
				getTimeAtClipSeam(Math.max(0, Math.min(nextMs, videoDurationMs)), clipPresentation),
			);
		},
		[direction, rangeStart, sidebarWidth, videoDurationMs, visibleDurationMs, clipPresentation],
	);

	const handleTimelineMouseEnter = useCallback(
		(event: MouseEvent<HTMLDivElement>) => {
			setIsTimelineHovered(true);
			updateTimelineHoverTime(event.clientX, event.currentTarget.getBoundingClientRect());
		},
		[updateTimelineHoverTime],
	);

	const handleTimelineMouseMove = useCallback(
		(event: MouseEvent<HTMLDivElement>) => {
			if (!isTimelineHovered) setIsTimelineHovered(true);
			updateTimelineHoverTime(event.clientX, event.currentTarget.getBoundingClientRect());
		},
		[isTimelineHovered, updateTimelineHoverTime],
	);

	const zoom = useTimelineLaneHover({
		clipPresentation,
		direction,
		rangeStart,
		visibleDurationMs,
		videoDurationMs,
		valueToPixels,
		ghostDurationMs: Math.min(1000, videoDurationMs),
		enabled: false,
		isDragging,
		onAddAtMs: onAddZoomAtMs,
		canPlaceAtMs: canPlaceZoomAtMs,
	});

	const caption = useTimelineLaneHover({
		clipPresentation,
		direction,
		rangeStart,
		visibleDurationMs,
		videoDurationMs,
		valueToPixels,
		ghostDurationMs: Math.min(DEFAULT_CAPTION_DURATION_MS, videoDurationMs),
		enabled: Boolean(captionsEnabled) && captionQuickAddEnabled,
		isDragging,
		onAddAtMs: onAddCaptionAtMs,
		canPlaceAtMs: canPlaceCaptionAtMs,
		resolveGhostSpanMs: resolveCaptionSpanAtMs,
	});

	const handleTimelineMouseLeave = useCallback(() => {
		setIsTimelineHovered(false);
		setTimelineHoverMs(null);
		zoom.reset();
		caption.reset();
	}, [zoom.reset, caption.reset]);

	const timelineGhostOffsetPx =
		timelineHoverMs === null
			? 0
			: valueToPixels(
					Math.max(
						0,
						getPlayheadDisplayTime(timelineHoverMs, clipPresentation) - rangeStart,
					),
				);
	const canShowGhostPlayhead = isTimelineHovered && timelineHoverMs !== null;

	return {
		canShowGhostPlayhead,
		timelineGhostOffsetPx,
		handleTimelineMouseEnter,
		handleTimelineMouseMove,
		handleTimelineMouseLeave,
		canShowGhostZoom: zoom.canShowGhost,
		ghostStartMs: zoom.ghostStartMs,
		ghostWidthPx: zoom.ghostWidthPx,
		handleZoomRowMouseEnter: zoom.onMouseEnter,
		handleZoomRowMouseMove: zoom.onMouseMove,
		handleZoomRowMouseLeave: zoom.onMouseLeave,
		handleZoomRowMouseDown: zoom.onMouseDown,
		handleZoomRowClick: zoom.onClick,
		canShowGhostCaption: caption.canShowGhost,
		captionGhostStartMs: caption.ghostStartMs,
		captionGhostWidthPx: caption.ghostWidthPx,
		handleCaptionRowMouseEnter: caption.onMouseEnter,
		handleCaptionRowMouseMove: caption.onMouseMove,
		handleCaptionRowMouseLeave: caption.onMouseLeave,
		handleCaptionRowMouseDown: caption.onMouseDown,
		handleCaptionRowClick: caption.onClick,
	};
}

interface TimelineCanvasRowsProps {
	captionOverviewSelectionRef: RefObject<CaptionOverviewSelection | null>;
	changeMarkers?: ChangeReviewMarkers;
	onSourceAudioRangeDelete?: TimelineCanvasProps["onSourceAudioRangeDelete"];
	onSeek?: (time: number) => void;
	selectedIds?: string[];
	videoRows?: ReactNode;
	videoPath?: string | null;
	items: TimelineRenderItem[];
	videoDurationMs: number;
	selectAllBlocksActive: boolean;
	selectedZoomId: string | null;
	selectedClipId?: string | null;
	selectedAnnotationId?: string | null;
	selectedAudioId?: string | null;
	selectedCaptionId?: string | null;
	onSelectZoom?: (id: string | null) => void;
	onSelectClip?: (id: string | null) => void;
	onSelectAnnotation?: (id: string | null) => void;
	onSelectAudio?: (id: string | null) => void;
	onSelectCaption?: (id: string | null) => void;
	sourceAudioTracks?: SourceAudioTrackWithPeaks[];
	getSourceAudioTrackSettingsForClip?: (clipId: string | null) => SourceAudioTrackSettings;
	showSourceAudioTrack?: boolean;
	liveSpanPreviewById?: Record<string, { start: number; end: number }>;
	liveHiddenItemIds?: string[];
	direction: string;
	canShowGhostZoom: boolean;
	ghostStartMs: number | null;
	ghostWidthPx: number;
	onZoomRowMouseEnter: MouseEventHandler<HTMLDivElement>;
	onZoomRowMouseMove: MouseEventHandler<HTMLDivElement>;
	onZoomRowMouseLeave: MouseEventHandler<HTMLDivElement>;
	onZoomRowMouseDown: MouseEventHandler<HTMLDivElement>;
	onZoomRowClick: MouseEventHandler<HTMLDivElement>;
	captionsEnabled?: boolean;
	canShowGhostCaption: boolean;
	captionGhostStartMs: number | null;
	captionGhostWidthPx: number;
	onCaptionRowMouseEnter: MouseEventHandler<HTMLDivElement>;
	onCaptionRowMouseMove: MouseEventHandler<HTMLDivElement>;
	onCaptionRowMouseLeave: MouseEventHandler<HTMLDivElement>;
	onCaptionRowMouseDown: MouseEventHandler<HTMLDivElement>;
	onCaptionRowClick: MouseEventHandler<HTMLDivElement>;
}

interface AudioItemWithWaveformProps {
	item: TimelineRenderItem;
	span: { start: number; end: number };
	waveformSpan: { start: number; end: number };
	isSelected: boolean;
	onSelectAudio?: (id: string | null) => void;
}

const AudioItemWithWaveform = memo(function AudioItemWithWaveform({
	item,
	span,
	waveformSpan,
	isSelected,
	onSelectAudio,
}: AudioItemWithWaveformProps) {
	const waveform = useTimelineAudioPeaks(item.audioPath ?? null);
	const normalizedWaveformSpan = useMemo(() => {
		const duration = Math.max(0, waveformSpan.end - waveformSpan.start);
		return item.sourceSpan ?? { start: 0, end: duration };
	}, [waveformSpan.end, waveformSpan.start, item.sourceSpan]);
	return (
		<Item
			id={item.id}
			rowId={item.rowId}
			span={span}
			isSelected={isSelected}
			onSelectId={onSelectAudio}
			variant="audio"
			waveformPeaks={waveform.peaks}
			waveformSegmentSpan={normalizedWaveformSpan}
			waveformGain={Math.max(0, Math.min(1, item.audioGain ?? 1))}
			waveformNormalize={Boolean(item.audioNormalize)}
		>
			{item.label}
			<WaveformLoadStatus {...waveform} />
		</Item>
	);
});

function focusCaptionText() {
	const editor = document.querySelector<HTMLTextAreaElement>("[data-caption-text-editor]");
	editor?.focus();
	editor?.select();
}

const CaptionTimelineItem = memo(function CaptionTimelineItem({
	item,
	presentation,
	selected,
	onSelect,
}: {
	item: TimelineRenderItem;
	presentation: ClipPresentation[];
	selected: boolean;
	onSelect?: (id: string | null) => void;
}) {
	const displaySpan = getEmbeddedCaptionSpan(item.span, presentation);
	if (!displaySpan) return null;
	return (
		<Item
			id={item.id}
			rowId={item.rowId}
			span={item.span}
			isSelected={selected}
			onSelectId={onSelect}
			onDoubleClick={focusCaptionText}
			variant="caption"
			clipPresentation={presentation}
			displaySpan={displaySpan}
		>
			{item.label}
		</Item>
	);
});

const TimelineCanvasRows = memo(function TimelineCanvasRows({
	captionOverviewSelectionRef,
	changeMarkers,
	getSourceAudioTrackSettingsForClip,
	onSourceAudioRangeDelete,
	onSeek,
	selectedIds = [],
	videoRows,
	videoPath,
	items,
	selectAllBlocksActive,
	selectedZoomId,
	selectedClipId,
	selectedAnnotationId,
	selectedAudioId,
	selectedCaptionId,
	onSelectZoom,
	onSelectClip,
	onSelectAnnotation,
	onSelectAudio,
	onSelectCaption,
	sourceAudioTracks = [],
	showSourceAudioTrack = false,
	liveSpanPreviewById,
	liveHiddenItemIds,
	direction,
	canShowGhostZoom,
	ghostStartMs,
	ghostWidthPx,
	onZoomRowMouseEnter,
	onZoomRowMouseMove,
	onZoomRowMouseLeave,
	onZoomRowMouseDown,
	onZoomRowClick,
	captionsEnabled = false,
	canShowGhostCaption,
	captionGhostStartMs,
	captionGhostWidthPx,
	onCaptionRowMouseEnter,
	onCaptionRowMouseMove,
	onCaptionRowMouseLeave,
	onCaptionRowMouseDown,
	onCaptionRowClick,
}: TimelineCanvasRowsProps) {
	const {
		pixelsToValue,
		valueToPixels,
		range,
	} = useTimelineContext();
	const rangeStart = range.start;
	const [activeId, setActiveId] = useState<string | null>(null);
	const [inspectedCaptionId, setInspectedCaptionId] = useState<string | null>(null);
	useDndMonitor({
		onDragStart: ({ active }) => {
			if (typeof active.id === "string") setActiveId(active.id);
		},
		onDragEnd: () => setActiveId(null),
		onDragCancel: () => setActiveId(null),
	});
	const selected = useMemo(() => new Set(selectedIds), [selectedIds]);
	const keepIds = useMemo(() => {
		const kept = new Set(selected);
		for (const id of [selectedZoomId, selectedClipId, selectedAnnotationId, selectedAudioId, selectedCaptionId, activeId]) {
			if (typeof id === "string") kept.add(id);
		}
		return kept;
	}, [selected, selectedZoomId, selectedClipId, selectedAnnotationId, selectedAudioId, selectedCaptionId, activeId]);
	const overscanMs = range.end - range.start;
	const hiddenIds = useMemo(() => new Set(liveHiddenItemIds ?? []), [liveHiddenItemIds]);
	const { clipItems, zoomItems, captionItems, annotationRows, audioRows } = useMemo(() => {
		const nextClipItems: TimelineRenderItem[] = [];
		const nextZoomItems: TimelineRenderItem[] = [];
		const nextCaptionItems: TimelineRenderItem[] = [];
		const annotationBuckets = new Map<number, TimelineRenderItem[]>();
		const audioBuckets = new Map<number, TimelineRenderItem[]>();

		for (const item of items) {
			if (item.rowId === CLIP_ROW_ID) {
				nextClipItems.push(item);
				continue;
			}
			if (item.rowId === ZOOM_ROW_ID) {
				nextZoomItems.push(item);
				continue;
			}
			if (item.rowId === CAPTION_ROW_ID) {
				nextCaptionItems.push(item);
				continue;
			}
			if (isAnnotationTrackRowId(item.rowId)) {
				const trackIndex = getAnnotationTrackIndex(item.rowId);
				const bucket = annotationBuckets.get(trackIndex);
				if (bucket) bucket.push(item);
				else annotationBuckets.set(trackIndex, [item]);
				continue;
			}
			if (isAudioTrackRowId(item.rowId)) {
				const trackIndex = getAudioTrackIndex(item.rowId);
				const bucket = audioBuckets.get(trackIndex);
				if (bucket) bucket.push(item);
				else audioBuckets.set(trackIndex, [item]);
			}
		}

		const annotationRowsSorted = Array.from(annotationBuckets.entries())
			.sort(([left], [right]) => left - right)
			.map(([trackIndex, rowItems]) => ({
				rowId: getAnnotationTrackRowId(trackIndex),
				items: rowItems,
			}));
		const audioRowsSorted = Array.from(audioBuckets.entries())
			.sort(([left], [right]) => left - right)
			.map(([trackIndex, rowItems]) => ({
				rowId: getAudioTrackRowId(trackIndex),
				items: rowItems,
			}));

		return {
			clipItems: nextClipItems,
			zoomItems: nextZoomItems,
			captionItems: nextCaptionItems,
			annotationRows: annotationRowsSorted,
			audioRows: audioRowsSorted,
		};
	}, [items]);
	const visibleCaptions = useMemo(
		() => filterItemsInRange(captionItems, range, overscanMs, keepIds),
		[captionItems, range, overscanMs, keepIds],
	);
	const visibleZooms = useMemo(
		() => filterItemsInRange(zoomItems, range, overscanMs, keepIds),
		[zoomItems, range, overscanMs, keepIds],
	);
	const denseCaptions = visibleCaptions.length > 200;
	const denseClips = clipItems.length > 100;

	const { clips } = useTimelinePresentation();
	const clipPresentation = useMemo(
		() =>
			clipItems.map((item) => ({
				...item,
				displaySpan: getRegionDisplaySpan(item.span, clips),
			})),
		[clipItems, clips],
	);
	const visibleClips = useMemo(
		() => filterItemsInRange(clipPresentation, range, overscanMs, keepIds),
		[clipPresentation, range, overscanMs, keepIds],
	);
	const embeddedCaptionIds = useMemo(() => {
		if (captionItems.length <= 200) return null;
		const ids = new Set<string>();
		for (const item of captionItems) {
			if (getEmbeddedCaptionSpan(item.span, clipPresentation)) ids.add(item.id);
		}
		return ids;
	}, [captionItems, clipPresentation]);
	const { captionMarks, interactiveCaptions } = useMemo(() => {
		const captionMarks: CaptionOverviewMark[] = [];
		const interactiveCaptions: TimelineRenderItem[] = [];
		for (const item of visibleCaptions) {
			const width = valueToPixels(item.span.end - item.span.start);
			if (denseCaptions && width < 24 && item.id !== inspectedCaptionId && !keepIds.has(item.id)) {
				if (embeddedCaptionIds?.has(item.id)) {
					captionMarks.push({
						id: item.id,
						offset: valueToPixels(item.span.start - rangeStart),
						width: Math.max(1, width),
					});
				}
			} else {
				interactiveCaptions.push(item);
			}
		}
		return { captionMarks, interactiveCaptions };
	}, [visibleCaptions, valueToPixels, denseCaptions, inspectedCaptionId, keepIds, embeddedCaptionIds, rangeStart]);
	const clipBoundaries = useMemo(() => {
		const starts = new Map<number, (typeof clipPresentation)[number]>();
		const ends = new Set<number>();
		for (const item of clipPresentation) {
			if (!starts.has(item.span.start)) starts.set(item.span.start, item);
			ends.add(item.span.end);
		}
		return { starts, ends };
	}, [clipPresentation]);

	const zoomGhost =
		ghostStartMs === null
			? null
			: getRegionDisplaySpan(
					{ start: ghostStartMs, end: ghostStartMs + pixelsToValue(ghostWidthPx) },
					clipPresentation,
				);
	const zoomGhostOffsetPx = zoomGhost ? valueToPixels(zoomGhost.start - rangeStart) : 0;
	const zoomGhostWidthPx = zoomGhost ? valueToPixels(zoomGhost.end - zoomGhost.start) : 0;
	const embeddedGhost =
		captionGhostStartMs === null
			? null
			: getEmbeddedCaptionSpan(
					{
						start: captionGhostStartMs,
						end: captionGhostStartMs + pixelsToValue(captionGhostWidthPx),
					},
					clipPresentation,
				);
	const embeddedGhostOffset = embeddedGhost ? valueToPixels(embeddedGhost.start - rangeStart) : 0;
	const embeddedGhostWidth = embeddedGhost
		? valueToPixels(embeddedGhost.end - embeddedGhost.start)
		: 0;

	return (
		<>
			{(captionsEnabled || captionItems.length > 0) && (
				<Row
					id={CAPTION_ROW_ID}
					isEmpty={captionItems.length === 0}
					onMouseEnter={onCaptionRowMouseEnter}
					onMouseMove={onCaptionRowMouseMove}
					onMouseLeave={onCaptionRowMouseLeave}
					onMouseDown={onCaptionRowMouseDown}
					onClick={onCaptionRowClick}
				>
					{visibleClips.map((clip) => (
						<div
							key={clip.id}
							data-caption-add-target
							className="absolute inset-y-0 pointer-events-auto"
							style={{
								[direction === "rtl" ? "right" : "left"]: valueToPixels(
									clip.displaySpan.start - rangeStart,
								),
								width: valueToPixels(clip.displaySpan.end - clip.displaySpan.start),
							}}
						/>
					))}

					{canShowGhostCaption && embeddedGhost && (
						<div
							data-testid="timeline-add-preview"
							className="absolute inset-0 z-[3] pointer-events-none"
						>
							<div
								className="absolute top-1/2 -translate-y-1/2 h-[85%] min-h-[18px]"
								style={
									direction === "rtl"
										? {
												right: `${embeddedGhostOffset}px`,
												width: `${embeddedGhostWidth}px`,
											}
										: {
												left: `${embeddedGhostOffset}px`,
												width: `${embeddedGhostWidth}px`,
											}
								}
							>
								<div
									className={cn(
										glassStyles.glassCaption,
										glassStyles.embeddedCaption,
										"w-full h-full overflow-hidden flex items-center justify-center cursor-default relative opacity-80",
									)}
								>
									<div className="relative z-10 inline-flex h-4 w-4 items-center justify-center rounded-full border border-white/45 bg-white/15 text-white">
										<Plus className="h-2.5 w-2.5" />
									</div>
								</div>
							</div>
						</div>
					)}
					{captionMarks.length > 0 && (
						<CaptionOverview
							marks={captionMarks}
							rtl={direction === "rtl"}
							selectionRef={captionOverviewSelectionRef}
							onInspect={setInspectedCaptionId}
							onSelect={onSelectCaption}
						/>
					)}
					{interactiveCaptions.map(item => (
						<CaptionTimelineItem
							key={item.id}
							item={item}
							presentation={clipPresentation}
							selected={item.id === selectedCaptionId || selected.has(item.id)}
							onSelect={onSelectCaption}
						/>
					))}
				</Row>
			)}
			{videoRows}
			<Row filmstrip id={CLIP_ROW_ID} isEmpty={clipItems.length === 0} hint={uiText("pressCToSplitClip")}>
				{visibleClips.map((item) => (
					<Item
						id={item.id}
						key={item.id}
						rowId={item.rowId}
						span={item.span}
						isSelected={item.id === selectedClipId || selected.has(item.id)}
						onSelectId={onSelectClip}
						variant="clip"
						compact={denseClips && item.id !== selectedClipId && !keepIds.has(item.id) &&
							(item.speedValue ?? 1) === 1 && valueToPixels(item.span.end - item.span.start) < 24}
						displaySpan={item.displaySpan}
						sharedLeftGrip={clipBoundaries.ends.has(item.span.start)}
						sharedRightGrip={clipBoundaries.starts.has(item.span.end)}
						videoPath={videoPath}
						sourceSpan={item.sourceSpan ?? item.span}
						speedValue={item.speedValue}
					>
						{item.label}
					</Item>
				))}
				{visibleClips.map((left) => {
					const right = clipBoundaries.starts.get(left.span.end);
					if (!right) return null;
					const seam = (left.displaySpan.end + right.displaySpan.start) / 2;
					const confidence = changeMarkers?.get(Math.round(right.span.start));
					return (
						<div
							key={`seam-${left.id}`}
							data-testid="clip-seam-grip"
							aria-hidden="true"
							className={cn(glassStyles.zoomEndCap, glassStyles.clipHandle)}
							style={{
								height: "59.5%",
								pointerEvents: "none",
								[direction === "rtl" ? "right" : "left"]:
									valueToPixels(seam - rangeStart) - 2,
							}}
						>
							{confidence && (
								<span data-testid="cut-marker" data-confidence={confidence}
									className={cn("absolute -top-1 left-1/2 size-2 -translate-x-1/2 rounded-full ring-1 ring-editor-surface",
										confidence === "low" ? "bg-danger" : confidence === "medium" ? "bg-warning" :
											confidence === "high" ? "bg-success" : "bg-muted-foreground")} />
							)}
						</div>
					);
				})}
			</Row>
			{showSourceAudioTrack &&
				sourceAudioTracks.map((track) => (
					<Row key={track.id} id={`${SOURCE_AUDIO_ROW_ID}-${track.id}`} label={track.label} labelColor="currentColor">
						<SourceAudioWaveformLane
							track={track}
							clips={visibleClips}
							selectedClipId={selectedClipId}
							getSettingForClip={getSourceAudioTrackSettingsForClip}
							onDeleteRange={onSourceAudioRangeDelete}
							onSeek={onSeek}
						/>
					</Row>
				))}

			<Row
				id={ZOOM_ROW_ID}
				compact={
					annotationRows.length +
						audioRows.length +
						(captionsEnabled || captionItems.length > 0 ? 1 : 0) +
						(showSourceAudioTrack ? sourceAudioTracks.length : 0) >
					0
				}
				isEmpty={zoomItems.length === 0}
				onMouseEnter={onZoomRowMouseEnter}
				onMouseMove={onZoomRowMouseMove}
				onMouseLeave={onZoomRowMouseLeave}
				onMouseDown={onZoomRowMouseDown}
				onClick={onZoomRowClick}
			>
				{canShowGhostZoom && ghostStartMs !== null && (
					<div
						data-testid="timeline-add-preview"
						className="absolute inset-0 z-[3] pointer-events-none"
					>
						<div
							className="absolute top-1/2 -translate-y-1/2 h-[85%] min-h-[22px]"
							style={
								direction === "rtl"
									? {
											right: `${zoomGhostOffsetPx}px`,
											width: `${zoomGhostWidthPx}px`,
										}
									: {
											left: `${zoomGhostOffsetPx}px`,
											width: `${zoomGhostWidthPx}px`,
										}
							}
						>
							<div
								className={cn(
									glassStyles.glassBlue,
									"w-full h-full overflow-hidden flex items-center justify-center cursor-default relative opacity-80",
								)}
							>
								<div className={cn(glassStyles.zoomEndCap, glassStyles.left)} />
								<div className={cn(glassStyles.zoomEndCap, glassStyles.right)} />
								<div className="relative z-10 inline-flex h-4 w-4 items-center justify-center rounded-full border border-white/45 bg-white/15 text-white">
									<Plus className="h-2.5 w-2.5" />
								</div>
							</div>
						</div>
					</div>
				)}
				{visibleZooms
					.filter((item) => !hiddenIds.has(item.id))
					.map((item) => (
						<Item
							id={item.id}
							key={item.id}
							rowId={item.rowId}
							span={item.span}
							isSelected={selectAllBlocksActive || item.id === selectedZoomId || selected.has(item.id)}
							onSelectId={onSelectZoom}
							zoomDepth={item.zoomDepth}
							zoomMode={item.zoomMode}
							variant="zoom"
						>
							{item.label}
						</Item>
					))}
			</Row>

			{annotationRows.map(({ rowId, items: rowItems }, index) => (
				<Row
					key={rowId}
					id={rowId}
					isEmpty={rowItems.length === 0}
					hint={index === 0 ? uiText("pressAToAddAnnotation") : undefined}
				>
					{filterItemsInRange(rowItems, range, overscanMs, keepIds).map((item) => (
						<Item
							id={item.id}
							key={item.id}
							rowId={item.rowId}
							span={item.span}
							isSelected={item.id === selectedAnnotationId || selected.has(item.id)}
							onSelectId={onSelectAnnotation}
							variant="annotation"
						>
							{item.label}
						</Item>
					))}
				</Row>
			))}

			{audioRows.map(({ rowId, items: rowItems }, index) => (
				<Row
					key={rowId}
					id={rowId}
					isEmpty={rowItems.length === 0}
					hint={index === 0 ? uiText("clickMusicIconToAddAudio") : undefined}
				>
					{filterItemsInRange(rowItems, range, overscanMs, keepIds).map((item) => (
						<AudioItemWithWaveform
							key={item.id}
							item={item}
							span={item.span}
							waveformSpan={liveSpanPreviewById?.[item.id] ?? item.span}
							isSelected={item.id === selectedAudioId || selected.has(item.id)}
							onSelectAudio={onSelectAudio}
						/>
					))}
				</Row>
			))}
		</>
	);
});

export default function TimelineCanvas({
	keystrokeTrack,
	changeMarkers,
	onSourceAudioRangeDelete,
	onSelectRegions,
	videoRowCount = 0,
	selectedIds = [],
	forwardSelectionActive = false,
	onForwardSelect,
	videoRows,
	videoPath,
	items,
	videoDurationMs,
	currentTimeMs,
	onSeek,
	onAddZoomAtMs,
	canPlaceZoomAtMs,
	onAddCaptionAtMs,
	canPlaceCaptionAtMs,
	resolveCaptionSpanAtMs,
	captionsEnabled,
	captionQuickAddEnabled,
	onSelectZoom,
	onSelectClip,
	onSelectAnnotation,
	onSelectAudio,
	onSelectCaption,
	selectedZoomId,
	selectedClipId,
	selectedAnnotationId,
	selectedAudioId,
	selectedCaptionId,
	selectAllBlocksActive = false,
	onClearBlockSelection,
	keyframes = [],
	sourceAudioTracks = [],
	getSourceAudioTrackSettingsForClip,
	showSourceAudioTrack = false,
	liveSpanPreviewById,
	liveHiddenItemIds,
	isDragging = false,
	isLoading = false,
}: TimelineCanvasProps) {
	const { setTimelineRef, style, sidebarWidth, direction, range, valueToPixels, pixelsToValue } =
		useTimelineContext();
	const { clips: clipPresentation } = useTimelinePresentation();
	const localTimelineRef = useRef<HTMLDivElement | null>(null);
	const captionOverviewSelectionRef = useRef<CaptionOverviewSelection | null>(null);
	const [isSeeking, setIsSeeking] = useState(false);
	const [marquee, setMarquee] = useState<{ x: number; y: number; width: number; height: number } | null>(null);
	const selectionDrag = useRef<{ x: number; y: number; moved: boolean; additive: string[] } | null>(null);
	const suppressClick = useRef(false);
	useEffect(() => {
		const move = (event: PointerEvent) => {
			const start = selectionDrag.current;
			const canvas = localTimelineRef.current;
			if (!start || !canvas) return;
			if (Math.hypot(event.clientX - start.x, event.clientY - start.y) < 4 && !start.moved) return;
			start.moved = true;
			const left = Math.min(start.x, event.clientX), top = Math.min(start.y, event.clientY);
			const right = Math.max(start.x, event.clientX), bottom = Math.max(start.y, event.clientY);
			const bounds = canvas.getBoundingClientRect();
			setMarquee({ x: left - bounds.left, y: top - bounds.top, width: right - left, height: bottom - top });
			const ids = Array.from(canvas.querySelectorAll<HTMLElement>('[data-region-id]:not([data-locked="true"]),[data-source-audio-clip]')).filter((node) => {
				const rect = node.getBoundingClientRect();
				return rect.width > 0 && rect.height > 0 && rect.left < right && rect.right > left && rect.top < bottom && rect.bottom > top;
			}).map((node) => node.dataset.regionId ?? node.dataset.sourceAudioClip!);
			const overviewIds = captionOverviewSelectionRef.current?.({ left, right, top, bottom }) ?? [];
			onSelectRegions?.([...new Set([...start.additive, ...ids, ...overviewIds])]);
		};
		const end = () => {
			if (selectionDrag.current?.moved) suppressClick.current = true;
			selectionDrag.current = null;
			setMarquee(null);
		};
		window.addEventListener("pointermove", move);
		window.addEventListener("pointerup", end);
		window.addEventListener("pointercancel", end);
		return () => { window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", end); window.removeEventListener("pointercancel", end); };
	}, [onSelectRegions]);
	const seekRafRef = useRef<number | null>(null);
	const pendingSeekClientXRef = useRef<number | null>(null);

	const setRefs = useCallback(
		(node: HTMLDivElement | null) => {
			setTimelineRef(node);
			localTimelineRef.current = node;
		},
		[setTimelineRef],
	);

	const handleTimelineClick = useCallback(
		(e: MouseEvent<HTMLDivElement>) => {
			if (suppressClick.current) { suppressClick.current = false; return; }
			if (isSeeking || (e.target as Element).closest("[data-timeline-item]")) return;
			if (!onSeek || videoDurationMs <= 0) return;

			if (onClearBlockSelection) {
				onClearBlockSelection();
			} else {
				onSelectZoom?.(null);
				onSelectClip?.(null);
				onSelectAnnotation?.(null);
				onSelectAudio?.(null);
				onSelectCaption?.(null);
			}

			const rect = e.currentTarget.getBoundingClientRect();
			const clickX =
				direction === "rtl"
					? rect.right - sidebarWidth - e.clientX
					: e.clientX - rect.left - sidebarWidth;
			if (clickX < 0) return;
			const relativeMs = pixelsToValue(clickX);
			const absoluteMs = Math.max(0, Math.min(range.start + relativeMs, videoDurationMs));
			onSeek(getTimeAtClipSeam(absoluteMs, clipPresentation) / 1000);
		},
		[
			isSeeking,
			clipPresentation,
			onSeek,
			onSelectZoom,
			onSelectClip,
			onSelectAnnotation,
			onSelectAudio,
			onSelectCaption,
			onClearBlockSelection,
			videoDurationMs,
			sidebarWidth,
			direction,
			range.start,
			pixelsToValue,
		],
	);

	const getAbsoluteMsFromClientX = useCallback(
		(clientX: number, rect: DOMRect) => {
			const clickX =
				direction === "rtl"
					? rect.right - sidebarWidth - clientX
					: clientX - rect.left - sidebarWidth;
			const relativeMs = pixelsToValue(clickX);
			return getTimeAtClipSeam(
				Math.max(0, Math.min(range.start + relativeMs, videoDurationMs)),
				clipPresentation,
			);
		},
		[direction, pixelsToValue, range.start, sidebarWidth, videoDurationMs, clipPresentation],
	);

	const handleTimelineMouseDown = useCallback(
		(e: MouseEvent<HTMLDivElement>) => {
			if (e.button !== 0 || !onSeek || videoDurationMs <= 0 || !localTimelineRef.current)
				return;
			if ((e.target as HTMLElement).closest("[data-timeline-item]")) {
				return;
			}

			if (onClearBlockSelection) {
				onClearBlockSelection();
			} else {
				onSelectZoom?.(null);
				onSelectClip?.(null);
				onSelectAnnotation?.(null);
				onSelectAudio?.(null);
				onSelectCaption?.(null);
			}

			const rect = localTimelineRef.current.getBoundingClientRect();
			onSeek(getAbsoluteMsFromClientX(e.clientX, rect) / 1000);
			setIsSeeking(true);
			e.preventDefault();
		},
		[
			getAbsoluteMsFromClientX,
			onClearBlockSelection,
			onSeek,
			onSelectAnnotation,
			onSelectAudio,
			onSelectCaption,
			onSelectClip,
			onSelectZoom,
			videoDurationMs,
		],
	);

	useEffect(() => {
		if (!isSeeking) return;

		const flushSeek = () => {
			seekRafRef.current = null;
			if (!onSeek || !localTimelineRef.current || pendingSeekClientXRef.current === null)
				return;
			const rect = localTimelineRef.current.getBoundingClientRect();
			onSeek(getAbsoluteMsFromClientX(pendingSeekClientXRef.current, rect) / 1000);
		};

		const handleMouseMove = (event: globalThis.MouseEvent) => {
			pendingSeekClientXRef.current = event.clientX;
			if (seekRafRef.current === null) {
				seekRafRef.current = requestAnimationFrame(flushSeek);
			}
		};

		const handleMouseUp = () => {
			if (seekRafRef.current !== null) {
				cancelAnimationFrame(seekRafRef.current);
				seekRafRef.current = null;
			}
			if (pendingSeekClientXRef.current !== null) {
				flushSeek();
			}
			pendingSeekClientXRef.current = null;
			setIsSeeking(false);
		};

		window.addEventListener("mousemove", handleMouseMove);
		window.addEventListener("mouseup", handleMouseUp);

		return () => {
			if (seekRafRef.current !== null) {
				cancelAnimationFrame(seekRafRef.current);
				seekRafRef.current = null;
			}
			pendingSeekClientXRef.current = null;
			window.removeEventListener("mousemove", handleMouseMove);
			window.removeEventListener("mouseup", handleMouseUp);
		};
	}, [getAbsoluteMsFromClientX, isSeeking, onSeek]);

	const timelineRowCount = useMemo(() => {
		const annotationRowIds = new Set<string>();
		const audioRowIds = new Set<string>();
		for (const item of items) {
			if (isAnnotationTrackRowId(item.rowId)) annotationRowIds.add(item.rowId);
			if (isAudioTrackRowId(item.rowId)) audioRowIds.add(item.rowId);
		}
		const sourceAudioRows = showSourceAudioTrack ? sourceAudioTracks.length : 0;
		const captionRows = captionsEnabled || items.some((item) => item.rowId === CAPTION_ROW_ID) ? 1 : 0;
		return 2 + sourceAudioRows + captionRows + annotationRowIds.size + audioRowIds.size;
	}, [items, showSourceAudioTrack, sourceAudioTracks.length, captionsEnabled]);
	const visibleRowCount = timelineRowCount + (keystrokeTrack ? 1 : 0);
	const timelineRowsMinHeightPx = getTimelineRowsMinHeightPx(visibleRowCount) + videoRowCount * 66;
	const timelineContentMinHeightPx = getTimelineContentMinHeightPx(visibleRowCount) + videoRowCount * 66;
	const sideProperty = direction === "rtl" ? "right" : "left";
	const {
		canShowGhostPlayhead,
		timelineGhostOffsetPx,
		handleTimelineMouseEnter,
		handleTimelineMouseMove,
		handleTimelineMouseLeave,
		canShowGhostZoom,
		ghostStartMs,
		ghostWidthPx,
		handleZoomRowMouseEnter,
		handleZoomRowMouseMove,
		handleZoomRowMouseLeave,
		handleZoomRowMouseDown,
		handleZoomRowClick,
		canShowGhostCaption,
		captionGhostStartMs,
		captionGhostWidthPx,
		handleCaptionRowMouseEnter,
		handleCaptionRowMouseMove,
		handleCaptionRowMouseLeave,
		handleCaptionRowMouseDown,
		handleCaptionRowClick,
	} = useTimelineHover({
		clipPresentation,
		direction,
		sidebarWidth,
		rangeStart: range.start,
		rangeEnd: range.end,
		videoDurationMs,
		onAddZoomAtMs,
		canPlaceZoomAtMs,
		onAddCaptionAtMs,
		canPlaceCaptionAtMs,
		resolveCaptionSpanAtMs,
		captionsEnabled,
		captionQuickAddEnabled,
		isDragging,
		valueToPixels,
	});

	return (
		<div
			ref={setRefs}
			style={{
				...style,
				height: "100%",
				minHeight: timelineContentMinHeightPx,
				overflow: "visible",
			}}
			className="select-none bg-editor-bg relative cursor-pointer group flex flex-col"
			data-forward-selection={forwardSelectionActive}
			onClickCapture={(event) => {
				if (suppressClick.current) { suppressClick.current = false; event.stopPropagation(); event.preventDefault(); }
			}}
			onPointerDownCapture={(event) => {
				if ((event.target as HTMLElement).closest("[data-source-audio-editor]")) return;
				if (onSelectRegions && !forwardSelectionActive && event.button === 0) {
					const target = event.target as HTMLElement;
					const item = target.closest<HTMLElement>('[data-region-id]');
					if (item && (event.shiftKey || event.ctrlKey || event.metaKey)) {
						event.preventDefault(); event.stopPropagation();
						const id = item.dataset.regionId!;
						onSelectRegions(selectedIds.includes(id) ? selectedIds.filter((selected) => selected !== id) : [...selectedIds, id]);
						return;
					}
					const rect = event.currentTarget.getBoundingClientRect();
					const x = direction === "rtl" ? rect.right - event.clientX : event.clientX - rect.left;
					if (!item && x >= sidebarWidth && event.clientY >= rect.top + TIMELINE_AXIS_HEIGHT_PX && !target.closest('button,input,[role="slider"],[data-playback-cursor]')) {
						event.preventDefault(); event.stopPropagation();
						selectionDrag.current = { x: event.clientX, y: event.clientY, moved: false, additive: event.shiftKey ? selectedIds : [] };
						suppressClick.current = false;
						return;
					}
				}
				if (!forwardSelectionActive || !onForwardSelect) return;
				event.preventDefault(); event.stopPropagation();
				const rect = event.currentTarget.getBoundingClientRect();
				const x = direction === "rtl" ? rect.right - sidebarWidth - event.clientX : event.clientX - rect.left - sidebarWidth;
				if (x >= 0) onForwardSelect(Math.max(0, Math.min(videoDurationMs, range.start + pixelsToValue(x))));
			}}
			onMouseDown={handleTimelineMouseDown}
			onClick={handleTimelineClick}
			onMouseEnter={handleTimelineMouseEnter}
			onMouseMove={handleTimelineMouseMove}
			onMouseLeave={handleTimelineMouseLeave}
		>
			{marquee && <div data-testid="timeline-marquee" className="pointer-events-none absolute z-[80] border border-blue-400 bg-blue-400/20" style={{ left: marquee.x, top: marquee.y, width: marquee.width, height: marquee.height }} />}
			<div aria-hidden="true" style={{ height: TIMELINE_AXIS_HEIGHT_PX, flexShrink: 0 }} />
			<PlaybackCursor
				clips={clipPresentation}
				currentTimeMs={currentTimeMs}
				videoDurationMs={videoDurationMs}
				onSeek={onSeek}
				timelineRef={localTimelineRef}
				keyframes={keyframes}
				isLoading={isLoading}
			/>
			{canShowGhostPlayhead && (
				<div
					className="absolute top-0 bottom-0 z-[45] pointer-events-none"
					style={{
						[sideProperty === "right" ? "marginRight" : "marginLeft"]:
							`${sidebarWidth - 1}px`,
					}}
				>
					<div
						className="absolute top-0 bottom-0 w-px bg-foreground/35"
						style={{ [sideProperty]: `${timelineGhostOffsetPx}px` }}
					/>
				</div>
			)}

			<div
				className="relative z-10 flex flex-1 min-h-0 flex-col"
				style={{ minHeight: timelineRowsMinHeightPx }}
			>
				{keystrokeTrack && <KeystrokeTrack {...keystrokeTrack} />}
				<TimelineCanvasRows
					captionOverviewSelectionRef={captionOverviewSelectionRef}
					changeMarkers={changeMarkers}
					onSourceAudioRangeDelete={onSourceAudioRangeDelete}
					onSeek={onSeek}
					selectedIds={selectedIds}
					videoRows={videoRows}
					videoPath={videoPath}
					items={items}
					videoDurationMs={videoDurationMs}
					selectAllBlocksActive={selectAllBlocksActive}
					selectedZoomId={selectedZoomId}
					selectedClipId={selectedClipId}
					selectedAnnotationId={selectedAnnotationId}
					selectedAudioId={selectedAudioId}
					selectedCaptionId={selectedCaptionId}
					onSelectZoom={onSelectZoom}
					onSelectClip={onSelectClip}
					onSelectAnnotation={onSelectAnnotation}
					onSelectAudio={onSelectAudio}
					onSelectCaption={onSelectCaption}
					sourceAudioTracks={sourceAudioTracks}
					getSourceAudioTrackSettingsForClip={getSourceAudioTrackSettingsForClip}
					showSourceAudioTrack={showSourceAudioTrack}
					liveSpanPreviewById={liveSpanPreviewById}
					liveHiddenItemIds={liveHiddenItemIds}
					direction={direction}
					canShowGhostZoom={canShowGhostZoom}
					ghostStartMs={ghostStartMs}
					ghostWidthPx={ghostWidthPx}
					onZoomRowMouseEnter={handleZoomRowMouseEnter}
					onZoomRowMouseMove={handleZoomRowMouseMove}
					onZoomRowMouseLeave={handleZoomRowMouseLeave}
					onZoomRowMouseDown={handleZoomRowMouseDown}
					onZoomRowClick={handleZoomRowClick}
					captionsEnabled={captionsEnabled}
					canShowGhostCaption={canShowGhostCaption}
					captionGhostStartMs={captionGhostStartMs}
					captionGhostWidthPx={captionGhostWidthPx}
					onCaptionRowMouseEnter={handleCaptionRowMouseEnter}
					onCaptionRowMouseMove={handleCaptionRowMouseMove}
					onCaptionRowMouseLeave={handleCaptionRowMouseLeave}
					onCaptionRowMouseDown={handleCaptionRowMouseDown}
					onCaptionRowClick={handleCaptionRowClick}
				/>
			</div>
		</div>
	);
}
import { KeystrokeTrack, type KeystrokeTrackControls } from "../../../keystrokes/KeystrokeTrack";
