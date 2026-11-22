import { enablePitchPreservingPlayback } from "@/lib/mediaTiming";
import { applyPreviewPlaybackRate } from "./playbackRate";
import {
	type ClipRegion,
	getClipSourceStartMs,
	getTimelineDurationMs,
	sortClipRegions,
} from "../types";

/** The playhead may stop at the timeline end; that is not a black gap. */
export function findPreviewClipAtTimelineTime(
	timeMs: number,
	clips: ClipRegion[],
): ClipRegion | null {
	return findPreviewClip(timeMs, sortClipRegions(clips));
}

function findPreviewClip(timeMs: number, sortedClips: ClipRegion[]): ClipRegion | null {
	const active = sortedClips.find((clip) => timeMs >= clip.startMs && timeMs < clip.endMs);
	if (active) return active;
	const last = sortedClips[sortedClips.length - 1];
	return last && Math.abs(timeMs - last.endMs) < 1e-7 ? last : null;
}

function isContinuousSourceCut(left: ClipRegion, right: ClipRegion): boolean {
	if (left.endMs !== right.startMs || left.speed !== right.speed) return false;
	const sourceEnd = getClipSourceStartMs(left) + (left.endMs - left.startMs) * left.speed;
	// Sequence edits can round source in-points to whole milliseconds.
	return Math.abs(sourceEnd - getClipSourceStartMs(right)) <= 0.5;
}

/** Timeline time advances at 1x; only the source media uses the clip's speed. */
export function createClipPlayback({
	video,
	getClips,
	getPlaybackRate = () => 1,
	getDurationMs = () => undefined,
	onTime,
	onPlaybackTick = onTime,
	onPlaying,
	onError,
	onSourceSeek,
}: {
	video: HTMLVideoElement;
	getClips: () => ClipRegion[];
	getPlaybackRate?: () => number;
	getDurationMs?: () => number | undefined;
	onTime: (timelineSeconds: number, sourceSeconds: number | null) => void;
	onPlaybackTick?: (timelineSeconds: number, sourceSeconds: number | null) => void;
	onPlaying: (playing: boolean) => void;
	onError: (error: unknown) => void;
	onSourceSeek?: (reason: "cut" | "seek") => void;
}) {
	let timeMs = 0;
	let playing = false;
	let request: number | null = null;
	let frameWindow: Window | null = null;
	const schedule = (callback: FrameRequestCallback) => {
		frameWindow = video.ownerDocument?.defaultView ?? null;
		return frameWindow
			? frameWindow.requestAnimationFrame(callback)
			: requestAnimationFrame(callback);
	};
	let lastTick = 0;
	let activeClip: ClipRegion | null = null;
	let playRequest = 0;
	let clipSnapshot: ClipRegion[] | undefined;
	let sortedClips: ClipRegion[] = [];
	let clipDuration = 0;
	const currentClips = () => {
		const clips = getClips();
		if (clips !== clipSnapshot) {
			clipSnapshot = clips;
			sortedClips = sortClipRegions(clips);
			clipDuration = getTimelineDurationMs(clips, 0);
		}
		return sortedClips;
	};
	const duration = () => {
		const explicit = getDurationMs();
		if (explicit !== undefined) return explicit;
		currentClips();
		return clipDuration;
	};

	const pause = () => {
		playRequest++;
		playing = false;
		if (request !== null) {
			if (frameWindow) frameWindow.cancelAnimationFrame(request);
			else cancelAnimationFrame(request);
		}
		request = null;
		video.pause();
		onPlaying(false);
	};
	const playSource = () => {
		const request = ++playRequest;
		void video.play().catch((error) => {
			// A deliberate seek/pause can interrupt a pending play request.
			if (!playing || request !== playRequest) return;
			pause();
			onError(error);
		});
	};
	const sync = (seek = false, notifyTime = onTime) => {
		const clips = currentClips();
		let clip = findPreviewClip(timeMs, clips);
		// Empty timeline space is skipped during playback. Clip positions and
		// paused seeks stay intact so editing a gap never moves source footage.
		if (playing && !clip) {
			clip = clips.find((candidate) => candidate.startMs > timeMs) ?? null;
			if (clip) timeMs = clip.startMs;
		}
		const changedClip = clip !== activeClip;
		const continuous =
			playing &&
			!seek &&
			!video.seeking &&
			!video.ended &&
			changedClip &&
			activeClip &&
			clip &&
			timeMs === clip.startMs &&
			isContinuousSourceCut(activeClip, clip);
		if (continuous && clip) {
			// Keep the decoder running and carry forward any progress past the seam.
			const offset = (video.currentTime * 1000 - getClipSourceStartMs(clip)) / clip.speed;
			timeMs = Math.min(clip.endMs, duration(), clip.startMs + Math.max(0, offset));
		}
		const sourceMs = clip
			? getClipSourceStartMs(clip) + (timeMs - clip.startMs) * clip.speed
			: null;
		if (clip && sourceMs !== null) {
			enablePitchPreservingPlayback(video);
			try {
				applyPreviewPlaybackRate(video, clip.speed * getPlaybackRate());
			} catch (error) {
				pause();
				onError(error);
				return;
			}
			const jump = seek || (changedClip && !continuous);
			if (jump) {
				// Clip out-points are exclusive. At the final timeline endpoint,
				// request a frame inside the clip, not EOF or the following footage.
				const atEnd = timeMs >= clip.endMs - 1e-7;
				const targetMs = atEnd
					? Math.max(getClipSourceStartMs(clip), sourceMs - 0.001)
					: sourceMs;
				const target = Math.max(
					0,
					Math.min(
						Number.isFinite(video.duration)
							? Math.max(0, video.duration - 0.000001)
							: Infinity,
						targetMs / 1000,
					),
				);
				// Assigning currentTime even to its current value starts another
				// asynchronous seek in Chromium (especially disruptive at zero).
				if (Math.abs(video.currentTime - target) > 1e-8) {
					onSourceSeek?.(playing && !seek ? "cut" : "seek");
					video.currentTime = target;
				}
			}
			// Adopting a live media element into the floating monitor can make Chromium
			// pause it asynchronously. The transport still owns the user's play intent.
			if (playing && (jump || video.paused)) playSource();
		} else {
			playRequest++;
			video.pause();
		}
		activeClip = clip;
		notifyTime(timeMs / 1000, sourceMs === null ? null : sourceMs / 1000);
	};
	const tick = (now: number) => {
		request = null;
		if (!playing) return;
		// Follow the media inside footage (buffering must not skip content).
		// With no clips loaded, elapsed real time is the fallback clock.
		if (!activeClip) timeMs += (now - lastTick) * getPlaybackRate();
		else if (!video.seeking) {
			timeMs = video.ended
				? activeClip.endMs
				: Math.min(
						activeClip.endMs,
						Math.max(
							activeClip.startMs,
							activeClip.startMs +
								(video.currentTime * 1000 - getClipSourceStartMs(activeClip)) /
									activeClip.speed,
						),
					);
		}
		timeMs = Math.min(duration(), timeMs);
		lastTick = now;
		sync(false, onPlaybackTick);
		if (!playing) return;
		if (timeMs >= duration()) pause();
		else request = schedule(tick);
	};
	return {
		get isPlaying() {
			return playing;
		},
		play: async () => {
			if (playing || duration() <= 0) return;
			if (timeMs >= duration()) timeMs = 0;
			playing = true;
			onPlaying(true);
			lastTick = performance.now();
			sync(true);
			if (playing) request = schedule(tick);
		},
		pause,
		seek: (seconds: number) => {
			timeMs = Math.max(0, Math.min(duration(), seconds * 1000));
			lastTick = performance.now();
			sync(true);
		},
		refresh: (seek = true) => {
			clipSnapshot = undefined;
			timeMs = Math.min(timeMs, duration());
			sync(seek);
		},
		dispose: pause,
	};
}
