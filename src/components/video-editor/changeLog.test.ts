import { expect, it } from "vitest";
import { normalizeChangeLog, resolveEntryTimelineMs } from "./changeLog";

const cut = {
	id: "cut-1", kind: "cut", source: "agent", createdAt: "2026-11-19T12:30:00.000Z", batchId: "batch",
	rangeIndex: 0, sourceStartMs: 20.4, sourceEndMs: 70.4, speed: 1,
	durationMs: 50, timelineMs: 8.6, reason: "  repeated phrase  ", confidence: "medium",
};

it("drops malformed and duplicate entries, normalizes milliseconds and preserves review state", () => {
	expect(normalizeChangeLog({ version: 2, entries: [cut] })).toEqual({ version: 1, entries: [] });
	const result = normalizeChangeLog({ version: 1, entries: [
		null, { ...cut, id: "bad", createdAt: "today" }, { ...cut, id: "bad-time", sourceEndMs: 20.1 },
		{ ...cut, id: "bad-speed", speed: 0 }, cut, cut,
		{ ...cut, id: "reviewed", review: "accepted", confidence: "invalid" },
	] });
	expect(result.entries).toHaveLength(2);
	expect(result.entries[0]).toMatchObject({
		sourceStartMs: 20, sourceEndMs: 70, timelineMs: 9,
		reason: "repeated phrase", confidence: "medium", review: "pending",
	});
	expect(result.entries[1].review).toBe("accepted");
	expect(result.entries[1]).not.toHaveProperty("confidence");
});

it("resolves a cut from the current source bounds even if the clip array is unordered", () => {
	const clips = [
		{ startMs: 170, endMs: 200, sourceStartMs: 900 },
		{ startMs: 0, endMs: 120, sourceStartMs: 10 },
		{ startMs: 120, endMs: 170, sourceStartMs: 400 },
	];
	expect(resolveEntryTimelineMs({ sourceEndMs: 330 }, clips)).toBe(120);
	expect(resolveEntryTimelineMs({ sourceEndMs: 1500 }, clips)).toBe(200);
});
