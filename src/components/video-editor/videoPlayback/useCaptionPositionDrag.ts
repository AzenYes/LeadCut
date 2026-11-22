import { type PointerEvent, type RefObject, useRef, useState } from "react";
import { chapterCaptionSettings } from "@/lib/exporter/chapterRenderer";
import type { CaptionPosition } from "../captionStyle";
import type { ChapterProgress } from "../chapterProgress";
import type { AutoCaptionSettings } from "../types";

type Drag = {
	pointerId: number;
	x: number;
	y: number;
	width: number;
	height: number;
	minBottom: number;
	maxBottom: number;
	initial: Required<CaptionPosition>;
	moved: boolean;
};

export function useCaptionPositionDrag({
	frameRef,
	settings,
	chapters,
	editing,
	onCommit,
}: {
	frameRef: RefObject<HTMLDivElement | null>;
	settings: AutoCaptionSettings | undefined;
	chapters: ChapterProgress | undefined;
	editing: boolean;
	onCommit: ((position: CaptionPosition) => void) | undefined;
}) {
	const drag = useRef<Drag | null>(null);
	const [offset, setOffset] = useState<CaptionPosition | null>(null);

	function onPointerDown(event: PointerEvent<HTMLDivElement>) {
		event.stopPropagation();
		const frame = frameRef.current?.getBoundingClientRect();
		if (drag.current || editing || !settings || !onCommit || event.button !== 0 || !frame?.width || !frame.height) return;
		const minimum = chapterCaptionSettings({ ...settings, bottomOffset: 0 }, chapters, frame.width, frame.height)?.bottomOffset ?? 0;
		const maximum = Math.min(95, Math.max(0, 100 - event.currentTarget.offsetHeight / frame.height * 100));
		event.currentTarget.setPointerCapture(event.pointerId);
		drag.current = {
			pointerId: event.pointerId,
			x: event.clientX,
			y: event.clientY,
			width: frame.width,
			height: frame.height,
			minBottom: Math.min(minimum, maximum),
			maxBottom: maximum,
			initial: {
				bottomOffset: Math.max(settings.bottomOffset, minimum),
				horizontalOffset: settings.horizontalOffset ?? 0,
			},
			moved: false,
		};
	}

	function positionAt(event: PointerEvent<HTMLDivElement>) {
		const active = drag.current;
		if (!active || active.pointerId !== event.pointerId) return null;
		event.stopPropagation();
		const dx = event.clientX - active.x;
		const dy = event.clientY - active.y;
		if (!active.moved && Math.hypot(event.shiftKey ? dx : 0, dy) <= 3) return null;
		active.moved = true;
		let horizontalOffset = active.initial.horizontalOffset;
		if (event.shiftKey) {
			horizontalOffset = Math.max(-50, Math.min(50, horizontalOffset + dx / active.width * 100));
			if (Math.abs(horizontalOffset) < 1) horizontalOffset = 0;
		}
		const bottomOffset = Math.max(active.minBottom, Math.min(active.maxBottom, active.initial.bottomOffset - dy / active.height * 100));
		return { bottomOffset, horizontalOffset };
	}

	function cancel(event: PointerEvent<HTMLDivElement>) {
		if (drag.current?.pointerId !== event.pointerId) return;
		drag.current = null;
		setOffset(null);
	}

	return {
		offset,
		pointerHandlers: {
			onPointerDown,
			onPointerMove: (event: PointerEvent<HTMLDivElement>) => {
				const position = positionAt(event);
				if (position) setOffset(position);
			},
			onPointerUp: (event: PointerEvent<HTMLDivElement>) => {
				const position = positionAt(event);
				cancel(event);
				if (position) onCommit?.(position);
			},
			onPointerCancel: cancel,
			onLostPointerCapture: cancel,
		},
	};
}
