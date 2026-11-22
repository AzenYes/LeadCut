import { describe, expect, it } from "vitest";
import { normalizeVideoRegions, normalizeVideoTracks, rippleVideoRegions, splitVideoRegion, trimVideoRegion, getVideoRegionAudio, type VideoRegion } from "./videoTracks";
import { normalizeProjectEditor } from "./projectPersistence";
import { createWebcamVideoRegions } from "./videoTracks";
import { DEFAULT_WEBCAM_OVERLAY } from "./types";

const region: VideoRegion = { id: "camera", trackId: "camera-track", sourcePath: "/webcam.mp4", sourceStartMs: 200, sourceDurationMs: 12000, startMs: 0, endMs: 10000, speed: 1, volume: 0 };
const tracks = [{ id: "camera-track", name: "Camera", kind: "webcam" as const }];

describe("independent video tracks", () => {
	it("migrates recorded camera offsets and preserves source ranges without inventing footage", () => {
		const clips = [{ id: "screen", startMs: 0, endMs: 3000, sourceStartMs: 1000, speed: 2 }];
		const webcam = { ...DEFAULT_WEBCAM_OVERLAY, sourcePath: "/camera.mp4", timeOffsetMs: 200, visibleRanges: [{ startMs: 1500, endMs: 2500 }, { startMs: 4000, endMs: 5000 }] };
		expect(createWebcamVideoRegions(clips, webcam, 7000, "camera").map(({ startMs, endMs, sourceStartMs }) => ({ startMs, endMs, sourceStartMs }))).toEqual([{ startMs: 250, endMs: 750, sourceStartMs: 1300 }, { startMs: 1500, endMs: 2000, sourceStartMs: 3800 }]);
		expect(createWebcamVideoRegions(clips, { ...webcam, visibleRanges: [] }, 7000, "camera")).toEqual([]);
	});
	it("trims source in-points and preserves them when moving", () => {
		const trimmed = trimVideoRegion(region, 2000, 10000);
		expect(trimmed.sourceStartMs).toBe(2200);
		const moved = trimVideoRegion(trimmed, 5000, 13000);
		expect(moved).toMatchObject({ startMs: 5000, endMs: 13000, sourceStartMs: 2200 });
	});
	it("splits the webcam independently of primary footage", () => {
		expect(splitVideoRegion(region, 1500, () => "right")).toEqual([{ ...region, endMs: 1500 }, { ...region, id: "right", startMs: 1500, sourceStartMs: 1700 }]);
	});
	it("removes deleted primary time without losing webcam source synchronization", () => {
		const before = [{ id: "a", startMs: 0, endMs: 3000, sourceStartMs: 0, speed: 1 }, { id: "b", startMs: 3000, endMs: 5000, sourceStartMs: 3000, speed: 1 }, { id: "c", startMs: 5000, endMs: 10000, sourceStartMs: 5000, speed: 1 }];
		const after = [before[0], { ...before[2], startMs: 3000, endMs: 8000 }];
		const camera = rippleVideoRegions([region], before, after);
		expect(camera.map(({ startMs, endMs, sourceStartMs }) => ({ startMs, endMs, sourceStartMs }))).toEqual([{ startMs: 0, endMs: 3000, sourceStartMs: 200 }, { startMs: 3000, endMs: 8000, sourceStartMs: 5200 }]);
	});
	it("retimes linked camera motion through a primary speed edit", () => {
		const before = [{ id: "a", startMs: 0, endMs: 10000, sourceStartMs: 0, speed: 1 }];
		expect(rippleVideoRegions([region], before, [{ ...before[0], endMs: 5000, speed: 2 }])[0]).toMatchObject({ startMs: 0, endMs: 5000, speed: 2, sourceStartMs: 200 });
	});
	it("persists tracks, source in-points and hidden/mute/lock state", () => {
		const editor = normalizeProjectEditor({ videoTracks: [{ ...tracks[0], hidden: true, muted: true, locked: true }], videoRegions: [region] });
		expect(editor.videoRegions).toEqual([{ ...region, kind: "webcam" }]);
		expect(editor.videoTracks?.[0]).toMatchObject({ hidden: true, muted: true, locked: true });
		expect(normalizeVideoRegions([{ ...region, endMs: Infinity }], tracks)).toEqual([]);
		expect(normalizeVideoRegions([{ ...region, trackId: "missing" }], tracks)).toEqual([]);
		expect(normalizeVideoTracks([...tracks, ...tracks])).toHaveLength(1);
	});
	it("routes B-roll sound with its source in-point and excludes silent or muted layers", () => {
		const videoTracks = [{ ...tracks[0], kind: "video" as const }];
		const broll = { ...region, volume: 0.8, sourceStartMs: 500, speed: 2 };
		expect(getVideoRegionAudio([broll], videoTracks)[0]).toMatchObject({ audioPath: broll.sourcePath, sourceStartMs: 500, speed: 2, volume: 0.8 });
		expect(getVideoRegionAudio([{ ...broll, hasAudio: false }], videoTracks)).toEqual([]);
		expect(getVideoRegionAudio([broll], [{ ...videoTracks[0], muted: true }])).toEqual([]);
	});
});
