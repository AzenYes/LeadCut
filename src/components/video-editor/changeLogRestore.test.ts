import { expect, it } from "vitest";
import type { ChangeLogEntry } from "./changeLog";
import { insertTimelineGap, projectChangeLogEntry, restoreClipSequence } from "./changeLogRestore";
import { packClipSequence, rippleRegions } from "./clipSequence";
import { getClipSourceEndMs, type CaptionCue, type ClipRegion } from "./types";

const entry: ChangeLogEntry = {
	id: "repeat", source: "agent", kind: "cut", batchId: "first", createdAt: "2026-11-19T00:00:00.000Z",
	rangeIndex: 0, sourceStartMs: 2000, sourceEndMs: 4000, speed: 1, durationMs: 2000, timelineMs: 2000,
};
const clips: ClipRegion[] = [
	{ id: "left", startMs: 0, endMs: 2000, sourceStartMs: 0, sourceMinMs: 0, sourceMaxMs: 8000, speed: 1 },
	{ id: "right", startMs: 2000, endMs: 4000, sourceStartMs: 4000, speed: 1 },
];

it("restores the full 0–6s source span and shifts later zooms by the insertion duration", () => {
	expect(projectChangeLogEntry(entry, clips)).toBe(2000);
	const restored = packClipSequence(restoreClipSequence(clips, entry, () => "restored"));
	expect(restored.map(clip => [clip.sourceStartMs, getClipSourceEndMs(clip)]))
		.toEqual([[0, 2000], [2000, 4000], [4000, 6000]]);
	expect(restored[1]).toMatchObject({ sourceMinMs: 0, sourceMaxMs: 8000 });
	expect(restored[2].endMs).toBe(6000);
	expect(rippleRegions([{ startMs: 2300, endMs: 3700 }], clips, restored))
		.toEqual([{ startMs: 4300, endMs: 5700 }]);
});

it("places the restored source range between surviving neighbors, even with additional cuts", () => {
	const survivors = [
		{ ...clips[0], endMs: 1000 },
		{ ...clips[1], startMs: 1000, endMs: 2000, sourceStartMs: 5000 },
	];
	expect(restoreClipSequence(survivors, entry, () => "restored").map(clip => clip.id))
		.toEqual(["left", "restored", "right"]);
	expect(restoreClipSequence(survivors.slice(1), entry, () => "restored").map(clip => clip.id))
		.toEqual(["restored", "right"]);
});

it("moves only downstream timeline captions and their word timestamps", () => {
	const cues: CaptionCue[] = [
		{ id: "earlier", startMs: 1500, endMs: 2300, text: "Earlier", timeBasis: "timeline" },
		{ id: "later", startMs: 2000, endMs: 2500, text: "Later", timeBasis: "timeline",
			words: [{ text: "Later", startMs: 2000, endMs: 2400 }] },
		{ id: "source", startMs: 2100, endMs: 2600, text: "Source" },
	];
	const next = insertTimelineGap(cues, 2000, 2000);
	expect(next[0]).toBe(cues[0]);
	expect(next[1]).toMatchObject({ startMs: 4000, endMs: 4500, words: [{ startMs: 4000, endMs: 4400 }] });
	expect(next[2]).toBe(cues[2]);
});
