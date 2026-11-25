import { type RefObject, type Dispatch, type SetStateAction, useCallback, useEffect, useRef, useState } from "react";
import { saveAppSetting } from "@/lib/appSettings";
import { REVIEW_RATE_SETTING_KEY } from "@/lib/storageKeys";
import type { ClipRegion } from "../types";
import { findAdjacentCut, stepFrameTime, type ReviewRate } from "../videoPlayback/playbackStepping";
import type { TimelineEditorHandle } from "../timeline/TimelineEditor";
import type { VideoPlaybackRef } from "../VideoPlayback";

interface UseEditorPlaybackControlsParams {
	videoPlaybackRef: RefObject<VideoPlaybackRef | null>;
	timelineRef: RefObject<TimelineEditorHandle | null>;
	playSourceAudioPreview: () => void;
	getCurrentTime: () => number;
	timelineDuration: number;
	reviewRate: ReviewRate;
	previewPlaybackRate: number;
	setReviewRateState: Dispatch<SetStateAction<ReviewRate>>;
	setShuttleMultiplier: Dispatch<SetStateAction<number>>;
	frameRate: number;
	videoPath: string | null;
	clipRegions: ClipRegion[];
}

const FORWARD_MULTIPLIERS = [1, 2, 4, 8];
const REVERSE_MULTIPLIERS = [1, 2, 4];
const nextRate = (rates: number[], rate: number) => rates[(rates.indexOf(rate) + 1) % rates.length];

export function useEditorPlaybackControls({
	videoPlaybackRef,
	timelineRef,
	playSourceAudioPreview,
	getCurrentTime,
	timelineDuration,
	reviewRate,
	previewPlaybackRate,
	setReviewRateState,
	setShuttleMultiplier,
	frameRate,
	videoPath,
	clipRegions,
}: UseEditorPlaybackControlsParams) {
	const getActivePlayback = useCallback(() => videoPlaybackRef.current, [videoPlaybackRef]);
	const [reverseRate, setReverseRate] = useState(0);
	const reverse = useRef<{ rate: number; frame: number; owner: Window } | null>(null);
	const boundedPlayback = useRef<{ frame: number; owner: Window } | null>(null);
	const stopReverse = useCallback(() => {
		if (!reverse.current) return false;
		reverse.current.owner.cancelAnimationFrame(reverse.current.frame);
		reverse.current = null;
		setReverseRate(0);
		return true;
	}, []);
	const stopBoundedPlayback = useCallback(() => {
		const active = boundedPlayback.current;
		if (!active) return;
		active.owner.cancelAnimationFrame(active.frame);
		boundedPlayback.current = null;
	}, []);
	// biome-ignore lint/correctness/useExhaustiveDependencies: The playback range belongs to this source.
	useEffect(() => stopBoundedPlayback, [videoPath, stopBoundedPlayback]);
	// biome-ignore lint/correctness/useExhaustiveDependencies: The source path owns the reverse shuttle's lifetime.
	useEffect(() => {
		setReverseRate(0);
		return () => {
			if (reverse.current) {
				reverse.current.owner.cancelAnimationFrame(reverse.current.frame);
				reverse.current = null;
			}
		};
	}, [videoPath]);

	const setReviewRate = useCallback((rate: ReviewRate) => {
		setReviewRateState(rate);
		setShuttleMultiplier(1);
		saveAppSetting(REVIEW_RATE_SETTING_KEY, rate);
	}, [setReviewRateState, setShuttleMultiplier]);

	const startPlayback = useCallback(() => {
		stopBoundedPlayback();
		stopReverse();
		const playback = getActivePlayback();
		if (!playback?.video) return;

		playSourceAudioPreview();
		playback.play().catch((error) => console.error("Video play failed:", error));
	}, [getActivePlayback, playSourceAudioPreview, stopBoundedPlayback, stopReverse]);

	const pauseOnly = useCallback(() => {
		stopBoundedPlayback();
		stopReverse();
		setShuttleMultiplier(1);
		getActivePlayback()?.pause();
	}, [getActivePlayback, setShuttleMultiplier, stopBoundedPlayback, stopReverse]);
	const togglePlayPause = useCallback(() => {
		const playback = getActivePlayback();
		if (!playback?.video) return;
		if (playback.isPlaying || reverse.current) pauseOnly();
		else {
			setShuttleMultiplier(1);
			startPlayback();
		}
	}, [getActivePlayback, pauseOnly, setShuttleMultiplier, startPlayback]);
	const shuttleForward = useCallback(() => {
		stopBoundedPlayback();
		const playing = getActivePlayback()?.isPlaying;
		setShuttleMultiplier(current => playing ? nextRate(FORWARD_MULTIPLIERS, current) : 1);
		if (!playing) startPlayback();
	}, [getActivePlayback, setShuttleMultiplier, startPlayback, stopBoundedPlayback]);

	const shuttleReverse = useCallback(() => {
		if (reverse.current) {
			reverse.current.rate = nextRate(REVERSE_MULTIPLIERS, reverse.current.rate);
			setReverseRate(reverse.current.rate);
			return;
		}
		const playback = getActivePlayback();
		const video = playback?.video;
		let time = getCurrentTime();
		if (!playback || !video || time <= 0) { pauseOnly(); return; }
		pauseOnly();
		const owner = video.ownerDocument?.defaultView ?? window;
		const run = { rate: 1, frame: 0, owner };
		reverse.current = run;
		setReverseRate(run.rate);
		let previous: number | null = null;
		const tick = (now: number) => {
			if (reverse.current !== run) return;
			if (getActivePlayback()?.video !== video) { stopReverse(); return; }
			if (previous === null) previous = now;
			if (!video.seeking) {
				time = Math.max(0, time - (now - previous) / 1000 * run.rate);
				previous = now;
				playback.seekTimeline(time);
				if (time === 0) { stopReverse(); return; }
			}
			run.frame = owner.requestAnimationFrame(tick);
		};
		run.frame = owner.requestAnimationFrame(tick);
	}, [getActivePlayback, getCurrentTime, pauseOnly, stopReverse]);

	const handleSeek = useCallback(
		(time: number, options: { pause?: boolean } = {}) => {
			const playback = getActivePlayback();
			const video = playback?.video;
			if (!video) return;
			stopBoundedPlayback();

			if (options.pause) pauseOnly();
			else stopReverse();
			const target = Math.min(timelineDuration, Math.max(0, time));
			playback.seekTimeline(target);
		},
		[getActivePlayback, pauseOnly, stopBoundedPlayback, stopReverse, timelineDuration],
	);
	const handleTimelineSeek = useCallback(
		(time: number) => handleSeek(time, { pause: true }),
		[handleSeek],
	);
	const playFromTime = useCallback((seconds: number) => {
		handleTimelineSeek(seconds);
		startPlayback();
	}, [handleTimelineSeek, startPlayback]);
	const playRange = useCallback((start: number, end: number) => {
		const playback = getActivePlayback();
		const video = playback?.video;
		const endTime = Math.min(end, timelineDuration);
		if (!playback || !video || endTime <= start) return;
		playFromTime(start);
		const owner = video.ownerDocument.defaultView ?? window;
		const run = { frame: 0, owner };
		boundedPlayback.current = run;
		const tick = () => {
			if (boundedPlayback.current !== run) return;
			if (getActivePlayback()?.video !== video) {
				stopBoundedPlayback();
			} else if (playback.getTimelineTime() >= endTime) {
				handleTimelineSeek(endTime);
			} else if (playback.isPlaying) {
				run.frame = owner.requestAnimationFrame(tick);
			} else stopBoundedPlayback();
		};
		run.frame = owner.requestAnimationFrame(tick);
	}, [getActivePlayback, handleTimelineSeek, playFromTime, stopBoundedPlayback, timelineDuration]);
	const stepFrames = useCallback((frames: number) => {
		handleTimelineSeek(stepFrameTime(getCurrentTime(), frames, frameRate, timelineDuration));
	}, [frameRate, getCurrentTime, handleTimelineSeek, timelineDuration]);
	const seekBy = useCallback((seconds: number) => handleTimelineSeek(getCurrentTime() + seconds), [getCurrentTime, handleTimelineSeek]);
	const seekToCut = useCallback((direction: "previous" | "next") => {
		const cut = findAdjacentCut(clipRegions, getCurrentTime() * 1000, direction);
		if (cut !== null) handleTimelineSeek(cut / 1000);
	}, [clipRegions, getCurrentTime, handleTimelineSeek]);
	const seekToStart = useCallback(() => handleTimelineSeek(0), [handleTimelineSeek]);
	const seekToEnd = useCallback(() => handleTimelineSeek(timelineDuration), [handleTimelineSeek, timelineDuration]);

	const handlePreviewSkipBack = useCallback(() => {
		const timelinePlayheadTime = getCurrentTime();
		const currentMs = timelinePlayheadTime * 1000;
		const keyframes = timelineRef.current?.keyframes ?? [];
		const previous = [...keyframes]
			.reverse()
			.find((keyframe) => keyframe.time < currentMs - 50);
		handleSeek(previous ? previous.time / 1000 : Math.max(0, timelinePlayheadTime - 5));
	}, [getCurrentTime, handleSeek, timelineRef]);

	const handlePreviewSkipForward = useCallback(() => {
		const timelinePlayheadTime = getCurrentTime();
		const currentMs = timelinePlayheadTime * 1000;
		const keyframes = timelineRef.current?.keyframes ?? [];
		const next = keyframes.find((keyframe) => keyframe.time > currentMs + 50);
		handleSeek(next ? next.time / 1000 : Math.min(timelineDuration, timelinePlayheadTime + 5));
	}, [getCurrentTime, handleSeek, timelineDuration, timelineRef]);

	return {
		previewPlaybackRate,
		reviewRate,
		setReviewRate,
		reverseRate,
		shuttleForward,
		shuttleReverse,
		pauseOnly,
		startPlayback,
		playFromTime,
		playRange,
		togglePlayPause,
		handleSeek,
		handleTimelineSeek,
		handlePreviewSkipBack,
		handlePreviewSkipForward,
		stepFrames,
		seekBy,
		seekToCut,
		seekToStart,
		seekToEnd,
	};
}
