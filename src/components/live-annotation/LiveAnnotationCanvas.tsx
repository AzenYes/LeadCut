import { type PointerEvent, useEffect, useLayoutEffect, useReducer, useRef, useState } from "react";
import { useScopedT } from "@/contexts/I18nContext";
import { drawLiveAnnotation } from "./drawLiveAnnotation";
import { createLiveAnnotationState, findAnnotationAt, LIVE_ANNOTATION_FADE_MS, liveAnnotationReducer, type AnnotationPoint } from "./liveAnnotationModel";

export default function LiveAnnotationCanvas() {
	const t = useScopedT("launch");
	const [state, dispatch] = useReducer(liveAnnotationReducer, undefined, createLiveAnnotationState);
	const canvas = useRef<HTMLCanvasElement>(null);
	const pointer = useRef<number | null>(null);
	const input = useRef<HTMLInputElement>(null);
	const [textAt, setTextAt] = useState<AnnotationPoint | null>(null);
	const [text, setText] = useState("");

	useEffect(() => {
		const api = window.electronAPI;
		const removeOptions = api?.onLiveAnnotationOptions?.(options => {
			dispatch({ type: "options", options });
			if (options.tool !== "text") {
				dispatch({ type: "cancel" });
				setTextAt(null);
			}
		});
		const removeCommand = api?.onLiveAnnotationCommand?.(command => dispatch({ type: command }));
		const removeState = api?.onLiveAnnotationStateChanged?.(({ active }) => {
			if (active) return;
			dispatch({ type: "cancel" });
			pointer.current = null;
			setTextAt(null);
		});
		api?.liveAnnotationCanvasReady?.();
		return () => { removeOptions?.(); removeCommand?.(); removeState?.(); };
	}, []);

	useEffect(() => {
		if (!textAt) return;
		void window.electronAPI?.setLiveAnnotationTextFocus?.(true).then(() => input.current?.focus());
		input.current?.focus();
		return () => { void window.electronAPI?.setLiveAnnotationTextFocus?.(false); };
	}, [textAt]);

	useLayoutEffect(() => {
		const node = canvas.current;
		const context = node?.getContext("2d");
		if (!node || !context) return;
		let frame = 0;
		let fadeTimer: number | undefined;
		const draw = () => {
			const bounds = node.getBoundingClientRect();
			const ratio = window.devicePixelRatio || 1;
			const width = Math.max(1, Math.round(bounds.width * ratio));
			const height = Math.max(1, Math.round(bounds.height * ratio));
			if (node.width !== width) node.width = width;
			if (node.height !== height) node.height = height;
			context.setTransform(ratio, 0, 0, ratio, 0, 0);
			context.clearRect(0, 0, bounds.width, bounds.height);
			const now = Date.now();
			for (const shape of state.shapes) drawLiveAnnotation(context, shape, now);
			if (state.draft) drawLiveAnnotation(context, state.draft, now);
		};
		const drawFade = () => {
			draw();
			dispatch({ type: "expire", at: Date.now() });
			scheduleFade();
		};
		const scheduleFade = () => {
			const now = Date.now();
			const next = state.shapes.reduce((earliest, shape) => shape.fadeAt !== undefined &&
				shape.fadeAt + LIVE_ANNOTATION_FADE_MS > now ? Math.min(earliest, shape.fadeAt) : earliest, Infinity);
			if (next <= now) frame = requestAnimationFrame(drawFade);
			else if (Number.isFinite(next)) fadeTimer = window.setTimeout(drawFade, next - now);
		};
		draw();
		window.addEventListener("resize", draw);
		scheduleFade();
		return () => { window.removeEventListener("resize", draw); cancelAnimationFrame(frame); window.clearTimeout(fadeTimer); };
	}, [state.shapes, state.draft]);

	const position = (event: PointerEvent): AnnotationPoint => {
		const bounds = canvas.current!.getBoundingClientRect();
		return { x: event.clientX - bounds.left, y: event.clientY - bounds.top };
	};
	const start = (event: PointerEvent<HTMLDivElement>) => {
		if (event.button !== 0 || textAt || pointer.current !== null) return;
		const point = position(event);
		if (state.options.tool === "eraser") {
			const hit = findAnnotationAt(state.shapes, point);
			if (hit) dispatch({ type: "erase", id: hit.id });
			return;
		}
		dispatch({ type: "start", id: crypto.randomUUID(), point });
		if (state.options.tool === "text") {
			setText("");
			setTextAt(point);
			return;
		}
		event.currentTarget.setPointerCapture(event.pointerId);
		pointer.current = event.pointerId;
	};

	return (
		<div className="fixed inset-0 select-none touch-none" data-testid="live-annotation-surface"
			data-shape-tools={state.shapes.map(shape => shape.tool).join(",")}
			onPointerDown={start}
			onPointerMove={event => {
				if (pointer.current === event.pointerId) dispatch({ type: "point", point: position(event) });
			}}
			onPointerUp={event => {
				if (pointer.current !== event.pointerId) return;
				pointer.current = null;
				dispatch({ type: "point", point: position(event) });
				dispatch({ type: "finish", at: Date.now() });
			}}
			onPointerCancel={() => { pointer.current = null; dispatch({ type: "cancel" }); }}
		>
			<canvas ref={canvas} className="pointer-events-none absolute inset-0 h-full w-full" data-testid="live-annotation-canvas" aria-hidden="true" />
			{textAt && (
				<form className="absolute max-w-xs" style={{ left: Math.min(textAt.x, Math.max(0, window.innerWidth - 200)), top: Math.min(textAt.y, Math.max(0, window.innerHeight - 37)) }}
					onPointerDown={event => event.stopPropagation()} onSubmit={event => {
						event.preventDefault();
						dispatch({ type: "finish", at: Date.now(), text });
						setTextAt(null);
					}}>
					<input ref={input} value={text} maxLength={200} className="rounded border border-white/80 bg-neutral-900/90 px-2 py-1 text-white outline-none"
						aria-label={t("annotation.textInput", "Annotation text")}
						onChange={event => setText(event.target.value)} onKeyDown={event => {
							if (event.key === "Escape") { dispatch({ type: "cancel" }); setTextAt(null); }
						}} />
				</form>
			)}
		</div>
	);
}
