import { expect, it } from "vitest";
import { mapMarkersToTimeline } from "./recordingMarkers";

it("moves a marker by the length of removed footage and omits markers in the removal", () => {
	const markers = [
		{ id: "kept", timeMs: 15000, kind: "cut" as const },
		{ id: "removed", timeMs: 8000, kind: "highlight" as const },
	];
	const clips = [
		{ id: "head", startMs: 0, endMs: 2000, sourceStartMs: 0, speed: 1 },
		{ id: "tail", startMs: 2000, endMs: 10000, sourceStartMs: 12000, speed: 1 },
	];
	expect(mapMarkersToTimeline(markers, clips)).toEqual([
		{ ...markers[0], clipId: "tail", timelineTimeMs: 5000 },
	]);
});

it("projects markers at the speed of each occurrence of the source", () => {
	const marker = { id: "repeat", timeMs: 14000, kind: "highlight" as const };
	const clips = [
		{ id: "first", startMs: 0, endMs: 4000, sourceStartMs: 12000, speed: 2 },
		{ id: "second", startMs: 4000, endMs: 10000, sourceStartMs: 12000, speed: 1 },
	];
	expect(mapMarkersToTimeline([marker], clips)).toMatchObject([
		{ timeMs: 14000, clipId: "first", timelineTimeMs: 1000 },
		{ timeMs: 14000, clipId: "second", timelineTimeMs: 6000 },
	]);
	expect(mapMarkersToTimeline([marker], [])).toEqual([{ ...marker, timelineTimeMs: 14000 }]);
});
