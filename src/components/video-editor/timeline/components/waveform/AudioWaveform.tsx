import { useTheme } from "@/contexts/ThemeContext";
import { useTimelineContext } from "dnd-timeline";
import { memo, useCallback, useEffect, useRef, useState } from "react";
import type { AudioPeaksData } from "../../core/timelineTypes";
import { sampleWaveformWindow } from "./waveformSampling";

interface AudioWaveformProps {
	peaks: AudioPeaksData;
	segmentStartMs?: number;
	segmentEndMs?: number;
	gain?: number;
	normalize?: boolean;
	className?: string;
	color?: "default" | "source";
}

/**
 * Renders an audio waveform as a canvas that fills its parent container.
 * Automatically syncs with the timeline's visible range so the waveform
 * scrolls and zooms together with the clip items above it.
 */
function AudioWaveformComponent({
	peaks,
	segmentStartMs,
	segmentEndMs,
	gain = 1,
	normalize = false,
	className,
	color = "default",
}: AudioWaveformProps) {
	const canvasRef = useRef<HTMLCanvasElement | null>(null);
	const { theme } = useTheme();
	const { range } = useTimelineContext();
	const startMs = segmentStartMs ?? range.start;
	const endMs = segmentEndMs ?? range.end;
	const [size, setSize] = useState({ width: 0, height: 0, dpr: 1 });

	const observerRef = useRef<ResizeObserver | null>(null);
	const setCanvasRef = useCallback((node: HTMLCanvasElement | null) => {
		observerRef.current?.disconnect();
		observerRef.current = null;
		canvasRef.current = node;
		if (!node) return;
		const observer = new ResizeObserver(([entry]) => {
			const dpr = window.devicePixelRatio || 1;
			const width = Math.round(entry.contentRect.width * dpr);
			const height = Math.round(entry.contentRect.height * dpr);
			setSize(previous => previous.width === width && previous.height === height && previous.dpr === dpr
				? previous : { width, height, dpr });
		});
		observer.observe(node, { box: "device-pixel-content-box" });
		observerRef.current = observer;
	}, []);

	useEffect(() => {
		const canvas = canvasRef.current;
		const { width, height, dpr } = size;
		if (!canvas || width === 0 || height === 0) return;
		const rafId = requestAnimationFrame(() => {
			// Use the observer's dimensions so one canvas write cannot force a
			// synchronous layout when the next canvas is drawn in the same frame.
			if (canvas.width !== width) canvas.width = width;
			if (canvas.height !== height) canvas.height = height;
			const ctx = canvas.getContext("2d");
			if (!ctx) return;
			ctx.clearRect(0, 0, width, height);

			if (peaks.durationMs <= 0 || peaks.peaks.length === 0 || endMs <= startMs) return;

			const midY = height / 2;
			const peakData = sampleWaveformWindow(peaks, startMs, endMs, width);
			ctx.strokeStyle =
				color === "source"
					? theme === "dark"
						? "#7dd3fc"
						: "#0369a1"
					: theme === "dark"
						? "rgba(255, 255, 255, 0.65)"
						: "rgba(0, 0, 0, 0.6)";
			// A fine center line makes truly silent stretches easy to distinguish.
			ctx.globalAlpha = 0.35;
			ctx.lineWidth = dpr;
			ctx.beginPath();
			ctx.moveTo(0, midY);
			ctx.lineTo(width, midY);
			ctx.stroke();
			ctx.globalAlpha = 1;
			ctx.beginPath();

			for (let px = 0; px < width; px++) {
				let amplitude = peakData[px];

				if (normalize) amplitude = Math.sqrt(Math.max(0, amplitude));
				amplitude = Math.max(0, Math.min(1, amplitude * gain));

				const barHeight = amplitude * midY * 0.85;

				ctx.moveTo(px, midY - barHeight);
				ctx.lineTo(px, midY + barHeight);
			}

			ctx.lineWidth = dpr;
			ctx.stroke();
		});
		return () => cancelAnimationFrame(rafId);
	}, [gain, color, normalize, peaks, startMs, endMs, size, theme]);

	return (
		<canvas
			ref={setCanvasRef}
			className={className ?? "absolute inset-0 w-full h-full pointer-events-none"}
			style={{ display: "block" }}
		/>
	);
}

export default memo(AudioWaveformComponent);
