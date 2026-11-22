import type { ClipRegion, AudioRegion, WebcamOverlaySettings } from "./types";
import { getClipSourceStartMs } from "./types";

export interface VideoTrack {
	id: string;
	name: string;
	kind: "video" | "webcam";
	hidden?: boolean;
	muted?: boolean;
	locked?: boolean;
}

export const DEFAULT_WEBCAM_TRACK_ID = "video-webcam";

export interface VideoRegion {
	kind?: "video" | "webcam";
	id: string;
	trackId: string;
	sourcePath: string;
	sourceDurationMs: number;
	hasAudio?: boolean;
	sourceStartMs: number;
	startMs: number;
	endMs: number;
	speed: number;
	volume: number;
	muted?: boolean;
	fit?: "cover" | "contain";
	opacity?: number;
}

/** Migrate camera footage to editable clips while retaining imported-sequence holes. */
export function createWebcamVideoRegions(clips: ClipRegion[], webcam: WebcamOverlaySettings, sourceDurationMs: number, trackId: string): VideoRegion[] {
	if (!webcam.sourcePath) return [];
	const sourcePath = webcam.sourcePath;
	return clips.flatMap((clip) => {
		const sourceStart = getClipSourceStartMs(clip);
		const sourceEnd = sourceStart + (clip.endMs - clip.startMs) * clip.speed;
		const ranges = webcam.visibleRanges ?? [{ startMs: sourceStart, endMs: sourceEnd }];
		return ranges.flatMap((range, index) => {
			const start = Math.max(sourceStart, range.startMs, webcam.timeOffsetMs);
			const end = Math.min(sourceEnd, range.endMs);
			if (end <= start) return [];
			return [{ id: `webcam-${clip.id}-${index}`, kind: "webcam" as const, trackId, sourcePath, sourceDurationMs: Math.max(sourceDurationMs, end - webcam.timeOffsetMs), sourceStartMs: start - webcam.timeOffsetMs, startMs: clip.startMs + (start - sourceStart) / clip.speed, endMs: clip.startMs + (end - sourceStart) / clip.speed, speed: clip.speed, volume: 0, muted: true }];
		});
	});
}

export function getVideoRegionAudio(regions: VideoRegion[], tracks: VideoTrack[]): AudioRegion[] {
	return regions.flatMap((region) => {
		const track = tracks.find((track) => track.id === region.trackId);
		return !track || track.muted || region.muted || region.hasAudio === false || (region.kind ?? track.kind) === "webcam" || region.volume <= 0 ? [] : [{ id: `video-audio:${region.id}`, audioPath: region.sourcePath, startMs: region.startMs, endMs: region.endMs, sourceStartMs: region.sourceStartMs, speed: region.speed, volume: region.volume }];
	});
}

export function normalizeVideoTracks(value: unknown): VideoTrack[] {
	if (!Array.isArray(value)) return [];
	const seen = new Set<string>();
	return value.filter((track): track is VideoTrack => {
		if (!track || typeof track.id !== "string" || seen.has(track.id)) return false;
		seen.add(track.id);
		return typeof track.name === "string" && ["video", "webcam"].includes(track.kind);
	}).map((track) => ({ id: track.id, name: track.name, kind: track.kind, hidden: Boolean(track.hidden), muted: Boolean(track.muted), locked: Boolean(track.locked) }));
}

export function normalizeVideoRegions(value: unknown, tracks: VideoTrack[]): VideoRegion[] {
	if (!Array.isArray(value)) return [];
	const seen = new Set<string>();
	return value.flatMap((region): VideoRegion[] => {
		if (!region || typeof region.id !== "string" || seen.has(region.id) || typeof region.sourcePath !== "string" || !tracks.some((track) => track.id === region.trackId)) return [];
		if (![region.startMs, region.endMs, region.sourceStartMs, region.sourceDurationMs, region.speed].every(Number.isFinite)) return [];
		if (region.startMs < 0 || region.endMs <= region.startMs || region.sourceStartMs < 0 || region.sourceDurationMs <= 0 || region.speed <= 0) return [];
		seen.add(region.id);
		const endMs = Math.min(region.endMs, region.startMs + (region.sourceDurationMs - region.sourceStartMs) / region.speed);
		return endMs > region.startMs ? [{ ...region, kind: region.kind === "webcam" || region.kind === "video" ? region.kind : tracks.find((track) => track.id === region.trackId)!.kind, endMs, volume: Number.isFinite(region.volume) ? Math.max(0, Math.min(2, region.volume)) : 1 }] : [];
	});
}

export function trimVideoRegion(region: VideoRegion, startMs: number, endMs: number): VideoRegion {
	const duration = region.endMs - region.startMs;
	const isMove = Math.abs(endMs - startMs - duration) < 1;
	if (isMove) {
		const start = Math.max(0, Math.round(startMs));
		return { ...region, startMs: start, endMs: start + duration };
	}
	const start = Math.max(region.startMs - region.sourceStartMs / region.speed, 0, startMs);
	const sourceStartMs = Math.max(0, region.sourceStartMs + (start - region.startMs) * region.speed);
	const end = Math.min(Math.max(start + 1, endMs), start + (region.sourceDurationMs - sourceStartMs) / region.speed);
	return { ...region, startMs: start, endMs: end, sourceStartMs };
}

export function splitVideoRegion(region: VideoRegion, atMs: number, createId: () => string): VideoRegion[] {
	if (atMs <= region.startMs || atMs >= region.endMs) return [region];
	return [
		{ ...region, endMs: atMs },
		{ ...region, id: createId(), startMs: atMs, sourceStartMs: region.sourceStartMs + (atMs - region.startMs) * region.speed },
	];
}

/** Connected video/audio footage follows retained primary content without stretching across removed time. */
export function rippleVideoRegions(regions: VideoRegion[], before: ClipRegion[], after: ClipRegion[]): VideoRegion[] {
	const result: VideoRegion[] = [];
	for (const region of regions) {
		let part = 0;
		for (const oldClip of before) {
			const next = after.find((clip) => clip.id === oldClip.id);
			if (!next) continue;
			const oldSpeed = oldClip.speed || 1;
			const retainedStart = oldClip.startMs + (getClipSourceStartMs(next) - getClipSourceStartMs(oldClip)) / oldSpeed;
			const retainedEnd = retainedStart + (next.endMs - next.startMs) * next.speed / oldSpeed;
			const start = Math.max(region.startMs, oldClip.startMs, retainedStart);
			const end = Math.min(region.endMs, oldClip.endMs, retainedEnd);
			if (end <= start) continue;
			const ratio = oldSpeed / next.speed;
			const startMs = next.startMs + (start - retainedStart) * ratio;
			result.push({ ...region, id: part++ === 0 ? region.id : `${region.id}~${next.id}`, startMs, endMs: startMs + (end - start) * ratio, sourceStartMs: region.sourceStartMs + (start - region.startMs) * region.speed, speed: region.speed / ratio });
		}
		const beforeEnd = Math.max(0, ...before.map((clip) => clip.endMs));
		if (region.endMs > beforeEnd) {
			const start = Math.max(beforeEnd, region.startMs);
			const afterEnd = Math.max(0, ...after.map((clip) => clip.endMs));
			result.push({ ...region, id: part ? `${region.id}~tail` : region.id, startMs: afterEnd + start - beforeEnd, endMs: afterEnd + region.endMs - beforeEnd, sourceStartMs: region.sourceStartMs + (start - region.startMs) * region.speed });
		}
	}
	return result;
}
