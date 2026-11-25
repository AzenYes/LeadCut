import { uiText } from "@/i18n/uiText";
import { useTimelineContext } from "dnd-timeline";
import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from "react";
import { cn } from "@/lib/utils";
import type { PlaybackClock } from "../../../videoPlayback/playbackClock";
import { formatPlayheadTime } from "../../core/time";

import {
	getPlayheadDisplayTime,
	getTimeAtClipSeam,
	type ClipPresentation,
} from "../../core/clipPresentation";

interface PlaybackCursorProps {
	clips: ClipPresentation[];
	playbackClock: PlaybackClock;
	videoDurationMs: number;
	onSeek?: (time: number) => void;
	timelineRef: RefObject<HTMLDivElement | null>;
	keyframes?: { id: string; time: number }[];
	isLoading?: boolean;
}

export default function PlaybackCursor({
	clips,
	playbackClock,
	videoDurationMs,
	onSeek,
	timelineRef,
	keyframes = [],
	isLoading = false,
}: PlaybackCursorProps) {
	const { sidebarWidth, direction, range, valueToPixels, pixelsToValue } = useTimelineContext();
	const sideProperty = direction === "rtl" ? "right" : "left";
	const [isDragging, setIsDragging] = useState(false);
	const [isHovered, setIsHovered] = useState(false);
	const layerRef = useRef<HTMLDivElement>(null);
	const lineRef = useRef<HTMLDivElement>(null);
	const capRef = useRef<HTMLButtonElement>(null);
	const timeLabelRef = useRef<HTMLSpanElement>(null);
	const expanded = isHovered || isDragging || isLoading;

	useLayoutEffect(() => {
		const layer = layerRef.current;
		const line = lineRef.current;
		const cap = capRef.current;
		const timeLabel = timeLabelRef.current;
		if (!layer || !line || !cap || !timeLabel) return;
		const width = valueToPixels(range.end - range.start);
		const sign = direction === "rtl" ? -1 : 1;
		const update = () => {
			const time = Math.min(Math.round(playbackClock.getTime() * 1000), videoDurationMs);
			layer.hidden = time < range.start || time > range.end;
			if (layer.hidden) return;
			const offset = valueToPixels(getPlayheadDisplayTime(time, clips) - range.start);
			line.style.transform = `translateX(${sign * offset}px)`;
			// Keep the expanded timestamp inside the viewport at its edges.
			const capShift = Math.max(0, 34 - offset) - Math.max(0, 34 - (width - offset));
			cap.style.transform = expanded ? `translateX(calc(-50% + ${sign * capShift}px))` : "translateX(-50%)";
			const label = formatPlayheadTime(time);
			timeLabel.textContent = label;
			cap.setAttribute("aria-label", uiText("playheadTime", { time: label }));
		};
		update();
		return playbackClock.subscribe(update);
	}, [clips, direction, expanded, playbackClock, range.start, range.end, valueToPixels, videoDurationMs]);

	useEffect(() => {
		if (!isDragging) return;

		const handleMouseMove = (e: MouseEvent) => {
			if (!timelineRef.current || !onSeek) return;
			const rect = timelineRef.current.getBoundingClientRect();
			const clickX =
				direction === "rtl"
					? rect.right - sidebarWidth - e.clientX
					: e.clientX - rect.left - sidebarWidth;
			const relativeMs = pixelsToValue(clickX);
			let absoluteMs = getTimeAtClipSeam(
				Math.max(0, Math.min(range.start + relativeMs, videoDurationMs)),
				clips,
			);

			const snapThresholdMs = 150;
			const nearbyKeyframe = keyframes.find(
				(kf) =>
					Math.abs(kf.time - absoluteMs) <= snapThresholdMs &&
					kf.time >= range.start &&
					kf.time <= range.end,
			);
			if (nearbyKeyframe) absoluteMs = nearbyKeyframe.time;

			onSeek(absoluteMs / 1000);
		};

		const handleMouseUp = () => {
			setIsDragging(false);
			document.body.style.cursor = "";
		};

		window.addEventListener("mousemove", handleMouseMove);
		window.addEventListener("mouseup", handleMouseUp);
		document.body.style.cursor = "ew-resize";

		return () => {
			window.removeEventListener("mousemove", handleMouseMove);
			window.removeEventListener("mouseup", handleMouseUp);
			document.body.style.cursor = "";
		};
	}, [
		isDragging,
		clips,
		onSeek,
		timelineRef,
		sidebarWidth,
		range.start,
		range.end,
		videoDurationMs,
		pixelsToValue,
		keyframes,
		direction,
	]);

	if (videoDurationMs <= 0) return null;
	return (
		<div ref={layerRef} data-testid="timeline-playhead" className="absolute inset-0 z-50 pointer-events-none">
			<div
				ref={lineRef}
				className="absolute top-0 bottom-0 w-px bg-red-500"
				style={{ [sideProperty]: sidebarWidth }}
			>
				<button
					type="button"
					ref={capRef}
					data-testid="playhead-cap"
					onMouseEnter={() => setIsHovered(true)}
					onMouseLeave={() => setIsHovered(false)}
					onFocus={() => setIsHovered(true)}
					onBlur={() => setIsHovered(false)}
					onClick={(event) => event.stopPropagation()}
					onMouseDown={(event) => {
						if (event.button !== 0) return;
						event.preventDefault();
						event.stopPropagation();
						setIsDragging(true);
					}}
					className="absolute top-0 h-4 rounded-full bg-red-500 text-white cursor-ew-resize pointer-events-auto overflow-hidden transition-[width,transform] duration-150"
					style={{
						width: expanded ? 68 : 16,
						left: "50%",
					}}
				>
					<span
						ref={timeLabelRef}
						className={cn(
							"block whitespace-nowrap text-[10px] font-medium tabular-nums transition-opacity",
							expanded ? "opacity-100" : "opacity-0",
						)}
					/>
				</button>
			</div>
		</div>
	);
}
