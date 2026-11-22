import { expect, it } from "vitest";
import { findActiveRowIndex, formatCaptionTime, groupCaptionRows } from "./captionListModel";
import { projectCaptionCues } from "../captionTimeline";

it("finds the active row in a thousand cues and excludes inter-caption gaps", () => {
	const rows = Array.from({ length: 1000 }, (_, i) => ({ startMs: i * 1000, endMs: i * 1000 + 900 }));
	expect(findActiveRowIndex(rows, 876_450)).toBe(876);
	expect(findActiveRowIndex(rows, 876_900)).toBe(-1);
	expect(findActiveRowIndex(rows, -1)).toBe(-1);
	expect(findActiveRowIndex(rows, 999_899)).toBe(999);
});

it("retains the projected fragments but displays one row for a source cue across two clips", () => {
	const fragments = projectCaptionCues([{ id: "cue", startMs: 500, endMs: 2500, text: "one cue" }], [
		{ id: "left", startMs: 0, endMs: 1000, sourceStartMs: 0, speed: 1 },
		{ id: "right", startMs: 1000, endMs: 2000, sourceStartMs: 2000, speed: 1 },
	]);
	expect(fragments).toHaveLength(2);
	expect(groupCaptionRows(fragments)).toMatchObject([{
		id: "cue", startMs: 500, endMs: 1500, text: "one cue", number: 1, fragments,
	}]);
});

it("formats tenths of a second with optional hours for caption rows", () => {
	expect(formatCaptionTime(49_830)).toBe("0:49.8");
	expect(formatCaptionTime(3_661_100)).toBe("1:01:01.1");
});
