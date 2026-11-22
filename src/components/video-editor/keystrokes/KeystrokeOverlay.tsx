import { type PointerEvent, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useScopedT } from "@/contexts/I18nContext";
import { drawKeystrokes, type getKeystrokeLayout, getVisibleKeystrokes, type KeystrokePresentation } from "./keystrokeLayout";

type Position = { x: number; y: number };

export function KeystrokeOverlay({ presentation, timeMs, onMove }: {
	presentation?: KeystrokePresentation;
	timeMs: number;
	onMove?: (position: Position) => void;
}) {
	const t = useScopedT("editor");
	const layer = useRef<HTMLDivElement>(null);
	const canvas = useRef<HTMLCanvasElement>(null);
	const drag = useRef<{ clientX: number; clientY: number; origin: Position; pointer: number } | undefined>(undefined);
	const [bounds, setBounds] = useState({ width: 0, height: 0 });
	const [hitArea, setHitArea] = useState<ReturnType<typeof getKeystrokeLayout> | null>(null);
	const [moving, setMoving] = useState<Position>();
	const style = presentation?.style;
	const visible = useMemo(() => getVisibleKeystrokes(presentation, timeMs), [presentation, timeMs]);

	useLayoutEffect(() => {
		if (!layer.current) return;
		const element = layer.current;
		const observe = () => setBounds({ width: element.clientWidth, height: element.clientHeight });
		observe();
		const observer = new ResizeObserver(observe);
		observer.observe(element);
		return () => observer.disconnect();
	}, []);

	useLayoutEffect(() => {
		const element = canvas.current;
		const context = element?.getContext("2d");
		if (!element || !context) return;
		const ratio = element.ownerDocument.defaultView?.devicePixelRatio ?? 1;
		const pixelWidth = Math.max(1, Math.round(bounds.width * ratio));
		const pixelHeight = Math.max(1, Math.round(bounds.height * ratio));
		if (element.width !== pixelWidth) element.width = pixelWidth;
		if (element.height !== pixelHeight) element.height = pixelHeight;
		context.setTransform(ratio, 0, 0, ratio, 0, 0);
		context.clearRect(0, 0, bounds.width, bounds.height);
		const layouts = drawKeystrokes(context, bounds, moving
			? visible.map(item => ({ ...item, style: { ...item.style, ...moving } })) : visible);
		const next = layouts[layouts.length - 1] ?? null;
		setHitArea(current => current?.x === next?.x && current?.y === next?.y && current?.width === next?.width && current?.height === next?.height ? current : next);
	}, [bounds, moving, visible]);

	function start(event: PointerEvent<HTMLButtonElement>) {
		if (!style || !onMove || event.button !== 0) return;
		event.stopPropagation();
		event.currentTarget.setPointerCapture(event.pointerId);
		drag.current = { clientX: event.clientX, clientY: event.clientY, origin: { x: style.x, y: style.y }, pointer: event.pointerId };
	}

	function position(event: PointerEvent<HTMLButtonElement>) {
		const active = drag.current;
		if (!active || active.pointer !== event.pointerId || !bounds.width || !bounds.height) return undefined;
		return {
			x: Math.max(0, Math.min(100, active.origin.x + (event.clientX - active.clientX) / bounds.width * 100)),
			y: Math.max(0, Math.min(100, active.origin.y + (event.clientY - active.clientY) / bounds.height * 100)),
		};
	}

	return (
		<div ref={layer} className="pointer-events-none absolute inset-0 z-30">
			<canvas ref={canvas} aria-hidden="true" className="absolute inset-0 h-full w-full" />
			{visible.map(item => <span key={item.id} role="img" aria-label={item.text} data-testid="keystroke-overlay" className="absolute inset-0" />)}
			{onMove && (visible.length > 0 || moving) && hitArea && (
				<button type="button" aria-label={t("keystrokes.move", "Move keystroke display")}
					className="pointer-events-auto absolute cursor-move touch-none rounded-sm focus-visible:outline focus-visible:outline-2"
					style={{ left: hitArea.x, top: hitArea.y, width: hitArea.width, height: hitArea.height }}
					onPointerDown={start}
					onPointerMove={event => { const next = position(event); if (next) setMoving(next); }}
					onPointerUp={event => {
						const next = position(event);
						drag.current = undefined;
						setMoving(undefined);
						if (next && (next.x !== style?.x || next.y !== style?.y)) onMove(next);
					}}
					onPointerCancel={() => { drag.current = undefined; setMoving(undefined); }}
				/>
			)}
		</div>
	);
}
