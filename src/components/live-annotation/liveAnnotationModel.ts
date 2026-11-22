export type AnnotationTool = "pen" | "line" | "arrow" | "rectangle" | "ellipse" | "highlighter" | "text" | "eraser";
type DrawTool = Exclude<AnnotationTool, "eraser">;
export type AnnotationPoint = { x: number; y: number };
export type LiveAnnotationOptions = { tool: AnnotationTool; color: string; weight: number; fadeSeconds: number };
export type LiveAnnotationShape = {
	id: string;
	tool: DrawTool;
	color: string;
	weight: number;
	points: AnnotationPoint[];
	text?: string;
	fadeAt?: number;
};
export type LiveAnnotationCommand = "undo" | "redo" | "clear";
export type LiveAnnotationStatus = { supported: boolean; active: boolean };
export type LiveAnnotationState = {
	options: LiveAnnotationOptions;
	shapes: LiveAnnotationShape[];
	draft: LiveAnnotationShape | null;
	undo: LiveAnnotationShape[][];
	redo: LiveAnnotationShape[][];
};
export type LiveAnnotationAction =
	| { type: "options"; options: LiveAnnotationOptions }
	| { type: "start"; id: string; point: AnnotationPoint }
	| { type: "point"; point: AnnotationPoint }
	| { type: "finish"; at: number; text?: string }
	| { type: "expire"; at: number }
	| { type: "erase"; id: string }
	| { type: "cancel" | LiveAnnotationCommand };

export const LIVE_ANNOTATION_TOOLS: readonly AnnotationTool[] = ["pen", "line", "arrow", "rectangle", "ellipse", "highlighter", "text", "eraser"];
export const DEFAULT_LIVE_ANNOTATION_OPTIONS: LiveAnnotationOptions = { tool: "pen", color: "#ff4d57", weight: 5, fadeSeconds: 0 };
export const LIVE_ANNOTATION_FADE_MS = 400;
const HISTORY_LIMIT = 80;

export function normalizeLiveAnnotationOptions(input: unknown): LiveAnnotationOptions | null {
	if (!input || typeof input !== "object") return null;
	const options = input as Partial<LiveAnnotationOptions>;
	if (!options.tool || !LIVE_ANNOTATION_TOOLS.includes(options.tool) ||
		!options.color || !/^#[0-9a-f]{6}$/i.test(options.color) ||
		typeof options.weight !== "number" || !Number.isFinite(options.weight) ||
		typeof options.fadeSeconds !== "number" || !Number.isFinite(options.fadeSeconds)) return null;
	return { tool: options.tool, color: options.color, weight: Math.max(1, Math.min(24, options.weight)),
		fadeSeconds: Math.max(0, Math.min(120, options.fadeSeconds)) };
}

export function createLiveAnnotationState(): LiveAnnotationState {
	return { options: DEFAULT_LIVE_ANNOTATION_OPTIONS, shapes: [], draft: null, undo: [], redo: [] };
}

function commit(state: LiveAnnotationState, shapes: LiveAnnotationShape[]): LiveAnnotationState {
	return { ...state, shapes, draft: null, undo: [...state.undo, state.shapes].slice(-HISTORY_LIMIT), redo: [] };
}

export function liveAnnotationReducer(state: LiveAnnotationState, action: LiveAnnotationAction): LiveAnnotationState {
	switch (action.type) {
		case "options": return { ...state, options: action.options };
		case "start": {
			const { tool, color, weight } = state.options;
			return tool === "eraser" ? state : { ...state, draft: { id: action.id, tool, color, weight, points: [action.point] } };
		}
		case "point": {
			if (!state.draft || state.draft.tool === "text") return state;
			const { tool, points } = state.draft;
			const last = points[points.length - 1];
			if (Math.hypot(last.x - action.point.x, last.y - action.point.y) < 1.5) return state;
			const next = tool === "pen" || tool === "highlighter" ? [...points, action.point] : [points[0], action.point];
			return { ...state, draft: { ...state.draft, points: next } };
		}
		case "finish": {
			if (!state.draft) return state;
			const text = action.text?.trim().slice(0, 200);
			if (state.draft.tool === "text" && !text) return { ...state, draft: null };
			const fadeAt = state.options.fadeSeconds > 0 ? action.at + state.options.fadeSeconds * 1000 : undefined;
			return commit(state, [...state.shapes, { ...state.draft, text, fadeAt }]);
		}
		case "cancel": return state.draft ? { ...state, draft: null } : state;
		case "erase": {
			const shapes = state.shapes.filter(shape => shape.id !== action.id);
			return shapes.length === state.shapes.length ? state : commit(state, shapes);
		}
		case "undo": {
			const previous = state.undo[state.undo.length - 1];
			return previous ? { ...state, draft: null, shapes: previous, undo: state.undo.slice(0, -1),
				redo: [...state.redo, state.shapes] } : state;
		}
		case "redo": {
			const next = state.redo[state.redo.length - 1];
			return next ? { ...state, draft: null, shapes: next, undo: [...state.undo, state.shapes],
				redo: state.redo.slice(0, -1) } : state;
		}
		case "clear": return state.shapes.length ? commit(state, []) : state;
		case "expire": {
			const shapes = state.shapes.filter(shape => shape.fadeAt === undefined || action.at < shape.fadeAt + LIVE_ANNOTATION_FADE_MS);
			return shapes.length === state.shapes.length ? state : { ...state, shapes };
		}
	}
}

export function findAnnotationAt(shapes: readonly LiveAnnotationShape[], point: AnnotationPoint) {
	for (let index = shapes.length - 1; index >= 0; index--) {
		const shape = shapes[index];
		const first = shape.points[0];
		if (!first) continue;
		let left = first.x, right = first.x, top = first.y, bottom = first.y;
		for (const p of shape.points) {
			left = Math.min(left, p.x); right = Math.max(right, p.x);
			top = Math.min(top, p.y); bottom = Math.max(bottom, p.y);
		}
		if (shape.text) {
			const size = Math.max(14, shape.weight * 5);
			right += shape.text.length * size * 0.68;
			bottom += size;
		}
		const margin = Math.max(7, shape.weight);
		if (point.x >= left - margin && point.x <= right + margin && point.y >= top - margin && point.y <= bottom + margin) return shape;
	}
	return undefined;
}
