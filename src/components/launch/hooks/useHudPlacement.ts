import { useCallback, useEffect, useRef, type RefObject } from "react";
import {
	type HudDisplayChange,
	type HudSavedPlacement,
	offsetToPlacement,
	placementToOffset,
} from "../../../../electron/hudOverlayBounds";

type Offset = { x: number; y: number };

export function useHudPlacement({
	enabled,
	kind,
	nodeRef,
	offsetRef,
	draggingRef,
	applyOffset,
	followDisplay,
}: {
	enabled: boolean;
	kind: "bar" | "webcam";
	nodeRef: RefObject<HTMLElement | null>;
	offsetRef: RefObject<Offset>;
	draggingRef: RefObject<boolean>;
	applyOffset: (offset: Offset) => void;
	followDisplay?: (change: HudDisplayChange) => boolean;
}) {
	const saved = useRef<HudSavedPlacement | undefined>(undefined);
	const displayId = useRef<number | null>(null);

	const persist = useCallback(() => {
		if (!enabled || !nodeRef.current || displayId.current === null) return;
		const rect = nodeRef.current.getBoundingClientRect();
		const placement = offsetToPlacement(
			{ x: rect.left, y: rect.top },
			{ width: window.innerWidth, height: window.innerHeight },
			rect,
			displayId.current,
		);
		saved.current = placement;
		void window.electronAPI?.hudOverlaySetPlacement?.(kind, placement)
			.catch((error) => console.warn("Could not save HUD placement:", error));
	}, [enabled, kind, nodeRef]);

	useEffect(() => {
		if (!enabled) return;
		let alive = true;
		let frame: number | undefined;
		let moved = false;
		const restore = () => {
			const node = nodeRef.current;
			if (!node || !saved.current || draggingRef.current) return;
			const rect = node.getBoundingClientRect();
			const target = placementToOffset(saved.current, { width: window.innerWidth, height: window.innerHeight }, rect);
			const current = offsetRef.current;
			const next = { x: current.x + target.x - rect.left, y: current.y + target.y - rect.top };
			if (Math.abs(next.x - current.x) > 0.5 || Math.abs(next.y - current.y) > 0.5) applyOffset(next);
		};
		const scheduleRestore = () => {
			if (frame !== undefined) cancelAnimationFrame(frame);
			frame = requestAnimationFrame(restore);
		};
		const unsubscribe = window.electronAPI?.onHudOverlayDisplayChanged?.((change) => {
			moved = true;
			displayId.current = change.displayId;
			if (!followDisplay?.(change)) scheduleRestore();
		});
		void window.electronAPI?.getHudOverlayPlacement?.().then((state) => {
			if (!alive || !state) return;
			if (!moved) displayId.current = state.displayId;
			saved.current ??= kind === "bar" ? state.barPlacement : state.webcamPreviewPlacement;
			scheduleRestore();
		}).catch((error) => console.warn("Could not restore HUD placement:", error));
		const node = nodeRef.current;
		const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(scheduleRestore);
		if (node) observer?.observe(node);
		window.addEventListener("resize", scheduleRestore);
		return () => {
			alive = false;
			if (frame !== undefined) cancelAnimationFrame(frame);
			unsubscribe?.();
			window.removeEventListener("resize", scheduleRestore);
			observer?.disconnect();
		};
	}, [applyOffset, draggingRef, enabled, followDisplay, kind, nodeRef, offsetRef]);

	return persist;
}
