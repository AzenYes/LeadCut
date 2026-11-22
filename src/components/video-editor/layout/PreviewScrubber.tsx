import { useState, type KeyboardEvent, type PointerEvent } from "react";
import { useI18n } from "@/contexts/I18nContext";
import { formatTimelineTimecode } from "../timeline/core/time";
import { scrubberTimeAtPosition } from "./previewScrubberTime";

type Props = {
	currentTime: number;
	duration: number;
	onSeek: (time: number) => void;
	cuts: number[];
	markers: { id: string; timeMs: number }[];
	chapters: { id: string; startMs: number }[];
};

export function PreviewScrubber({ currentTime, duration, onSeek, cuts, markers, chapters }: Props) {
	const { t } = useI18n();
	const [hoverTime, setHoverTime] = useState<number | null>(null);
	const percent = (seconds: number) => duration > 0 ? `${Math.max(0, Math.min(1, seconds / duration)) * 100}%` : "0%";
	const position = (event: PointerEvent<HTMLDivElement>) => {
		const { left, width } = event.currentTarget.getBoundingClientRect();
		return scrubberTimeAtPosition(event.clientX - left, width, duration);
	};
	const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
		let target: number;
		switch (event.key) {
			case "ArrowLeft":
			case "ArrowDown": target = currentTime - 1; break;
			case "ArrowRight":
			case "ArrowUp": target = currentTime + 1; break;
			case "Home": target = 0; break;
			case "End": target = duration; break;
			default: return;
		}
		event.preventDefault();
		onSeek(Math.max(0, Math.min(duration, target)));
	};

	return (
		<div
			role="slider"
			tabIndex={duration > 0 ? 0 : -1}
			aria-label={t("common.interface.previewScrubber")}
			aria-valuemin={0}
			aria-valuemax={Math.round(duration * 1000)}
			aria-valuenow={Math.round(Math.max(0, Math.min(currentTime, duration)) * 1000)}
			aria-valuetext={formatTimelineTimecode(currentTime * 1000)}
			aria-disabled={duration <= 0}
			className="group relative mx-4 flex h-5 shrink-0 cursor-pointer touch-none items-center rounded outline-none focus-visible:ring-2 focus-visible:ring-accent"
			onPointerDown={event => {
				if (duration <= 0 || event.button !== 0) return;
				event.currentTarget.focus({ preventScroll: true });
				event.currentTarget.setPointerCapture(event.pointerId);
				const time = position(event);
				setHoverTime(time);
				onSeek(time);
			}}
			onPointerMove={event => {
				if (duration <= 0) return;
				const time = position(event);
				setHoverTime(time);
				if (event.currentTarget.hasPointerCapture(event.pointerId)) onSeek(time);
			}}
			onPointerUp={event => {
				if (event.currentTarget.hasPointerCapture(event.pointerId)) onSeek(position(event));
			}}
			onPointerLeave={() => setHoverTime(null)}
			onPointerCancel={() => setHoverTime(null)}
			onKeyDown={handleKeyDown}
		>
			<div aria-hidden="true" className="pointer-events-none relative h-1 w-full rounded-full bg-foreground/15">
				<div className="absolute inset-y-0 left-0 rounded-full bg-accent" style={{ width: percent(currentTime) }} />
				{cuts.map(timeMs => (
					<span key={timeMs} data-testid="scrubber-cut" className="absolute -top-0.5 h-2 w-px bg-foreground/65" style={{ left: percent(timeMs / 1000) }} />
				))}
				{markers.map(marker => (
					<span key={marker.id} className="absolute -top-1 size-2 -translate-x-1/2 rotate-45 rounded-[1px] bg-warning" style={{ left: percent(marker.timeMs / 1000) }} />
				))}
				{chapters.filter(chapter => chapter.startMs > 0).map(chapter => (
					<span key={chapter.id} className="absolute -top-1.5 h-3 w-0.5 rounded bg-accent" style={{ left: percent(chapter.startMs / 1000) }} />
				))}
				<span className="absolute -top-1 size-3 -translate-x-1/2 rounded-full bg-accent shadow" style={{ left: percent(currentTime) }} />
			</div>
			{hoverTime !== null && (
				<span aria-hidden="true" className="pointer-events-none absolute bottom-full z-10 -translate-x-1/2 rounded bg-foreground px-1.5 py-0.5 font-mono text-[10px] text-background"
					style={{ left: `clamp(3rem, ${percent(hoverTime)}, calc(100% - 3rem))` }}>
					{formatTimelineTimecode(hoverTime * 1000)}
				</span>
			)}
		</div>
	);
}
