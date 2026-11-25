import type { useTimelineState } from "../state/useTimelineState";

type Timeline = ReturnType<typeof useTimelineState>;
const reviewFields = ["zoomRegions", "autoCaptions", "autoCaptionSettings", "chapterProgress", "transcript"] as const;
export type AgentEditField = (typeof reviewFields)[number];
type CollectionField = "zoomRegions" | "autoCaptions";
type ItemTarget = { id: string; beforeOrder: readonly string[] };
type ReviewValues = Pick<Timeline, AgentEditField | "clipRegions" | "speedRegions" | "trimRegions"> & { sourcePath: string | null };
type CaptionClock = "source" | "timeline";
type EditClock = { sequence?: string; sourcePath?: string; captionClock?: CaptionClock };
type ReviewStatus = "pending" | "accepted" | "restored";

export type AgentEdit = {
	[Field in AgentEditField]: {
		id: string;
		field: Field;
		before: ReviewValues[Field];
		after: ReviewValues[Field];
		target?: Field extends CollectionField ? ItemTarget : never;
		status: ReviewStatus;
		note?: string;
	} & EditClock
}[AgentEditField];

export function agentReviewSequence(values: ReviewValues) {
	// The editor derives trim gaps from explicit clips after loading an Agent cut.
	const legacyTrims = values.clipRegions.length === 0 ? values.trimRegions : [];
	return JSON.stringify([values.clipRegions, legacyTrims, values.speedRegions]);
}

function sameValue(left: unknown, right: unknown) {
	return left === right || JSON.stringify(left) === JSON.stringify(right);
}

function getCaptionClock(captions: ReviewValues["autoCaptions"]) {
	if (captions.length === 0) return undefined;
	const clock = captions[0].timeBasis ?? "source";
	return captions.every(caption => (caption.timeBasis ?? "source") === clock) ? clock : "mixed";
}

function sharedCaptionClock(before: ReviewValues["autoCaptions"], after: ReviewValues["autoCaptions"]): CaptionClock | undefined {
	const beforeClock = getCaptionClock(before);
	const afterClock = getCaptionClock(after);
	const clock = beforeClock ?? afterClock ?? "source";
	return clock !== "mixed" && (afterClock === undefined || afterClock === clock) ? clock : undefined;
}

function findCollectionEdits<Field extends CollectionField>(
	field: Field,
	before: ReviewValues[Field],
	after: ReviewValues[Field],
	roundId: string,
	clock: EditClock,
): AgentEdit[] | null {
	const beforeById = new Map(before.map(item => [item.id, item] as const));
	const afterById = new Map(after.map(item => [item.id, item] as const));
	const beforeOrder = [...beforeById.keys()];
	const afterOrder = [...afterById.keys()];
	// Shared items that changed order and duplicate IDs require restoring the collection as a unit.
	if (beforeById.size !== before.length || afterById.size !== after.length ||
		!sameValue(beforeOrder.filter(id => afterById.has(id)), afterOrder.filter(id => beforeById.has(id)))) {
		return null;
	}
	const edits: AgentEdit[] = [];
	for (const id of new Set([...beforeOrder, ...afterOrder])) {
		const previous = beforeById.get(id);
		const current = afterById.get(id);
		if (sameValue(previous, current)) continue;
		edits.push({ id: `${roundId}:${field}:${id}`, field, before: previous ? [previous] : [],
			after: current ? [current] : [], target: { id, beforeOrder }, ...clock, status: "pending" } as AgentEdit);
	}
	return edits;
}

export function findAgentEdits(before: ReviewValues, after: ReviewValues, roundId: string) {
	const sequence = agentReviewSequence(after);
	const sameSequence = sequence === agentReviewSequence(before);
	const edits: AgentEdit[] = [];
	function record(field: AgentEditField) {
		const captionClock = field === "autoCaptions" ? sharedCaptionClock(before.autoCaptions, after.autoCaptions) : undefined;
		const needsSequence = field === "zoomRegions" || field === "chapterProgress" ||
			(field === "autoCaptions" && captionClock !== "source");
		if ((needsSequence && !sameSequence) || sameValue(before[field], after[field])) return;
		const clock: EditClock = needsSequence ? { sequence } : {};
		if (captionClock !== undefined) clock.captionClock = captionClock;
		if (captionClock === "source") {
			if (after.sourcePath === null || before.sourcePath !== after.sourcePath) return;
			clock.sourcePath = after.sourcePath;
		}
		// Restoring one item across a clock conversion would leave incompatible cues in the same track.
		if (field === "zoomRegions" || (field === "autoCaptions" && captionClock !== undefined)) {
			const changes = findCollectionEdits(field, before[field], after[field], roundId, clock);
			if (changes) {
				for (const change of changes) edits.push(change);
				return;
			}
		}
		edits.push({ id: `${roundId}:${field}`, field, before: before[field], after: after[field],
			...clock, status: "pending" } as AgentEdit);
	}
	for (const field of reviewFields) record(field);
	return edits;
}

export function findAgentEditsThroughRevisions(before: ReviewValues, revisions: readonly ReviewValues[], roundId: string) {
	let previous = before;
	let edits: AgentEdit[] = [];
	for (const [index, revision] of revisions.entries()) {
		edits = mergeAgentReviewEdits(edits, findAgentEdits(previous, revision, `${roundId}:${index}`));
		previous = revision;
	}
	return edits;
}

export function mergeAgentReviewEdits(previous: AgentEdit[], incoming: AgentEdit[]) {
	if (previous.length === 0) return incoming;
	if (incoming.length === 0) return previous;
	const edits: (AgentEdit | null)[] = [...previous];
	const targetKey = (edit: AgentEdit) => JSON.stringify([edit.field, edit.target?.id]);
	const latestByTarget = new Map(previous.map((edit, index) => [targetKey(edit), index]));
	for (const edit of incoming) {
		const key = targetKey(edit);
		const index = latestByTarget.get(key);
		const earlier = index === undefined ? null : edits[index];
		// Keep deletion and reinsertion separate because the item can return at a different position.
		if (index === undefined || earlier?.status !== "pending" || earlier.sequence !== edit.sequence ||
			earlier.sourcePath !== edit.sourcePath || earlier.captionClock !== edit.captionClock ||
			(earlier.target && earlier.after.length === 0) || !sameValue(earlier.after, edit.before)) {
			latestByTarget.set(key, edits.length);
			edits.push(edit);
			continue;
		}
		if (sameValue(earlier.before, edit.after)) {
			edits[index] = null;
			latestByTarget.delete(key);
		} else {
			edits[index] = { ...earlier, after: edit.after } as AgentEdit;
		}
	}
	return edits.filter((edit): edit is AgentEdit => edit !== null);
}

function indexItems<Item extends { id: string }>(items: Item[]) {
	const index = new Map<string, Item[]>();
	for (const item of items) {
		const matches = index.get(item.id);
		if (matches) matches.push(item);
		else index.set(item.id, [item]);
	}
	return index;
}

export function createAgentEditRestoreCheck(current: ReviewValues) {
	const sequence = agentReviewSequence(current);
	const captions = indexItems(current.autoCaptions);
	const zooms = indexItems(current.zoomRegions);
	const captionClock = getCaptionClock(current.autoCaptions);
	return (edit: AgentEdit) => {
		if (edit.status === "restored" || (edit.sequence !== undefined && edit.sequence !== sequence)) return false;
		if (edit.sourcePath !== undefined && edit.sourcePath !== current.sourcePath) return false;
		if (edit.captionClock !== undefined && captionClock !== undefined && edit.captionClock !== captionClock) return false;
		if (edit.target) {
			const items = edit.field === "zoomRegions" ? zooms : captions;
			return sameValue(edit.after, items.get(edit.target.id) ?? []);
		}
		return sameValue(edit.after, current[edit.field]);
	};
}

export function canRestoreAgentEdit(edit: AgentEdit, current: ReviewValues) {
	return createAgentEditRestoreCheck(current)(edit);
}

function restoreCollection<Item extends { id: string }>(current: Item[], before: Item[], target?: ItemTarget) {
	if (!target) return before;
	const position = current.findIndex(item => item.id === target.id);
	if (position >= 0) return [...current.slice(0, position), ...before, ...current.slice(position + 1)];

	const originalPosition = target.beforeOrder.indexOf(target.id);
	const following = new Set(target.beforeOrder.slice(originalPosition + 1));
	let insertAt = current.findIndex(item => following.has(item.id));
	if (insertAt < 0) {
		const preceding = new Set(target.beforeOrder.slice(0, originalPosition));
		insertAt = Math.min(originalPosition, current.length);
		for (let index = current.length - 1; index >= 0; index--) {
			if (preceding.has(current[index].id)) {
				insertAt = index + 1;
				break;
			}
		}
	}
	return [...current.slice(0, insertAt), ...before, ...current.slice(insertAt)];
}

export function restoreAgentEdit(edit: AgentEdit, timeline: Timeline, sourcePath: string | null) {
	if (!canRestoreAgentEdit(edit, { ...timeline, sourcePath })) return false;
	switch (edit.field) {
		case "zoomRegions": timeline.setZoomRegions(restoreCollection(timeline.zoomRegions, edit.before, edit.target)); break;
		case "autoCaptions": timeline.setAutoCaptions(restoreCollection(timeline.autoCaptions, edit.before, edit.target)); break;
		case "autoCaptionSettings": timeline.setAutoCaptionSettings(edit.before); break;
		case "chapterProgress": timeline.setChapterProgress(edit.before); break;
		case "transcript": timeline.setTranscript(edit.before); break;
	}
	return true;
}
