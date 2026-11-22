import assert from "node:assert/strict";
import { test } from "node:test";
import { planCuts } from "../dist/sequence.js";

test("keeps camera and B-roll aligned, trims external audio, and reports locked tracks", () => {
	const project = {
		version: 2,
		videoPath: "recording.mp4",
		editor: {
			clipRegions: [{ id: "screen", startMs: 0, endMs: 10000, sourceStartMs: 10000, speed: 1 }],
			videoTracks: [
				{ id: "camera", name: "Camera", kind: "webcam" },
				{ id: "b-roll", name: "B-roll", kind: "video" },
				{ id: "locked", name: "Locked", kind: "video", locked: true },
			],
			videoRegions: [
				{ id: "camera", trackId: "camera", startMs: 0, endMs: 10000, sourceStartMs: 20400, speed: 1, opacity: .75 },
				{ id: "b-roll", trackId: "b-roll", startMs: 500, endMs: 9500, sourceStartMs: 200, speed: 2 },
				{ id: "entirely-removed", trackId: "b-roll", startMs: 2100, endMs: 2300, sourceStartMs: 0, speed: 1 },
				{ id: "locked", trackId: "locked", startMs: 0, endMs: 10000, sourceStartMs: 400, speed: 1, futureField: ["keep"] },
			],
			audioRegions: [{ id: "audio", trackIndex: 1, startMs: 1000, endMs: 9000, sourceStartMs: 9000, speed: 1.5 }],
		},
	};
	const original = structuredClone(project);
	const result = planCuts(project, [
		{ startMs: 2000, endMs: 2600 },
		{ startMs: 4500, endMs: 5000 },
		{ startMs: 7500, endMs: 8500 },
	], "timeline");
	assert.deepEqual(project, original);
	const changed = result.project.editor;
	const camera = changed.videoRegions.filter(region => region.trackId === "camera");
	assert.equal(camera.length, changed.clipRegions.length);
	for (const [index, clip] of changed.clipRegions.entries()) {
		assert.equal(camera[index].startMs, clip.startMs);
		assert.equal(camera[index].endMs, clip.endMs);
		assert.equal(camera[index].sourceStartMs - clip.sourceStartMs, 10400);
		assert.equal(camera[index].opacity, .75);
	}
	const spans = regions => regions.map(region => [region.startMs, region.endMs, region.sourceStartMs]);
	assert.deepEqual(spans(changed.videoRegions.filter(region => region.trackId === "b-roll")), [
		[500, 2000, 200], [2000, 3900, 4400], [3900, 6400, 9200], [6400, 7400, 16200],
	]);
	assert.equal(
		JSON.stringify(changed.videoRegions.find(region => region.trackId === "locked")),
		JSON.stringify(original.editor.videoRegions.at(-1)),
	);
	assert(!changed.videoRegions.some(region => region.id === "entirely-removed"));
	assert.deepEqual(spans(changed.audioRegions), [
		[1000, 2000, 9000], [2000, 3900, 11400], [3900, 6400, 15000], [6400, 6900, 20250],
	]);
	assert.deepEqual(result.tracks.map(({ track, trackId, before, after, removedMs }) =>
		[track, trackId, before, after, removedMs]), [
		["primary", undefined, 1, 4, 2100], ["video", "camera", 1, 4, 2100],
		["video", "b-roll", 2, 4, 2300], ["video", "locked", 1, 1, 0], ["audio", "1", 1, 4, 2100],
	]);
	assert.deepEqual(result.lockedTracks.map(track => [track.trackId, track.locked]), [["locked", true]]);
});
