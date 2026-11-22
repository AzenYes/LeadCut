import { useTimelineContext, type Span } from "dnd-timeline";
import { memo, useRef, useState, type PointerEvent } from "react";
import { useI18n } from "@/contexts/I18nContext";
import type { SourceAudioTrackSetting, SourceAudioTrackWithPeaks } from "../../../audio/audioTypes";
import { getAudibleSourceAudioRanges } from "../../../audio/sourceAudioEdits";
import type { TimelineAudioPeaksResult } from "../../hooks/useTimelineAudioPeaks";
import AudioWaveform from "./AudioWaveform";
import { getVisibleWaveformSpan } from "./waveformSampling";

export function WaveformLoadStatus({
	loading, progress, error, retry, label,
}: Pick<TimelineAudioPeaksResult, "loading" | "progress" | "error" | "retry"> & { label?: string }) {
	const { t } = useI18n();
	if (!loading && !error) return null;
	const percent = progress === null ? null : Math.floor(progress * 100);
	return (
		<div role="status" className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
			{label && <span className="font-medium">{label}</span>}
			{loading ? (
				<span>{percent === null
					? t("editor.timeline.waveformGenerating")
					: t("editor.timeline.waveformProgress", undefined, { percent })}</span>
			) : (
				<>
					<span title={error ?? undefined}>{t("editor.timeline.waveformFailed")}</span>
					<button
						type="button"
						className="rounded px-1.5 py-0.5 text-foreground underline"
						onPointerDown={(event) => event.stopPropagation()}
						onClick={(event) => { event.stopPropagation(); retry(); }}
					>
						{t("editor.timeline.waveformRetry")}
					</button>
				</>
			)}
		</div>
	);
}

interface Props {
	clipId: string;
	track: SourceAudioTrackWithPeaks;
	displaySpan: Span;
	sourceSpan: Span;
	selected: boolean;
	muted?: boolean;
	setting?: SourceAudioTrackSetting;
	onDeleteRange?: (
		clipId: string,
		trackId: string,
		range: { startMs: number; endMs: number },
	) => void;
	onSeek?: (time: number) => void;
}

export const SourceAudioWaveform = memo(function SourceAudioWaveform({
	clipId,
	track,
	displaySpan,
	sourceSpan,
	selected,
	muted,
	setting,
	onDeleteRange,
	onSeek,
}: Props) {
	const { range, valueToPixels, direction } = useTimelineContext();
	const { t } = useI18n();
	const [selection, setSelection] = useState<Span | null>(null);
	const editorRef = useRef<HTMLDivElement>(null);
	const drag = useRef<{ sourceMs: number; clientX: number } | null>(null);
	const visible = getVisibleWaveformSpan(displaySpan, sourceSpan, range);
	if (!visible) return null;
	const sourceDuration = sourceSpan.end - sourceSpan.start;
	const displayDuration = displaySpan.end - displaySpan.start;
	const sourceToDisplay = (sourceMs: number) =>
		displaySpan.start + ((sourceMs - sourceSpan.start) / sourceDuration) * displayDuration;
	const sourceAtPointer = (event: PointerEvent<HTMLDivElement>) => {
		const rect = event.currentTarget.getBoundingClientRect();
		const offset = direction === "rtl" ? rect.right - event.clientX : event.clientX - rect.left;
		return Math.round(
			visible.source.start +
				Math.max(0, Math.min(1, offset / rect.width)) *
					(visible.source.end - visible.source.start),
		);
	};
	const audible = getAudibleSourceAudioRanges(
		{ startMs: visible.source.start, endMs: visible.source.end },
		setting?.deletedRanges,
	);
	const deleteSelection = () => {
		if (!selection || selection.end <= selection.start) return;
		onDeleteRange?.(clipId, track.id, { startMs: selection.start, endMs: selection.end });
		editorRef.current?.focus({ preventScroll: true });
		setSelection(null);
	};
	const side = direction === "rtl" ? "right" : "left";
	// Lane geometry and saved deletions use video time. Only peak sampling uses WAV time.
	const startDelayMs = track.startDelayMs ?? 0;
	const deleteLabel = t("editor.timeline.deleteSourceAudioRange", "Delete selected audio");
	return (
		<div
			ref={editorRef}
			data-source-audio-editor
			data-audio-range-selected={Boolean(selection && selection.end > selection.start)}
			data-source-audio-clip={clipId}
			data-source-start-ms={visible.source.start}
			data-source-end-ms={visible.source.end}
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
				[side]: valueToPixels(visible.display.start - range.start),
				width: valueToPixels(visible.display.end - visible.display.start),
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
					onSeek?.(sourceToDisplay(sourceAtPointer(event)) / 1000);
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
			{audible.map((span) => (
				<div
					key={span.startMs}
					data-source-audio-audible
					className={`pointer-events-none absolute inset-y-0 overflow-hidden rounded border bg-sky-100 dark:bg-sky-950 ${selected ? "border-blue-500" : "border-sky-300 dark:border-sky-700"} ${muted || setting?.volume === 0 ? "opacity-40" : ""}`}
					style={{
						[side]: valueToPixels(
							sourceToDisplay(span.startMs) - visible.display.start,
						),
						width: valueToPixels(
							((span.endMs - span.startMs) / sourceDuration) * displayDuration,
						),
					}}
				>
					<AudioWaveform
						peaks={track.peaks}
						segmentStartMs={span.startMs - startDelayMs}
						segmentEndMs={span.endMs - startDelayMs}
						color="source"
					/>
				</div>
			))}
			{selection && selection.end > selection.start && (
				<>
					<div
						data-source-audio-selection
						className="pointer-events-none absolute inset-y-0 border border-blue-600 bg-blue-500/30"
						style={{
							[side]: valueToPixels(
								sourceToDisplay(selection.start) - visible.display.start,
							),
							width: valueToPixels(
								((selection.end - selection.start) / sourceDuration) *
									displayDuration,
							),
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
