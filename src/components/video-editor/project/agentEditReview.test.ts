import { describe, expect, it, vi } from "vitest";
import { emptyChapterProgress } from "../chapterProgress";
import { normalizeProjectEditor } from "../projectPersistence";
import { canRestoreAgentEdit, findAgentEdits, findAgentEditsThroughRevisions, mergeAgentReviewEdits, restoreAgentEdit } from "./agentEditReview";

const base = {
	...normalizeProjectEditor({
		clipRegions: [{ id: "clip", startMs: 0, endMs: 4000, sourceStartMs: 0, speed: 1 }],
		autoCaptions: [{ id: "caption", startMs: 600, endMs: 2000, text: "Original", timeBasis: "timeline" }],
	}),
	sourcePath: "recording.mp4",
	chapterProgress: emptyChapterProgress(),
	transcript: null,
};

const edited = {
	...base,
	autoCaptionSettings: { ...base.autoCaptionSettings, fontSize: 56 },
	autoCaptions: base.autoCaptions.map(cue => ({ ...cue, text: "Agent revision" })),
};

describe("Agent edit review", () => {
	it("reviews multiple writes to an item as one change from the original value", () => {
		const latest = { ...edited, autoCaptions: edited.autoCaptions.map(cue => ({ ...cue, text: "Final revision" })) };
		const firstWrite = findAgentEdits(base, edited, "first");
		const secondWrite = findAgentEdits(edited, latest, "second");
		const changes = mergeAgentReviewEdits(firstWrite, secondWrite);
		const caption = changes.find(change => change.field === "autoCaptions")!;
		expect(changes).toHaveLength(2);
		expect(caption).toMatchObject({ id: "first:autoCaptions:caption", before: base.autoCaptions, after: latest.autoCaptions });
		const current = { ...latest, setAutoCaptions: vi.fn() };
		expect(restoreAgentEdit(caption, current as unknown as Parameters<typeof restoreAgentEdit>[1], current.sourcePath)).toBe(true);
		expect(current.setAutoCaptions).toHaveBeenCalledWith(base.autoCaptions);
		expect(mergeAgentReviewEdits(changes, findAgentEdits(latest, base, "rollback"))).toEqual([]);
	});

	it("keeps reviewed entries and edits on either side of a cut separate", () => {
		const [caption, appearance] = findAgentEdits(base, edited, "first");
		const cut = { ...edited, clipRegions: [{ ...edited.clipRegions[0], endMs: 3100 }] };
		const latest = { ...cut, autoCaptions: base.autoCaptions, autoCaptionSettings: base.autoCaptionSettings };
		const changes = mergeAgentReviewEdits([caption, { ...appearance, status: "accepted" }], findAgentEdits(cut, latest, "after-cut"));
		expect(changes.map(change => change.id)).toEqual([caption.id, appearance.id, "after-cut:autoCaptions:caption", "after-cut:autoCaptionSettings"]);
		expect(changes.map(change => canRestoreAgentEdit(change, latest))).toEqual([false, false, true, true]);
	});

	it("keeps a reinserted item reviewable when it returns in a different position", () => {
		const first = base.autoCaptions[0];
		const second = { ...first, id: "second" };
		const before = { ...base, autoCaptions: [first, second] };
		const removed = { ...base, autoCaptions: [second] };
		const reinserted = { ...base, autoCaptions: [second, first] };
		const deletion = findAgentEdits(before, removed, "remove");
		const insertion = findAgentEdits(removed, reinserted, "insert");
		expect(mergeAgentReviewEdits(deletion, insertion)).toEqual([...deletion, ...insertion]);
	});

	it("allows reverting independent changes while protecting newer work", () => {
		const edits = findAgentEdits(base, edited, "round-one");
		const captions = edits.find(edit => edit.field === "autoCaptions")!;
		const appearance = edits.find(edit => edit.field === "autoCaptionSettings")!;
		expect(edits).toHaveLength(2);
		expect(canRestoreAgentEdit(captions, edited)).toBe(true);
		expect(canRestoreAgentEdit(appearance, edited)).toBe(true);
		const current = { ...edited, autoCaptions: base.autoCaptions };
		expect(canRestoreAgentEdit(captions, current)).toBe(false);
		expect(canRestoreAgentEdit(appearance, current)).toBe(true);
	});

	it("leaves time-dependent changes coupled to the cuts that changed their positions", () => {
		const cut = { ...edited, clipRegions: [{ ...edited.clipRegions[0], endMs: 3100 }] };
		expect(findAgentEdits(base, cut, "round-cut").map(edit => edit.field)).toEqual(["autoCaptionSettings"]);
		const captions = findAgentEdits(base, edited, "round-one").find(edit => edit.field === "autoCaptions")!;
		expect(canRestoreAgentEdit(captions, cut)).toBe(false);
	});

	it("uses the post-cut coordinates to revert a later Agent edit without undoing the cut", () => {
		const cut = {
			...base,
			clipRegions: [{ ...base.clipRegions[0], endMs: 3100, sourceStartMs: 900 }],
			autoCaptions: [{ ...base.autoCaptions[0], startMs: 0, endMs: 1100 }],
		};
		const final = { ...cut, autoCaptions: [{ ...cut.autoCaptions[0], text: "New text" }] };
		expect(findAgentEditsThroughRevisions(base, [final], "without-history")).toEqual([]);
		const edits = findAgentEditsThroughRevisions(base, [cut, final], "with-history");
		expect(edits).toHaveLength(1);
		expect(edits[0]).toMatchObject({ field: "autoCaptions", before: cut.autoCaptions, after: final.autoCaptions });
		expect(canRestoreAgentEdit(edits[0], final)).toBe(true);
		expect(canRestoreAgentEdit(edits[0], {
			...final, trimRegions: [{ id: "trim-gap-1", startMs: 0, endMs: 900 }],
		})).toBe(true);
	});

	it("reviews a source-timed caption edit when the same disk update also contains a cut", () => {
		const original = { ...base.autoCaptions[0], timeBasis: undefined };
		const before = { ...base, autoCaptions: [original] };
		const after = {
			...before,
			clipRegions: [{ ...base.clipRegions[0], endMs: 3100, sourceStartMs: 900 }],
			autoCaptions: [{ ...original, text: "Edited on the source clock" }],
		};
		const [caption] = findAgentEdits(before, after, "coalesced");
		expect(caption).toMatchObject({ field: "autoCaptions", target: { id: original.id } });
		const current = { ...after, clipRegions: [{ ...after.clipRegions[0], endMs: 2900 }], setAutoCaptions: vi.fn() };
		expect(restoreAgentEdit(caption, current as unknown as Parameters<typeof restoreAgentEdit>[1], current.sourcePath)).toBe(true);
		expect(current.setAutoCaptions).toHaveBeenCalledWith([original]);
	});

	it("guards source-clock reverts against a different recording or a switch to timeline captions", () => {
		const before = { ...base, autoCaptions: [{ ...base.autoCaptions[0], timeBasis: undefined }] };
		const after = { ...before, autoCaptions: [] };
		const [deletion] = findAgentEdits(before, after, "removed");
		expect(findAgentEdits(before, { ...after, sourcePath: "other.mp4" }, "relinked")).toHaveLength(0);
		expect(canRestoreAgentEdit(deletion, { ...after, sourcePath: "other.mp4" })).toBe(false);
		expect(canRestoreAgentEdit(deletion, { ...after, autoCaptions: [{ ...base.autoCaptions[0], id: "new" }] })).toBe(false);
	});

	it("reviews a caption clock conversion as a single change", () => {
		const other = { ...base.autoCaptions[0], id: "other", startMs: 2000, endMs: 3000 };
		const before = { ...base, autoCaptions: [...base.autoCaptions, other] };
		const after = { ...before, autoCaptions: before.autoCaptions.map(cue => ({ ...cue, timeBasis: undefined })) };
		const changes = findAgentEdits(before, after, "convert-clock");
		expect(changes).toHaveLength(1);
		expect(changes[0]).toMatchObject({ before: before.autoCaptions, after: after.autoCaptions });
		expect(changes[0].target).toBeUndefined();
		expect(canRestoreAgentEdit(changes[0], after)).toBe(true);
	});

	it("does not restore a removed timeline caption into source captions", () => {
		const after = { ...base, autoCaptions: [] };
		const [deletion] = findAgentEdits(base, after, "remove-timeline-caption");
		const current = { ...after, autoCaptions: [{ ...base.autoCaptions[0], id: "source-caption", timeBasis: undefined }] };
		expect(canRestoreAgentEdit(deletion, after)).toBe(true);
		expect(canRestoreAgentEdit(deletion, current)).toBe(false);
	});

	it("reverts one caption while retaining a newer edit to a different caption", () => {
		const first = base.autoCaptions[0];
		const second = { ...first, id: "second", startMs: 2200, endMs: 3000 };
		const before = { ...base, autoCaptions: [first, second] };
		const after = { ...before, autoCaptions: [
			{ ...first, text: "Agent first" }, { ...second, text: "Agent second" },
		] };
		const edits = findAgentEdits(before, after, "round");
		expect(edits.map(change => change.target?.id)).toEqual([first.id, second.id]);
		const local = { ...second, text: "Newer local second" };
		const current = { ...after, autoCaptions: [after.autoCaptions[0], local], setAutoCaptions: vi.fn() };
		expect(canRestoreAgentEdit(edits[0], current)).toBe(true);
		expect(canRestoreAgentEdit(edits[1], current)).toBe(false);
		expect(restoreAgentEdit(edits[0], current as unknown as Parameters<typeof restoreAgentEdit>[1], current.sourcePath)).toBe(true);
		expect(current.setAutoCaptions).toHaveBeenCalledWith([first, local]);
	});

	it("restores a removed caption between surviving originals without replacing other additions", () => {
		const first = base.autoCaptions[0];
		const second = { ...first, id: "second", startMs: 2200, endMs: 2500 };
		const third = { ...first, id: "third", startMs: 2600, endMs: 3000 };
		const addition = { ...first, id: "addition", startMs: 3200, endMs: 3400 };
		const before = { ...base, autoCaptions: [first, second, third] };
		const after = { ...before, autoCaptions: [first, third, addition], setAutoCaptions: vi.fn() };
		const edits = findAgentEdits(before, after, "round");
		expect(edits.map(change => change.target?.id)).toEqual([second.id, addition.id]);
		const state = after as unknown as Parameters<typeof restoreAgentEdit>[1];
		expect(restoreAgentEdit(edits[0], state, after.sourcePath)).toBe(true);
		expect(after.setAutoCaptions).toHaveBeenLastCalledWith([first, second, third, addition]);
		expect(restoreAgentEdit(edits[1], state, after.sourcePath)).toBe(true);
		expect(after.setAutoCaptions).toHaveBeenLastCalledWith([first, third]);
	});

	it("keeps pure order changes atomic", () => {
		const first = base.autoCaptions[0];
		const second = { ...first, id: "second" };
		const before = { ...base, autoCaptions: [first, second] };
		const after = { ...before, autoCaptions: [second, first] };
		const [edit] = findAgentEdits(before, after, "reordered");
		expect(edit).toMatchObject({ field: "autoCaptions", before: before.autoCaptions });
		expect(edit.target).toBeUndefined();
	});

	it("restores a zoom region while preserving other regions in the current timeline", () => {
		const { zoomRegions } = normalizeProjectEditor({ zoomRegions: [
			{ id: "zoom-1", startMs: 300, endMs: 1000, depth: 2, focus: { cx: 0.2, cy: 0.2 } },
			{ id: "zoom-2", startMs: 1500, endMs: 2200, depth: 2, focus: { cx: 0.8, cy: 0.8 } },
		] });
		const before = { ...base, zoomRegions };
		const updated = { ...zoomRegions[0], focus: { cx: 0.3, cy: 0.4 } };
		const after = { ...before, zoomRegions: [updated, zoomRegions[1]] };
		const [edit] = findAgentEdits(before, after, "zoom-round");
		expect(edit.target?.id).toBe("zoom-1");
		const local = { ...zoomRegions[1], focus: { cx: 0.9, cy: 0.9 } };
		const current = { ...after, zoomRegions: [updated, local], setZoomRegions: vi.fn() };
		expect(restoreAgentEdit(edit, current as unknown as Parameters<typeof restoreAgentEdit>[1], current.sourcePath)).toBe(true);
		expect(current.setZoomRegions).toHaveBeenCalledWith([zoomRegions[0], local]);
	});
});
