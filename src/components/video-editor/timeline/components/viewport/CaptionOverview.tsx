import { useLayoutEffect, useRef, type PointerEvent, type RefObject } from "react";

export interface CaptionOverviewMark {
	id: string;
	offset: number;
	width: number;
}

export type CaptionOverviewSelection = (bounds: {
	left: number;
	right: number;
	top: number;
	bottom: number;
}) => string[];

export function CaptionOverview({
	marks,
	rtl,
	selectionRef,
	onInspect,
	onSelect,
}: {
	marks: CaptionOverviewMark[];
	rtl: boolean;
	selectionRef: RefObject<CaptionOverviewSelection | null>;
	onInspect: (id: string) => void;
	onSelect?: (id: string) => void;
}) {
	const ref = useRef<HTMLCanvasElement>(null);

	useLayoutEffect(() => {
		const canvas = ref.current;
		if (!canvas) return;
		const draw = () => {
			const dpr = window.devicePixelRatio || 1;
			const width = canvas.clientWidth;
			const height = canvas.clientHeight;
			const pixelWidth = Math.round(width * dpr);
			const pixelHeight = Math.round(height * dpr);
			if (canvas.width !== pixelWidth) canvas.width = pixelWidth;
			if (canvas.height !== pixelHeight) canvas.height = pixelHeight;
			const context = canvas.getContext("2d");
			if (!context) return;
			context.setTransform(dpr, 0, 0, dpr, 0, 0);
			context.clearRect(0, 0, width, height);
			context.fillStyle = "#b58b12";
			const markHeight = height * 0.85;
			const y = (height - markHeight) / 2;
			for (const mark of marks) {
				const start = rtl ? width - mark.offset - mark.width : mark.offset;
				context.fillRect(start, y, mark.width, markHeight);
			}
		};
		draw();
		const observer = new ResizeObserver(draw);
		observer.observe(canvas);
		selectionRef.current = ({ left, right, top, bottom }) => {
			const rect = canvas.getBoundingClientRect();
			if (rect.height <= 0 || rect.width <= 0 || rect.top >= bottom || rect.bottom <= top)
				return [];
			const start = rtl ? rect.right - right : left - rect.left;
			const end = rtl ? rect.right - left : right - rect.left;
			return marks.filter(mark => mark.offset < end && mark.offset + mark.width > start).map(mark => mark.id);
		};
		return () => {
			observer.disconnect();
			selectionRef.current = null;
		};
	}, [marks, rtl, selectionRef]);

	const hitMark = (event: PointerEvent<HTMLCanvasElement>) => {
		const rect = event.currentTarget.getBoundingClientRect();
		const offset = rtl ? rect.right - event.clientX : event.clientX - rect.left;
		// Later marks paint over earlier marks in the same pixel.
		for (let index = marks.length - 1; index >= 0; index--) {
			const mark = marks[index];
			if (offset >= mark.offset && offset < mark.offset + mark.width) return mark;
		}
		return undefined;
	};

	return (
		<canvas
			ref={ref}
			data-caption-overview
			aria-hidden="true"
			className="absolute inset-0 h-full w-full"
			onPointerMove={event => {
				if (event.buttons) return;
				const mark = hitMark(event);
				if (mark) onInspect(mark.id);
			}}
			onPointerDown={event => {
				if (event.button !== 0) return;
				const mark = hitMark(event);
				if (!mark) return;
				event.preventDefault();
				event.stopPropagation();
				onSelect?.(mark.id);
			}}
		/>
	);
}
