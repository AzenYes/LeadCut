import type { Range } from "dnd-timeline";
import { startTransition, useCallback, useEffect, useLayoutEffect, useRef, useState, type RefObject, type SetStateAction } from "react";
import { createInitialRange, normalizeWheelDeltaToPixels } from "../core/time";
import { scheduleTimelineViewportUpdate } from "../core/timelineViewportSchedule";

interface UseTimelineRangeParams {
	totalMs: number;
	timelineContainerRef: RefObject<HTMLDivElement | null>;
	sourceKey?: string | null;
	focusRange?: Range | null;
}

export interface TimelineWheelPanDeltaInput {
	deltaX: number;
	deltaY: number;
	deltaMode: number;
	shiftKey?: boolean;
	ctrlKey?: boolean;
	metaKey?: boolean;
	canScrollVertically?: boolean;
}

export function resolveTimelineWheelPanDeltaPx({
	deltaX,
	deltaY,
	deltaMode,
	shiftKey = false,
	ctrlKey = false,
	metaKey = false,
	canScrollVertically = true,
}: TimelineWheelPanDeltaInput) {
	if ((ctrlKey || metaKey) && !shiftKey) {
		return 0;
	}

	if (Math.abs(deltaX) > 0) {
		return normalizeWheelDeltaToPixels(deltaX, deltaMode);
	}

	if ((shiftKey || !canScrollVertically) && Math.abs(deltaY) > 0) {
		return normalizeWheelDeltaToPixels(deltaY, deltaMode);
	}

	return 0;
}

export function useTimelineRange({ totalMs, timelineContainerRef, sourceKey, focusRange }: UseTimelineRangeParams) {
	const [range, setRange] = useState<Range>(() => createInitialRange(totalMs));
	const focused = Boolean(focusRange);
	const wasFocused = useRef(focused);
	useLayoutEffect(() => {
		if (wasFocused.current && !focused) setRange(createInitialRange(totalMs));
		wasFocused.current = focused;
	}, [focused, totalMs]);
	const initialized = useRef(totalMs > 0);
	const previousSource = useRef(sourceKey);

	useEffect(() => {
		if (previousSource.current !== sourceKey) {
			previousSource.current = sourceKey;
			initialized.current = false;
		}
		if (!initialized.current && totalMs > 0) {
			setRange(createInitialRange(totalMs));
			initialized.current = true;
		}
	}, [totalMs, sourceKey]);

	// Editing duration must not change the viewport's origin or pixels per second.
	// Empty space beyond the new end is intentional, including deleting the tail.
	const clampedRange = focusRange ?? range;
	const pendingRangeUpdates = useRef<SetStateAction<Range>[]>([]);
	const cancelViewportUpdate = useRef<(() => void) | null>(null);
	useLayoutEffect(() => () => {
		cancelViewportUpdate.current?.();
		cancelViewportUpdate.current = null;
		pendingRangeUpdates.current = [];
	}, [focused, sourceKey]);

	const setViewportRange = useCallback((update: SetStateAction<Range>) => {
		if (focused) return;
		pendingRangeUpdates.current.push(update);
		if (cancelViewportUpdate.current) return;
		cancelViewportUpdate.current = scheduleTimelineViewportUpdate(window, () => {
			cancelViewportUpdate.current = null;
			const updates = pendingRangeUpdates.current;
			pendingRangeUpdates.current = [];
			startTransition(() => {
				setRange(previous => updates.reduce<Range>(
					(next, change) => typeof change === "function" ? change(next) : change,
					previous,
				));
			});
		});
	}, [focused]);

	useLayoutEffect(() => {
		const container = timelineContainerRef.current;
		if (!container || focused || totalMs <= 0) return;

		let width = container.clientWidth;
		const observer = new ResizeObserver(() => {
			width = container.clientWidth;
		});
		observer.observe(container);
		const handleTimelineWheel = (event: WheelEvent) => {
			// The timeline's native zoom handler owns modified wheel events.
			if (event.ctrlKey || event.metaKey) return;
			const horizontalDeltaPx = resolveTimelineWheelPanDeltaPx({
				deltaX: event.deltaX,
				deltaY: event.deltaY,
				deltaMode: event.deltaMode,
				shiftKey: event.shiftKey,
				canScrollVertically: event.deltaX !== 0 || event.shiftKey ||
					container.scrollHeight > container.clientHeight + 1,
			});
			if (!Number.isFinite(horizontalDeltaPx) || horizontalDeltaPx === 0 || width <= 0) return;
			event.preventDefault();
			const fraction = horizontalDeltaPx / width;
			setViewportRange(previous => {
				const visibleSpan = Math.max(1, previous.end - previous.start);
				const maxStart = Math.max(0, totalMs - visibleSpan);
				const nextStart = Math.max(0, Math.min(previous.start + fraction * visibleSpan, maxStart));
				if (nextStart === previous.start) return previous;
				return { start: nextStart, end: nextStart + visibleSpan };
			});
		};
		container.addEventListener("wheel", handleTimelineWheel, { passive: false });
		return () => {
			observer.disconnect();
			container.removeEventListener("wheel", handleTimelineWheel);
		};
	}, [focused, setViewportRange, timelineContainerRef, totalMs]);

	return {
		range,
		setRange: setViewportRange,
		clampedRange,
	};
}
