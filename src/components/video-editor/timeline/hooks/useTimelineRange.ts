import type { Range } from "dnd-timeline";
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type RefObject, type SetStateAction, type WheelEvent } from "react";
import { createInitialRange, normalizeWheelDeltaToPixels } from "../core/time";

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
	const setViewportRange = useCallback((update: SetStateAction<Range>) => {
		if (!focused) setRange(update);
	}, [focused]);

	const panTimelineRange = useCallback(
		(deltaMs: number) => {
			if (!Number.isFinite(deltaMs) || deltaMs === 0 || totalMs <= 0) {
				return;
			}

			setRange((previous) => {
				const visibleSpan = Math.max(1, previous.end - previous.start);
				const maxStart = Math.max(0, totalMs - visibleSpan);
				const nextStart = Math.max(0, Math.min(previous.start + deltaMs, maxStart));
				if (nextStart === previous.start) return previous;
				return { start: nextStart, end: nextStart + visibleSpan };
			});
		},
		[totalMs],
	);

	const handleTimelineWheel = useCallback(
		(event: WheelEvent<HTMLDivElement>) => {
			if (focused || ((event.ctrlKey || event.metaKey) && !event.shiftKey) || totalMs <= 0) {
				return;
			}

			const container = timelineContainerRef.current;
			const horizontalDeltaPx = resolveTimelineWheelPanDeltaPx({
				deltaX: event.deltaX,
				deltaY: event.deltaY,
				deltaMode: event.deltaMode,
				shiftKey: event.shiftKey,
				ctrlKey: event.ctrlKey,
				metaKey: event.metaKey,
				canScrollVertically: container
					? container.scrollHeight > container.clientHeight + 1
					: true,
			});

			if (horizontalDeltaPx === 0) {
				return;
			}

			const containerWidth = container?.clientWidth ?? 0;
			const visibleRangeMs = clampedRange.end - clampedRange.start;
			if (containerWidth <= 0 || visibleRangeMs <= 0) {
				return;
			}

			event.preventDefault();
			const deltaMs = (horizontalDeltaPx / containerWidth) * visibleRangeMs;
			panTimelineRange(deltaMs);
		},
		[clampedRange.end, clampedRange.start, focused, panTimelineRange, timelineContainerRef, totalMs],
	);

	return {
		range,
		setRange: setViewportRange,
		clampedRange,
		handleTimelineWheel,
	};
}
