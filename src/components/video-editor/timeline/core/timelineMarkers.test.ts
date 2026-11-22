import { expect, it } from "vitest";
import { mapTimelineTimeToSourceTime, type ClipRegion, type TimelineMarker } from "../../types";
import { projectTimelineMarkers } from "./timelineMarkers";

it("keeps the source time while moving a marker after a five-second ripple cut", () => {
	const original: ClipRegion[] = [{ id: "full", startMs: 0, endMs: 15000, sourceStartMs: 1000, speed: 1 }];
	const marker: TimelineMarker = {
		id: "check",
		origin: "editor",
		sourceTimeMs: mapTimelineTimeToSourceTime(11000, original),
	};
	const cut: ClipRegion[] = [
		{ id: "start", startMs: 0, endMs: 1000, sourceStartMs: 1000, speed: 1 },
		{ id: "rest", startMs: 1000, endMs: 10000, sourceStartMs: 7000, speed: 1 },
	];
	expect(projectTimelineMarkers([marker], original)).toEqual([{ ...marker, time: 11000 }]);
	expect(projectTimelineMarkers([marker], cut)).toEqual([{ ...marker, sourceTimeMs: 12000, time: 6000 }]);
	expect(projectTimelineMarkers([{ ...marker, sourceTimeMs: 5000 }], cut)[0].time).toBe(1000);
});
