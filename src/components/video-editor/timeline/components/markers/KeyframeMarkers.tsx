import { useUiText } from "@/i18n/useUiText";
import { MARKER_COLORS, type MarkerColor } from "../../../types";
import { useTimelinePresentation } from "../../core/TimelinePresentation";
import { getPlayheadDisplayTime, getTimeAtClipSeam } from "../../core/clipPresentation";
import type { ProjectedRecordingMarker } from "../../core/recordingMarkers";
import { formatTimelineTimecode } from "../../core/time";
import type { ProjectedTimelineMarker } from "../../core/timelineMarkers";
import { useTimelineContext } from "dnd-timeline";
import React, { useEffect, useRef, useState } from "react";

const MARKER_SWATCHES: Record<MarkerColor, string> = {
	yellow: "#ffe100",
	red: "#f86675",
	green: "#51d894",
	blue: "#63a8fa",
};

interface KeyframeMarkersProps {
	keyframes: ProjectedTimelineMarker[];
	recordingMarkers?: readonly ProjectedRecordingMarker[];
	selectedKeyframeId: string | null;
	setSelectedKeyframeId: (id: string | null) => void;
	onKeyframeMove: (id: string, newTime: number) => void;
	onMarkerUpdate?: (id: string, patch: { note?: string; color?: MarkerColor }) => void;
	videoDurationMs: number;
	timelineRef: React.RefObject<HTMLDivElement | null>;
}

const KeyframeMarkers: React.FC<KeyframeMarkersProps> = ({
	keyframes,
	recordingMarkers = [],
	selectedKeyframeId,
	setSelectedKeyframeId,
	onKeyframeMove,
	onMarkerUpdate,
	videoDurationMs,
	timelineRef,
}) => {
	const uiText = useUiText();
	const { direction, sidebarWidth, range, valueToPixels, pixelsToValue } = useTimelineContext();
	const { clips } = useTimelinePresentation();
	const [drag, setDrag] = useState<{ id: string; initialX: number; grabOffset: number } | null>(null);
	const [previewTime, setPreviewTime] = useState<number | null>(null);
	const dragMovedRef = useRef(false);
	const noteLabel = uiText("timelineMarkerNote");

	useEffect(() => {
		if (!drag) return;

		const timeAtPointer = (x: number) => {
			const rect = timelineRef.current?.getBoundingClientRect();
			if (!rect) return null;
			const position = x - drag.grabOffset;
			const relativeMs = pixelsToValue((direction === "rtl" ? rect.right - position : position - rect.left) - sidebarWidth);
			const absoluteMs = Math.max(0, Math.min(range.start + relativeMs, videoDurationMs));
			return getTimeAtClipSeam(absoluteMs, clips);
		};
		const handleMouseMove = (event: MouseEvent) => {
			dragMovedRef.current ||= Math.abs(event.clientX - drag.initialX) >= 3;
			if (dragMovedRef.current) setPreviewTime(timeAtPointer(event.clientX));
		};
		const clearDrag = () => {
			setDrag(null);
			setPreviewTime(null);
		};
		const handleMouseUp = (event: MouseEvent) => {
			const time = dragMovedRef.current ? timeAtPointer(event.clientX) : null;
			clearDrag();
			if (time !== null) onKeyframeMove(drag.id, time);
		};

		window.addEventListener("mousemove", handleMouseMove);
		window.addEventListener("mouseup", handleMouseUp);
		window.addEventListener("blur", clearDrag);
		document.body.style.cursor = "ew-resize";

		return () => {
			window.removeEventListener("mousemove", handleMouseMove);
			window.removeEventListener("mouseup", handleMouseUp);
			window.removeEventListener("blur", clearDrag);
			document.body.style.cursor = "";
		};
	}, [
		clips,
		direction,
		drag,
		onKeyframeMove,
		timelineRef,
		sidebarWidth,
		range.start,
		videoDurationMs,
		pixelsToValue,
	]);

	return (
		<>
			{recordingMarkers.map((marker) => {
				if (marker.timelineTimeMs > videoDurationMs) return null;
				const displayTime = getPlayheadDisplayTime(marker.timelineTimeMs, clips);
				if (displayTime < range.start || displayTime > range.end) return null;
				const offset = valueToPixels(displayTime - range.start);
				const label = uiText(marker.kind === "cut" ? "recordingMarkerCut" : "recordingMarkerHighlight");
				return (
					<span
						key={`${marker.id}:${marker.clipId ?? ""}`}
						role="img"
						aria-label={label}
						title={`${label} · ${formatTimelineTimecode(marker.timelineTimeMs)}${marker.note ? ` · ${marker.note}` : ""}`}
						data-testid="recording-marker"
						data-marker-kind={marker.kind}
						data-source-time-ms={marker.timeMs}
						data-timeline-time-ms={marker.timelineTimeMs}
						className={`absolute top-8 z-40 h-3 w-[9px] rounded-b-sm ${marker.kind === "cut" ? "bg-danger" : "bg-success"}`}
						style={{ [direction === "rtl" ? "right" : "left"]: sidebarWidth + offset - 4 }}
					/>
				);
			})}
			{keyframes.map((kf) => {
				const isSelected = kf.id === selectedKeyframeId;
				const isDragging = kf.id === drag?.id;
				const displayedTime = getPlayheadDisplayTime(isDragging ? previewTime ?? kf.time : kf.time, clips);
				if (!isDragging && (displayedTime < range.start || displayedTime > range.end)) return null;
				const offset = valueToPixels(displayedTime - range.start);
				const markerTitle = uiText("keyframeValueMsDragToMoveDeleteBackspaceToRemove", { value0: Math.round(kf.time) });

				return (
					<div
						key={kf.id}
						className="pointer-events-none absolute top-8"
						style={{
							[direction === "rtl" ? "right" : "left"]: sidebarWidth + offset - 7,
							zIndex: isDragging || isSelected ? 50 : 40,
							transition: isDragging ? "none" : "left 0.1s ease-out",
						}}
					>
						<button
							type="button"
							data-testid="timeline-marker"
							data-source-time-ms={kf.sourceTimeMs}
							data-timeline-time-ms={kf.time}
							title={kf.note ? `${markerTitle} · ${kf.note}` : markerTitle}
							aria-label={markerTitle}
							aria-pressed={isSelected}
							className={`pointer-events-auto flex size-3.5 cursor-grab items-center justify-center rounded-sm active:cursor-grabbing ${isSelected ? "ring-2 ring-accent" : ""}`}
							onClick={(event) => {
								event.stopPropagation();
								setSelectedKeyframeId(kf.id);
							}}
							onMouseDown={(event) => {
								event.stopPropagation();
								setSelectedKeyframeId(kf.id);
								if (event.button !== 0 || !onMarkerUpdate) return;
								const rect = event.currentTarget.getBoundingClientRect();
								dragMovedRef.current = false;
								setDrag({ id: kf.id, initialX: event.clientX, grabOffset: event.clientX - rect.left - rect.width / 2 });
							}}
							onContextMenu={(event) => {
								event.preventDefault();
								event.stopPropagation();
								setSelectedKeyframeId(kf.id);
							}}
						>
							<span
								className={`size-2.5 ${kf.origin === "recording" ? "rounded-b-sm" : "rotate-45 rounded-[1px]"}`}
								style={{ backgroundColor: MARKER_SWATCHES[kf.color ?? "yellow"], opacity: isSelected ? 1 : 0.75 }}
							/>
						</button>
						{isSelected && previewTime === null && onMarkerUpdate ? (
							<div
								className={`pointer-events-auto absolute top-4 flex w-44 flex-col gap-2 rounded-md border border-border bg-popover p-2 text-popover-foreground shadow-md ${offset < valueToPixels((range.end - range.start) / 2) ? "start-0" : "end-0"}`}
								onPointerDown={event => event.stopPropagation()}
								onMouseDown={event => event.stopPropagation()}
								onClick={event => event.stopPropagation()}
							>
								<input
									key={kf.note}
									type="text"
									aria-label={noteLabel}
									placeholder={noteLabel}
									defaultValue={kf.note ?? ""}
									className="w-full rounded border border-border bg-background px-1.5 py-1 text-xs outline-none focus:border-accent"
									onBlur={event => onMarkerUpdate(kf.id, { note: event.currentTarget.value || undefined })}
									onKeyDown={event => {
										if (event.key !== "Enter") return;
										event.preventDefault();
										event.currentTarget.blur();
									}}
								/>
								<div className="flex gap-2">
									{MARKER_COLORS.map((color) => (
										<button
											key={color}
											type="button"
											aria-label={uiText("timelineMarkerColor", { value0: uiText(`timelineMarkerColor_${color}`) })}
											aria-pressed={(kf.color ?? "yellow") === color}
											className="size-4 rounded-full border border-border aria-pressed:ring-2 aria-pressed:ring-foreground"
											style={{ backgroundColor: MARKER_SWATCHES[color] }}
											onClick={() => onMarkerUpdate(kf.id, { color })}
										/>
									))}
								</div>
							</div>
						) : null}
					</div>
				);
			})}
		</>
	);
};

export default KeyframeMarkers;
