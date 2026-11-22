export type ChangeConfidence = "high" | "medium" | "low";
export type ChangeReview = "pending" | "accepted" | "restored";
export const MAX_CUT_REDO_NOTE_LENGTH = 2000;

export interface CutRedoRequest {
	note: string;
	markedAt: string;
}

export interface ChangeLogEntry {
	id: string;
	kind: "cut";
	source: "agent" | "manual";
	createdAt: string;
	batchId: string;
	rangeIndex: number;
	sourceStartMs: number;
	sourceEndMs: number;
	speed: number;
	durationMs: number;
	timelineMs: number;
	afterClipId?: string;
	reason?: string;
	confidence?: ChangeConfidence;
	review?: ChangeReview;
	redo?: CutRedoRequest;
}

export function needsCutRedo(entry: ChangeLogEntry) {
	return Boolean(entry.redo && entry.review !== "accepted" && entry.review !== "restored");
}

export interface ChangeLog {
	version: 1;
	entries: ChangeLogEntry[];
}

export function emptyChangeLog(): ChangeLog {
	return { version: 1, entries: [] };
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isTimestamp(value: unknown): value is string {
	return typeof value === "string" && /^\d{4}-\d{2}-\d{2}T/.test(value) && Number.isFinite(Date.parse(value));
}

function isId(value: unknown): value is string {
	return typeof value === "string" && value.trim().length > 0;
}

function isPositive(value: unknown): value is number {
	return typeof value === "number" && Number.isFinite(value) && value > 0;
}

function isNonNegative(value: unknown): value is number {
	return value === 0 || isPositive(value);
}

function normalizeEntry(value: unknown): ChangeLogEntry | null {
	if (!isRecord(value)) return null;
	const {
		id, kind, source, createdAt, batchId, rangeIndex, sourceStartMs, sourceEndMs, speed,
		durationMs, timelineMs, afterClipId, reason, confidence, review, redo,
	} = value;
	if (!isId(id) || kind !== "cut" || (source !== "agent" && source !== "manual") ||
		!isTimestamp(createdAt) || !isId(batchId) || !isNonNegative(rangeIndex) || !Number.isInteger(rangeIndex) ||
		!isNonNegative(sourceStartMs) || !isPositive(sourceEndMs) || Math.round(sourceEndMs) <= Math.round(sourceStartMs) ||
		!isPositive(speed) || !isNonNegative(durationMs) || !isNonNegative(timelineMs)) return null;
	const reasonText = typeof reason === "string" ? reason.trim().slice(0, 500) : "";
	return {
		id, kind, source, createdAt, batchId, rangeIndex, speed,
		sourceStartMs: Math.round(sourceStartMs),
		sourceEndMs: Math.round(sourceEndMs),
		durationMs: Math.round(durationMs),
		timelineMs: Math.round(timelineMs),
		...(isId(afterClipId) ? { afterClipId } : {}),
		...(reasonText ? { reason: reasonText } : {}),
		...(confidence === "high" || confidence === "medium" || confidence === "low" ? { confidence } : {}),
		review: review === "accepted" || review === "restored" ? review : "pending",
		...(isRecord(redo) && isTimestamp(redo.markedAt) && typeof redo.note === "string"
			? { redo: { note: redo.note.trim().slice(0, MAX_CUT_REDO_NOTE_LENGTH), markedAt: redo.markedAt } }
			: {}),
	};
}

export function normalizeChangeLog(value: unknown): ChangeLog {
	if (!isRecord(value) || value.version !== 1 || !Array.isArray(value.entries)) return emptyChangeLog();
	const entries: ChangeLogEntry[] = [];
	const ids = new Set<string>();
	for (const item of value.entries) {
		const entry = normalizeEntry(item);
		if (!entry || ids.has(entry.id)) continue;
		entries.push(entry);
		ids.add(entry.id);
	}
	return { version: 1, entries };
}

type Span = { startMs: number; endMs: number };
type ChangeLogClip = Span & { sourceStartMs?: number; speed?: number };

export function resolveEntryTimelineMs(
	entry: Pick<ChangeLogEntry, "sourceEndMs">,
	clipRegions: readonly ChangeLogClip[],
): number {
	let nextStart = Infinity;
	let duration = 0;
	for (const clip of clipRegions) {
		duration = Math.max(duration, clip.endMs);
		const sourceStart = clip.sourceStartMs ?? clip.startMs;
		if (sourceStart >= entry.sourceEndMs) nextStart = Math.min(nextStart, clip.startMs);
	}
	return Math.round(Number.isFinite(nextStart) ? nextStart : duration);
}

export function intersectCutWithClip(range: Span, clip: ChangeLogClip, timeBasis: "timeline" | "source") {
	const speed = clip.speed ?? 1;
	const clipSourceStart = clip.sourceStartMs ?? clip.startMs;
	const clipSourceEnd = clipSourceStart + (clip.endMs - clip.startMs) * speed;
	const sourceBasis = timeBasis === "source";
	const start = Math.max(range.startMs, sourceBasis ? clipSourceStart : clip.startMs);
	const end = Math.min(range.endMs, sourceBasis ? clipSourceEnd : clip.endMs);
	if (end <= start) return null;
	const sourceStartMs = Math.round(sourceBasis ? start : clipSourceStart + (start - clip.startMs) * speed);
	const sourceEndMs = Math.round(sourceBasis ? end : clipSourceStart + (end - clip.startMs) * speed);
	if (sourceEndMs <= sourceStartMs) return null;
	return {
		sourceStartMs, sourceEndMs, speed,
		durationMs: Math.round((sourceEndMs - sourceStartMs) / speed),
		timelineStartMs: sourceBasis ? clip.startMs + (start - clipSourceStart) / speed : start,
		timelineEndMs: sourceBasis ? clip.startMs + (end - clipSourceStart) / speed : end,
	};
}
