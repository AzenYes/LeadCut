import { expect, it } from "vitest";
import type { ClipRegion } from "../types";
import { findAdjacentCut, getCutSeams, stepFrameTime } from "./playbackStepping";

const clips: ClipRegion[] = [
	{ id: "a", startMs: 0, endMs: 1000, sourceStartMs: 0, speed: 2 },
	{ id: "b", startMs: 1000, endMs: 2000, sourceStartMs: 2001, speed: 1 },
	{ id: "c", startMs: 2000, endMs: 3000, sourceStartMs: 4500, speed: 1 },
	{ id: "d", startMs: 3000, endMs: 4000, sourceStartMs: 8000, speed: 1 },
];

it("advances by the export frame duration within the timeline endpoints", () => {
	expect(stepFrameTime(0, 1, 30, 3)).toBeCloseTo(1 / 30);
	expect(stepFrameTime(0, -1, 30, 3)).toBe(0);
	expect(stepFrameTime(3, 1, 30, 3)).toBe(3);
	expect(stepFrameTime(1, -2, 60, 3)).toBeCloseTo(1 - 2 / 60);
});

it("detects source discontinuities and respects clip speed and one millisecond tolerance", () => {
	expect(getCutSeams([...clips].reverse())).toEqual([2000, 3000]);
	expect(getCutSeams(clips.slice(0, 2))).toEqual([]);
});

it("finds the adjacent cut strictly in the requested direction", () => {
	expect(findAdjacentCut(clips, 0, "next")).toBe(2000);
	expect(findAdjacentCut(clips, 2000, "next")).toBe(3000);
	expect(findAdjacentCut(clips, 3000, "previous")).toBe(2000);
	expect(findAdjacentCut(clips, 1999, "previous")).toBeNull();
	expect(findAdjacentCut(clips, 3000, "next")).toBeNull();
});
