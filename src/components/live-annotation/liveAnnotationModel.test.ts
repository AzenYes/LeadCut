import { expect, it } from "vitest";
import { createLiveAnnotationState, DEFAULT_LIVE_ANNOTATION_OPTIONS, findAnnotationAt, liveAnnotationReducer } from "./liveAnnotationModel";

it("completes a drawing, supports undo and redo, and can restore a cleared canvas", () => {
	let state = createLiveAnnotationState();
	state = liveAnnotationReducer(state, { type: "start", id: "line", point: { x: 4, y: 3 } });
	state = liveAnnotationReducer(state, { type: "point", point: { x: 20, y: 30 } });
	state = liveAnnotationReducer(state, { type: "finish", at: 100 });
	const drawing = state.shapes;
	expect(drawing).toMatchObject([{ id: "line", tool: "pen", points: [{ x: 4, y: 3 }, { x: 20, y: 30 }] }]);
	state = liveAnnotationReducer(state, { type: "undo" });
	expect(state.shapes).toEqual([]);
	state = liveAnnotationReducer(state, { type: "redo" });
	expect(state.shapes).toEqual(drawing);
	state = liveAnnotationReducer(state, { type: "clear" });
	expect(state.shapes).toEqual([]);
	state = liveAnnotationReducer(state, { type: "undo" });
	expect(state.shapes).toEqual(drawing);
	state = liveAnnotationReducer(state, { type: "erase", id: findAnnotationAt(state.shapes, { x: 19, y: 12 })!.id });
	expect(state.shapes).toEqual([]);
});

it("expires a shape after its delay and fade interval", () => {
	let state = createLiveAnnotationState();
	state = liveAnnotationReducer(state, { type: "options", options: { ...DEFAULT_LIVE_ANNOTATION_OPTIONS, tool: "rectangle", fadeSeconds: 1 } });
	state = liveAnnotationReducer(state, { type: "start", id: "rect", point: { x: 4, y: 3 } });
	state = liveAnnotationReducer(state, { type: "point", point: { x: 20, y: 30 } });
	state = liveAnnotationReducer(state, { type: "finish", at: 100 });
	expect(state.shapes[0]).toMatchObject({ tool: "rectangle", fadeAt: 1100 });
	expect(liveAnnotationReducer(state, { type: "expire", at: 1499 }).shapes).toHaveLength(1);
	expect(liveAnnotationReducer(state, { type: "expire", at: 1500 }).shapes).toHaveLength(0);
});
