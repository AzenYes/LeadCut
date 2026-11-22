import { useTimelineContext, type Span } from "dnd-timeline";
import { memo, useCallback, useLayoutEffect, useMemo, useRef, useState, type PointerEvent } from "react";
import { useI18n } from "@/contexts/I18nContext";
import { useTheme } from "@/contexts/ThemeContext";
import type {
	SourceAudioTrackSetting,
	SourceAudioTrackSettings,
	SourceAudioTrackWithPeaks,
} from "../../../audio/audioTypes";
import { getAudibleSourceAudioRanges } from "../../../audio/sourceAudioEdits";
import type { TimelineAudioPeaksResult } from "../../hooks/useTimelineAudioPeaks";
import { getVisibleWaveformSpan, sampleWaveformWindow } from "./waveformSampling";

export function WaveformLoadStatus({
	loading,
	progress,
	error,
	retry,
	label,
}: Pick<TimelineAudioPeaksResult, "loading" | "progress" | "error" | "retry"> & {
	label?: string;
}) {
	const { t } = useI18n();
	if (!loading && !error) return null;
	const percent = progress === null ? null : Math.floor(progress * 100);
	return (
		<div
			role="status"
			className="inline-flex items-center gap-1.5 text-xs text-muted-foreground"
		>
			{label && <span className="font-medium">{label}</span>}
			{loading ? (
				<span>
					{percent === null
						? t("editor.timeline.waveformGenerating")
						: t("editor.timeline.waveformProgress", undefined, { percent })}
				</span>
			) : (
				<>
					<span title={error ?? undefined}>{t("editor.timeline.waveformFailed")}</span>
					<button
						type="button"
						className="rounded px-1.5 py-0.5 text-foreground underline"
						onPointerDown={(event) => event.stopPropagation()}
						onClick={(event) => {
							event.stopPropagation();
							retry();
						}}
					>
						{t("editor.timeline.waveformRetry")}
					</button>
				</>
			)}
		</div>
	);
}

type WaveformPart = { sourceStartMs: number; sourceEndMs: number; offset: number; width: number };
type WaveformClip = {
	clipId: string;
	sourceSpan: Span;
	visibleSource: Span;
	offset: number;
	width: number;
	pxPerSourceMs: number;
	parts: WaveformPart[];
	selected: boolean;
	muted: boolean;
	setting?: SourceAudioTrackSetting;
};

interface EditingProps {
	onDeleteRange?: (
		clipId: string,
		trackId: string,
		range: { startMs: number; endMs: number },
	) => void;
	onSeek?: (time: number) => void;
}

/** One paint surface per lane; the HTML hit targets still own focus and editing. */
export const SourceAudioWaveformLane = memo(function SourceAudioWaveformLane({
	track,
	clips,
	selectedClipId,
	getSettingForClip,
	onDeleteRange,
	onSeek,
}: EditingProps & {
	track: SourceAudioTrackWithPeaks;
	clips: readonly {
		id: string;
		span: Span;
		displaySpan: Span;
		sourceSpan?: Span;
		muted?: boolean;
	}[];
	selectedClipId?: string | null;
	getSettingForClip?: (id: string) => SourceAudioTrackSettings;
}) {
	const { range, valueToPixels, pixelsToValue, direction } = useTimelineContext();
	const { theme } = useTheme();
	const canvasRef = useRef<HTMLCanvasElement>(null);
	const sizeRef = useRef({ width: 0, height: 0 });
	const drawRef = useRef<(() => void) | null>(null);
	const requestRef = useRef<number | null>(null);
	const scheduleDraw = useCallback(() => {
		if (requestRef.current !== null) return;
		requestRef.current = requestAnimationFrame(() => {
			requestRef.current = null;
			drawRef.current?.();
		});
	}, []);
	const geometry = useMemo(
		() =>
			clips.flatMap((clip): WaveformClip[] => {
				const sourceSpan = clip.sourceSpan ?? clip.span;
				const visible = getVisibleWaveformSpan(clip.displaySpan, sourceSpan, range);
				if (!visible || visible.source.end <= visible.source.start) return [];
				const offset = valueToPixels(visible.display.start - range.start);
				const width = valueToPixels(visible.display.end - visible.display.start);
				if (!(width > 0)) return [];
				const pxPerSourceMs = width / (visible.source.end - visible.source.start);
				const setting = getSettingForClip?.(clip.id)[track.id];
				const parts = getAudibleSourceAudioRanges(
					{ startMs: visible.source.start, endMs: visible.source.end },
					setting?.deletedRanges,
				).map((span) => ({
					sourceStartMs: span.startMs,
					sourceEndMs: span.endMs,
					offset: (span.startMs - visible.source.start) * pxPerSourceMs,
					width: (span.endMs - span.startMs) * pxPerSourceMs,
				}));
				return [
					{
						clipId: clip.id,
						sourceSpan,
						visibleSource: visible.source,
						offset,
						width,
						pxPerSourceMs,
						selected: clip.id === selectedClipId,
						muted: Boolean(clip.muted || setting?.volume === 0),
						setting,
						parts,
					},
				];
			}),
		[clips, range, valueToPixels, getSettingForClip, track.id, selectedClipId],
	);

	useLayoutEffect(() => {
		const canvas = canvasRef.current;
		const owner = canvas?.ownerDocument.defaultView;
		const ctx = canvas?.getContext("2d");
		if (!canvas || !ctx || !owner) return;
		drawRef.current = () => {
			const dpr = owner.devicePixelRatio || 1;
			const width = Math.round(sizeRef.current.width * dpr);
			const height = Math.round(sizeRef.current.height * dpr);
			if (!width || !height) return;
			if (canvas.width !== width) canvas.width = width;
			if (canvas.height !== height) canvas.height = height;
			ctx.clearRect(0, 0, width, height);
			ctx.strokeStyle = theme === "dark" ? "#7dd3fc" : "#0369a1";
			ctx.lineWidth = dpr;
			const mid = height / 2;
			const delay = track.startDelayMs ?? 0;
			for (const clip of geometry)
				for (const part of clip.parts) {
					const pixels = Math.round((part.width - 2) * dpr);
					if (pixels <= 0) continue;
					const left = (clip.offset + part.offset + 1) * dpr;
					const x = direction === "rtl" ? width - left - pixels : left;
					const alpha = clip.muted ? 0.4 : 1;
					ctx.globalAlpha = alpha * 0.35;
					ctx.beginPath();
					ctx.moveTo(x, mid);
					ctx.lineTo(x + pixels, mid);
					ctx.stroke();
					const peaks = sampleWaveformWindow(
						track.peaks,
						part.sourceStartMs - delay,
						part.sourceEndMs - delay,
						pixels,
					);
					ctx.globalAlpha = alpha;
					ctx.beginPath();
					for (let pixel = 0; pixel < pixels; pixel++) {
						const amplitude =
							Math.min(1, peaks[direction === "rtl" ? pixels - 1 - pixel : pixel]) *
							Math.max(0, mid - dpr * 3) *
							0.85;
						ctx.moveTo(x + pixel, mid - amplitude);
						ctx.lineTo(x + pixel, mid + amplitude);
					}
					ctx.stroke();
				}
		};
		scheduleDraw();
		return () => {
			drawRef.current = null;
		};
	}, [geometry, direction, theme, track.peaks, track.startDelayMs, scheduleDraw]);

	useLayoutEffect(() => {
		const canvas = canvasRef.current;
		if (!canvas) return;
		const observer = new ResizeObserver(([entry]) => {
			if (!entry) return;
			const { width, height } = entry.contentRect;
			sizeRef.current = { width, height };
			scheduleDraw();
		});
		observer.observe(canvas, { box: "device-pixel-content-box" });
		return () => {
			observer.disconnect();
			if (requestRef.current !== null) cancelAnimationFrame(requestRef.current);
			requestRef.current = null;
		};
	}, [scheduleDraw]);

	return (
		<>
			<canvas
				ref={canvasRef}
				data-source-audio-waveform
				aria-hidden="true"
				className="pointer-events-none absolute inset-0 z-[1] h-full w-full"
			/>
			{geometry.map((clip) => (
				<SourceAudioWaveform
					key={clip.clipId}
					clip={clip}
					track={track}
					rtl={direction === "rtl"}
					displayStart={range.start}
					pixelsToValue={pixelsToValue}
					onDeleteRange={onDeleteRange}
					onSeek={onSeek}
				/>
			))}
		</>
	);
});

const SourceAudioWaveform = memo(function SourceAudioWaveform({
	clip,
	track,
	rtl,
	displayStart,
	pixelsToValue,
	onDeleteRange,
	onSeek,
}: EditingProps & {
	clip: WaveformClip;
	track: SourceAudioTrackWithPeaks;
	rtl: boolean;
	displayStart: number;
	pixelsToValue: (pixels: number) => number;
}) {
	const {
		clipId,
		sourceSpan,
		visibleSource,
		offset,
		width,
		pxPerSourceMs,
		parts,
		selected,
		muted,
		setting,
	} = clip;
	const { t } = useI18n();
	const [selection, setSelection] = useState<Span | null>(null);
	const editorRef = useRef<HTMLDivElement>(null);
	const drag = useRef<{ sourceMs: number; clientX: number } | null>(null);
	const sourceToPixel = (sourceMs: number) => (sourceMs - visibleSource.start) * pxPerSourceMs;
	const sourceAtPointer = (event: PointerEvent<HTMLDivElement>) => {
		const rect = event.currentTarget.getBoundingClientRect();
		const offset = rtl ? rect.right - event.clientX : event.clientX - rect.left;
		return Math.round(
			visibleSource.start +
				Math.max(0, Math.min(1, offset / rect.width)) *
					(visibleSource.end - visibleSource.start),
		);
	};
	const deleteSelection = () => {
		if (!selection || selection.end <= selection.start) return;
		onDeleteRange?.(clipId, track.id, { startMs: selection.start, endMs: selection.end });
		editorRef.current?.focus({ preventScroll: true });
		setSelection(null);
	};
	const side = rtl ? "right" : "left";
	const deleteLabel = t("editor.timeline.deleteSourceAudioRange", "Delete selected audio");
	return (
		<div
			ref={editorRef}
			data-source-audio-editor
			data-audio-range-selected={Boolean(selection && selection.end > selection.start)}
			data-source-audio-clip={clipId}
			data-source-start-ms={visibleSource.start}
			data-source-end-ms={visibleSource.end}
			data-deleted-ranges={JSON.stringify(setting?.deletedRanges ?? [])}
			role="group"
			tabIndex={0}
			aria-label={track.label}
			title={t(
				"editor.timeline.sourceAudioRangeHint",
				"Drag to select audio, then press Delete. Double-click to select the whole segment.",
			)}
			className="absolute inset-y-0.5 cursor-crosshair outline-none focus:ring-1 focus:ring-blue-500"
			style={{
				[side]: offset,
				width,
			}}
			onMouseDown={(event) => event.stopPropagation()}
			onClick={(event) => event.stopPropagation()}
			onBlur={(event) => {
				if (!event.currentTarget.contains(event.relatedTarget)) setSelection(null);
			}}
			onPointerDown={(event) => {
				if (event.button !== 0 || (event.target as HTMLElement).closest("button")) return;
				event.stopPropagation();
				event.preventDefault();
				event.currentTarget.focus();
				event.currentTarget.setPointerCapture(event.pointerId);
				drag.current = { sourceMs: sourceAtPointer(event), clientX: event.clientX };
				setSelection(null);
			}}
			onPointerMove={(event) => {
				if (!drag.current || Math.abs(event.clientX - drag.current.clientX) < 3) return;
				const sourceMs = sourceAtPointer(event);
				setSelection({
					start: Math.min(drag.current.sourceMs, sourceMs),
					end: Math.max(drag.current.sourceMs, sourceMs),
				});
			}}
			onPointerUp={(event) => {
				if (!drag.current) return;
				if (Math.abs(event.clientX - drag.current.clientX) < 3)
					onSeek?.(
						(displayStart +
							pixelsToValue(offset + sourceToPixel(sourceAtPointer(event)))) /
							1000,
					);
				drag.current = null;
				event.currentTarget.releasePointerCapture(event.pointerId);
			}}
			onPointerCancel={() => {
				drag.current = null;
				setSelection(null);
			}}
			onDoubleClick={(event) => {
				event.stopPropagation();
				setSelection({ ...sourceSpan });
			}}
			onKeyDown={(event) => {
				if (event.ctrlKey || event.metaKey || event.altKey) return;
				if (["Delete", "Backspace", "Escape"].includes(event.key)) {
					event.preventDefault();
					event.stopPropagation();
				}
				if (event.key === "Delete" || event.key === "Backspace") deleteSelection();
				if (event.key === "Escape") setSelection(null);
			}}
		>
			{parts.map((part) => (
				<div
					key={part.sourceStartMs}
					data-source-audio-audible
					className={`pointer-events-none absolute inset-y-0 overflow-hidden rounded border bg-sky-100 dark:bg-sky-950 ${selected ? "border-blue-500" : "border-sky-300 dark:border-sky-700"} ${muted ? "opacity-40" : ""}`}
					style={{
						[side]: part.offset,
						width: part.width,
					}}
				/>
			))}
			{selection && selection.end > selection.start && (
				<>
					<div
						data-source-audio-selection
						className="pointer-events-none absolute inset-y-0 z-[2] border border-blue-600 bg-blue-500/30"
						style={{
							[side]: sourceToPixel(selection.start),
							width: (selection.end - selection.start) * pxPerSourceMs,
						}}
					/>
					<button
						type="button"
						aria-label={deleteLabel}
						title={deleteLabel}
						className="absolute end-1 top-0 z-10 h-full rounded bg-red-600 px-2 text-[10px] text-white hover:bg-red-700"
						onClick={(event) => {
							event.stopPropagation();
							deleteSelection();
						}}
					>
						{deleteLabel}
					</button>
				</>
			)}
		</div>
	);
});
