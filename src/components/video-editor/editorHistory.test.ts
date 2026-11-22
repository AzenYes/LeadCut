import { describe, expect, it } from "vitest";

import {
	areEditorHistorySnapshotsEqual,
	cloneEditorHistorySnapshot,
	createEditorHistoryStack,
	type EditorHistorySnapshot,
	recordEditorHistorySnapshot,
	redoEditorHistoryStack,
	resetEditorHistoryStack,
	undoEditorHistoryStack,
} from "./editorHistory";

function createSnapshot(id: string | null): EditorHistorySnapshot {
	return {
		zoomRegions: [],
		clipRegions: [],
		speedRegions: [],
		annotationRegions: [],
		audioRegions: [],
		autoCaptions: id ? [{ id, startMs: 0, endMs: 1000, text: id }] : [],
		selectedZoomId: id,
		selectedClipId: id ? `clip-${id}` : null,
		selectedAnnotationId: null,
		selectedAudioId: null,
	};
}

describe("editorHistory", () => {
	it("does not consume undo steps for selection-only changes", () => {
		const stack = createEditorHistoryStack();
		const first = createSnapshot("first");
		recordEditorHistorySnapshot(stack, first);
		expect(recordEditorHistorySnapshot(stack, { ...first, selectedClipId: "other" })).toBe("unchanged");
		expect(stack.past).toHaveLength(0);
		expect(stack.current?.selectedClipId).toBe("other");
	});
	it("coalesces a slider gesture while preserving its starting value and final redo value", () => {
		const stack = createEditorHistoryStack();
		const state = (volume: number) => ({ ...createSnapshot("clip"), sourceAudioTrackSettingsByClip: { clip: { mixed: { volume, normalize: true } } } });
		recordEditorHistorySnapshot(stack, state(1));
		recordEditorHistorySnapshot(stack, state(0.8));
		recordEditorHistorySnapshot(stack, state(0.4), { coalesce: true });
		recordEditorHistorySnapshot(stack, state(0.2), { coalesce: true });
		expect(stack.past).toHaveLength(1);
		expect(undoEditorHistoryStack(stack, state(0.2))).toEqual(state(1));
		expect(redoEditorHistoryStack(stack, state(1))).toEqual(state(0.2));
	});
	it("initializes without adding undo history", () => {
		const stack = createEditorHistoryStack();
		const snapshot = createSnapshot("first");

		expect(recordEditorHistorySnapshot(stack, snapshot)).toBe("initialized");

		expect(stack.current).toEqual(snapshot);
		expect(stack.past).toEqual([]);
		expect(stack.future).toEqual([]);
	});

	it("does not record unchanged snapshots", () => {
		const stack = createEditorHistoryStack();
		const snapshot = createSnapshot("same");

		recordEditorHistorySnapshot(stack, snapshot);
		expect(recordEditorHistorySnapshot(stack, createSnapshot("same"))).toBe("unchanged");

		expect(stack.past).toEqual([]);
		expect(stack.future).toEqual([]);
	});

	it("records changes and clears redo history", () => {
		const stack = createEditorHistoryStack();

		recordEditorHistorySnapshot(stack, createSnapshot("first"));
		recordEditorHistorySnapshot(stack, createSnapshot("second"));
		stack.future.push(createSnapshot("future"));

		expect(recordEditorHistorySnapshot(stack, createSnapshot("third"))).toBe("recorded");

		expect(stack.past.map((snapshot) => snapshot.selectedZoomId)).toEqual(["first", "second"]);
		expect(stack.current?.selectedZoomId).toBe("third");
		expect(stack.future).toEqual([]);
	});

	it("moves snapshots through undo and redo stacks", () => {
		const stack = createEditorHistoryStack();
		const first = createSnapshot("first");
		const second = createSnapshot("second");

		recordEditorHistorySnapshot(stack, first);
		recordEditorHistorySnapshot(stack, second);

		expect(undoEditorHistoryStack(stack, second)?.selectedZoomId).toBe("first");
		expect(stack.current?.selectedZoomId).toBe("first");
		expect(stack.future.map((snapshot) => snapshot.selectedZoomId)).toEqual(["second"]);

		expect(redoEditorHistoryStack(stack, first)?.selectedZoomId).toBe("second");
		expect(stack.current?.selectedZoomId).toBe("second");
		expect(stack.past.map((snapshot) => snapshot.selectedZoomId)).toEqual(["first"]);
	});

	it("updates the current snapshot while applying history without recording a new entry", () => {
		const stack = createEditorHistoryStack();

		recordEditorHistorySnapshot(stack, createSnapshot("first"));
		expect(
			recordEditorHistorySnapshot(stack, createSnapshot("applied"), {
				applyingHistory: true,
			}),
		).toBe("applied");

		expect(stack.current?.selectedZoomId).toBe("applied");
		expect(stack.past).toEqual([]);
	});

	it("caps the past stack at the configured history depth", () => {
		const stack = createEditorHistoryStack();

		recordEditorHistorySnapshot(stack, createSnapshot("0"));
		recordEditorHistorySnapshot(stack, createSnapshot("1"), { maxEntries: 2 });
		recordEditorHistorySnapshot(stack, createSnapshot("2"), { maxEntries: 2 });
		recordEditorHistorySnapshot(stack, createSnapshot("3"), { maxEntries: 2 });

		expect(stack.past.map((snapshot) => snapshot.selectedZoomId)).toEqual(["1", "2"]);
	});

	it("resets all history stacks", () => {
		const stack = createEditorHistoryStack();

		recordEditorHistorySnapshot(stack, createSnapshot("first"));
		recordEditorHistorySnapshot(stack, createSnapshot("second"));
		undoEditorHistoryStack(stack, createSnapshot("second"));
		resetEditorHistoryStack(stack);

		expect(stack).toEqual(createEditorHistoryStack());
	});

	it("clones snapshots before storing them", () => {
		const snapshot = createSnapshot("first");
		const cloned = cloneEditorHistorySnapshot(snapshot);

		cloned.selectedZoomId = "changed";

		expect(snapshot.selectedZoomId).toBe("first");
		expect(areEditorHistorySnapshotsEqual(snapshot, createSnapshot("first"))).toBe(true);
	});
});
