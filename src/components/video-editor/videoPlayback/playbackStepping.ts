import { getClipSourceEndMs, getClipSourceStartMs, sortClipRegions, type ClipRegion } from "../types";

export const REVIEW_RATES = [1, 1.25, 1.5, 2, 3] as const;
export type ReviewRate = (typeof REVIEW_RATES)[number];

export function stepFrameTime(timeSec: number, frames: number, fps: number, durationSec: number) {
	const frameRate = Number.isFinite(fps) && fps > 0 ? fps : 30;
	return Math.max(0, Math.min(durationSec, timeSec + frames / frameRate));
}

export function getCutSeams(clips: ClipRegion[]): number[] {
	const ordered = sortClipRegions(clips);
	const cuts: number[] = [];
	for (let index = 1; index < ordered.length; index++) {
		const previous = ordered[index - 1];
		const next = ordered[index];
		const sourceEnd = getClipSourceEndMs(previous);
		if (Math.abs(sourceEnd - getClipSourceStartMs(next)) > 1) cuts.push(next.startMs);
	}
	return cuts;
}

export function findAdjacentCut(clips: ClipRegion[], timeMs: number, direction: "previous" | "next") {
	const cuts = getCutSeams(clips);
	if (direction === "next") return cuts.find(cut => cut > timeMs + 0.001) ?? null;
	return cuts.reverse().find(cut => cut < timeMs - 0.001) ?? null;
}
