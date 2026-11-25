import { Button } from "@/components/ui/button";
import { ArrowLeft, ArrowRight, Pause, Play, SkipBack, SkipForward, SpeakerHigh, SpeakerLow, SpeakerX } from "@/components/ui/icons";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Slider } from "@/components/ui/slider";
import { useI18n } from "@/contexts/I18nContext";
import { useUiText } from "@/i18n/useUiText";
import { useLayoutEffect, useRef } from "react";
import type { useEditorPlaybackControls } from "../hooks/useEditorPlaybackControls";
import { formatTimelineTimecode } from "../timeline/core/time";
import { REVIEW_RATES } from "../videoPlayback/playbackStepping";
import type { PlaybackClock } from "../videoPlayback/playbackClock";

type Props = {
	playbackClock: PlaybackClock;
	duration: number;
	isPlaying: boolean;
	playback: ReturnType<typeof useEditorPlaybackControls>;
	volume: number;
	setVolume: (volume: number) => void;
	detached?: boolean;
};

export function PreviewTransportBar({ playbackClock, duration, isPlaying, playback, volume, setVolume, detached }: Props) {
	const { t } = useI18n();
	const text = useUiText();
	const timecodeRef = useRef<HTMLSpanElement>(null);
	useLayoutEffect(() => {
		const node = timecodeRef.current;
		if (!node) return;
		const update = () => { node.textContent = formatTimelineTimecode(playbackClock.getTime() * 1000); };
		update();
		return playbackClock.subscribe(update);
	}, [playbackClock]);
	const active = Boolean(isPlaying || playback.reverseRate);
	const playLabel = text(active ? "pause" : "play");
	const volumeLabel = t("editor.playback.volume", "Preview volume");
	const rateLabel = t("common.interface.reviewPlaybackRate");
	return (
		<>
			<div className="editor-playback-center z-10 flex flex-col items-center justify-center gap-1.5">
				<div className="pointer-events-auto flex items-center justify-center gap-1.5">
					<span ref={timecodeRef} data-testid="preview-current-time" className="mr-1 inline-block w-[12ch] shrink-0 text-right font-mono text-[10px] font-medium text-muted-foreground" />
					<Button variant="ghost" size="icon" className="size-9" title={t("editor.playback.skipBack")} onClick={playback.handlePreviewSkipBack}>
						<SkipBack className="size-3.5" weight="fill" />
					</Button>
					{detached && (
						<Button variant="ghost" size="icon" title={t("common.interface.stepFrameBack")} onClick={() => playback.stepFrames(-1)}>
							<ArrowLeft className="size-4" />
						</Button>
					)}
					<Button
						variant="ghost"
						size="icon"
						className={`size-9 ${active ? "bg-foreground/10 text-foreground hover:bg-foreground/20" : "bg-neutral-800 text-white hover:bg-neutral-700 dark:bg-white dark:text-black dark:hover:bg-white/90"}`}
						onClick={playback.togglePlayPause}
						title={playLabel}
					>
						{active ? <Pause className="size-3.5" weight="fill" /> : <Play className="size-3.5" weight="fill" />}
					</Button>
					{detached && (
						<Button variant="ghost" size="icon" title={t("common.interface.stepFrameForward")} onClick={() => playback.stepFrames(1)}>
							<ArrowRight className="size-4" />
						</Button>
					)}
					<Button variant="ghost" size="icon" className="size-9" title={t("editor.playback.skipForward")} onClick={playback.handlePreviewSkipForward}>
						<SkipForward className="size-3.5" weight="fill" />
					</Button>
					<span className="ml-1 inline-block w-[12ch] shrink-0 text-left font-mono text-[10px] font-medium text-muted-foreground/70">
						{formatTimelineTimecode(duration * 1000)}
					</span>
					{!detached && (
						<select
							aria-label={rateLabel}
							value={playback.reviewRate}
							onChange={event => {
								const rate = REVIEW_RATES.find(value => value === Number(event.target.value));
								if (rate !== undefined) playback.setReviewRate(rate);
							}}
							className="h-8 cursor-pointer rounded bg-editor-surface px-1.5 font-mono text-xs tabular-nums"
						>
							{REVIEW_RATES.map(rate => <option key={rate} value={rate}>{rate}×</option>)}
						</select>
					)}
				</div>
				{detached && (
					<div role="group" aria-label={rateLabel} className="pointer-events-auto flex items-center gap-1">
						{REVIEW_RATES.map(rate => (
							<Button key={rate} size="sm" variant={rate === playback.reviewRate ? "secondary" : "ghost"}
								aria-pressed={rate === playback.reviewRate} onClick={() => playback.setReviewRate(rate)}>
								{rate}×
							</Button>
						))}
					</div>
				)}
			</div>
			{detached ? (
				<div className="flex justify-center pt-1">
					<input type="range" min={0} max={1} step={0.01} aria-label={volumeLabel}
						value={volume} onChange={event => setVolume(Number(event.target.value))} className="h-4 w-32 accent-accent" />
				</div>
			) : (
				<div className="editor-playback-volume z-10 ml-auto flex items-center">
					<Popover>
						<PopoverTrigger asChild>
							<Button variant="ghost" size="icon" aria-label={volumeLabel} title={volumeLabel}>
								{volume <= 0.001 ? <SpeakerX className="size-3.5" /> :
									volume < 0.5 ? <SpeakerLow className="size-3.5" /> : <SpeakerHigh className="size-3.5" />}
							</Button>
						</PopoverTrigger>
						<PopoverContent side="top" sideOffset={10} aria-label={volumeLabel} className="flex w-14 flex-col items-center gap-3 p-3">
							<span className="text-[10px] tabular-nums text-muted-foreground">{Math.round(volume * 100)}%</span>
							<Slider aria-label={volumeLabel} orientation="vertical" min={0} max={1} step={0.01}
								value={[volume]} onValueChange={([value]) => setVolume(value)} className="h-28" />
						</PopoverContent>
					</Popover>
				</div>
			)}
		</>
	);
}
