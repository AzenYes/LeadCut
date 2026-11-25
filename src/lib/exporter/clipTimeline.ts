import { type ClipRegion, getClipSourceStartMs } from "@/components/video-editor/types";

/** Trim-only native paths concatenate source ranges; they cannot place clips. */
export function requiresClipTimelineRendering(clips?: ClipRegion[]): boolean {
	if (!clips) return false;
	return (
		clips.length !== 1 ||
		clips[0].startMs !== 0 ||
		getClipSourceStartMs(clips[0]) !== 0 ||
		clips[0].speed !== 1
	);
}

export function hasContinuousClipSourceAudio(clips: ClipRegion[]): boolean {
	const orderedClips = [...clips].sort((first, second) => first.startMs - second.startMs);
	let expectedStartMs = 0;
	for (const clip of orderedClips) {
		if (
			clip.startMs !== expectedStartMs || clip.speed !== 1 ||
			!Number.isFinite(clip.endMs) || clip.endMs <= clip.startMs ||
			getClipSourceStartMs(clip) !== clip.startMs ||
			(clip.sourceMinMs ?? clip.startMs) > clip.startMs ||
			(clip.sourceMaxMs ?? clip.endMs) < clip.endMs
		) return false;
		expectedStartMs = clip.endMs;
	}
	return orderedClips.length > 0;
}
