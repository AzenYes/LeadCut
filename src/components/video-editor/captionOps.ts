import {
	captionWordsToText,
	normalizeCaptionWordSpacing,
	normalizeCaptionWords,
} from "./captionEditing";
import type { CaptionCue, CaptionCueWord } from "./types";

export interface CaptionRetimeSpan {
	startMs: number;
	endMs: number;
}

function sortCaptionCues(cues: CaptionCue[]): CaptionCue[] {
	return [...cues].sort(
		(left, right) => left.startMs - right.startMs || left.endMs - right.endMs,
	);
}

function createCaptionCueId(): string {
	return `caption-${globalThis.crypto.randomUUID()}`;
}

/**
 * Build a new caption cue with a generated id. Word timings are intentionally
 * omitted — the renderer derives placeholder per-word timings from the text
 * until the user adds real ones.
 */
export function createCaptionCue(params: {
	startMs: number;
	endMs: number;
	text?: string;
}): CaptionCue {
	const startMs = Math.round(params.startMs);
	return {
		id: createCaptionCueId(),
		startMs,
		// Preserve the minimum-duration invariant (endMs > startMs) for every caller.
		endMs: Math.max(startMs + 1, Math.round(params.endMs)),
		text: params.text ?? "",
	};
}

/** Insert a cue and keep the list ordered, matching the other cue operations. */
export function addCue(cues: CaptionCue[], cue: CaptionCue): CaptionCue[] {
	return sortCaptionCues([...cues, cue]);
}

function rescaleWordsIntoSpan(
	words: CaptionCueWord[],
	oldStartMs: number,
	oldEndMs: number,
	newStartMs: number,
	newEndMs: number,
): CaptionCueWord[] {
	const oldSpan = oldEndMs - oldStartMs;
	const newSpan = newEndMs - newStartMs;
	const factor = oldSpan > 0 ? newSpan / oldSpan : 0;

	let cursorMs = newStartMs;
	const rescaled: CaptionCueWord[] = [];

	words.forEach((word, index) => {
		const mappedStartMs =
			oldSpan > 0
				? newStartMs + (word.startMs - oldStartMs) * factor
				: newStartMs + (newSpan * index) / Math.max(1, words.length);
		const mappedEndMs =
			oldSpan > 0
				? newStartMs + (word.endMs - oldStartMs) * factor
				: newStartMs + (newSpan * (index + 1)) / Math.max(1, words.length);

		const latestEnd = newEndMs - (words.length - index - 1);
		const startMs = Math.min(latestEnd - 1, Math.max(cursorMs, Math.round(mappedStartMs)));
		const endMs = Math.min(latestEnd, Math.max(startMs + 1, Math.round(mappedEndMs)));
		cursorMs = endMs;

		rescaled.push({
			text: word.text,
			startMs,
			endMs,
			...(word.leadingSpace ? { leadingSpace: true } : {}),
			...(word.timingUnreliable ? { timingUnreliable: true } : {}),
		});
	});

	return normalizeCaptionWordSpacing(rescaled);
}

export function retimeCue(cues: CaptionCue[], id: string, span: CaptionRetimeSpan): CaptionCue[] {
	const sorted = sortCaptionCues(cues);
	const index = sorted.findIndex((cue) => cue.id === id);
	if (index < 0) {
		return cues;
	}

	const cue = sorted[index];
	const newStartMs = Math.max(0, Math.round(span.startMs));
	const requestedEndMs = Math.max(newStartMs + 1, Math.round(span.endMs));

	const words =
		Array.isArray(cue.words) && cue.words.length > 0 ? normalizeCaptionWords(cue) : [];
	// Each word needs a monotonic, non-overlapping range of at least 1ms, so the span must
	// be at least as long as the word count. A shorter span would force later words to pile
	// up and overlap/reorder, so widen the end to the minimum viable span in that case.
	const newEndMs =
		words.length > 0 ? Math.max(requestedEndMs, newStartMs + words.length) : requestedEndMs;

	if (newStartMs === cue.startMs && newEndMs === cue.endMs) {
		return cues;
	}

	const nextWords =
		words.length > 0
			? rescaleWordsIntoSpan(words, cue.startMs, cue.endMs, newStartMs, newEndMs)
			: null;

	const nextCueValue: CaptionCue = {
		...cue,
		id: cue.id,
		startMs: newStartMs,
		endMs: newEndMs,
		text: cue.text,
		...(nextWords ? { words: nextWords } : {}),
	};

	const nextCues = sorted.map((value, valueIndex) =>
		valueIndex === index ? nextCueValue : value,
	);
	return sortCaptionCues(nextCues);
}

export function splitCue(cues: CaptionCue[], id: string, atMs: number): CaptionCue[] {
	const sorted = sortCaptionCues(cues);
	const index = sorted.findIndex((cue) => cue.id === id);
	if (index < 0) {
		return cues;
	}

	const cue = sorted[index];
	const words = normalizeCaptionWords(cue);
	if (words.length < 2) {
		return cues;
	}

	let splitIndex = 1;
	let nearestDistance = Number.POSITIVE_INFINITY;
	for (let candidate = 1; candidate < words.length; candidate += 1) {
		const boundaryMs = (words[candidate - 1].endMs + words[candidate].startMs) / 2;
		const distance = Math.abs(boundaryMs - atMs);
		if (distance < nearestDistance) {
			nearestDistance = distance;
			splitIndex = candidate;
		}
	}

	const leftWords = normalizeCaptionWordSpacing(words.slice(0, splitIndex));
	const rightWords = normalizeCaptionWordSpacing(words.slice(splitIndex));

	const leftCue: CaptionCue = {
		...cue,
		id: cue.id,
		startMs: cue.startMs,
		endMs: leftWords[leftWords.length - 1].endMs,
		text: captionWordsToText(leftWords),
		words: leftWords,
	};
	const rightCue: CaptionCue = {
		...cue,
		id: createCaptionCueId(),
		startMs: rightWords[0].startMs,
		endMs: cue.endMs,
		text: captionWordsToText(rightWords),
		words: rightWords,
	};

	const nextCues = sorted.flatMap((value, valueIndex) =>
		valueIndex === index ? [leftCue, rightCue] : [value],
	);
	return sortCaptionCues(nextCues);
}

export function splitCueAtTextOffset(cues: CaptionCue[], id: string, offset: number): CaptionCue[] {
	const cue = cues.find(item => item.id === id);
	if (!cue || !Number.isInteger(offset) || offset <= 0 || offset >= cue.text.length || cue.endMs - cue.startMs < 2) return cues;
	const actualWords = cue.words?.length ? normalizeCaptionWords(cue) : [];
	const leftWords: CaptionCueWord[] = [];
	const rightWords: CaptionCueWord[] = [];
	let cursor = 0;
	let closest = Infinity;
	let boundaryMs = cue.startMs + (cue.endMs - cue.startMs) * offset / cue.text.length;
	for (const [index, word] of actualWords.entries()) {
		const start = cue.text.indexOf(word.text, cursor);
		if (start < 0) break;
		cursor = start + word.text.length;
		if (index < actualWords.length - 1 && Math.abs(cursor - offset) < closest) {
			closest = Math.abs(cursor - offset);
			boundaryMs = (word.endMs + actualWords[index + 1].startMs) / 2;
		}
		if (start < offset) leftWords.push({ ...word, text: cue.text.slice(start, Math.min(cursor, offset)) });
		if (cursor > offset) rightWords.push({ ...word, text: cue.text.slice(Math.max(start, offset), cursor) });
	}
	const splitMs = Math.max(cue.startMs + 1, Math.min(cue.endMs - 1, Math.round(boundaryMs)));
	const wordsInSpan = (words: CaptionCueWord[], text: string, startMs: number, endMs: number) => {
		if (words.length === 0 || words.length > endMs - startMs ||
			words.map(word => word.text).join("") !== text.replace(/\s/g, "")) return undefined;
		return rescaleWordsIntoSpan(words, startMs, endMs, startMs, endMs);
	};
	const leftText = cue.text.slice(0, offset);
	const rightText = cue.text.slice(offset);
	const left = { ...cue, endMs: splitMs, text: leftText,
		words: wordsInSpan(leftWords, leftText, cue.startMs, splitMs) };
	const right = { ...cue, id: createCaptionCueId(), startMs: splitMs, text: rightText,
		words: wordsInSpan(rightWords, rightText, splitMs, cue.endMs) };
	return sortCaptionCues(cues.flatMap(item => item.id === id ? [left, right] : [item]));
}

export function joinCaptionText(left: string, right: string) {
	return left + (/[a-z\d]$/i.test(left) && /^[a-z\d]/i.test(right) ? " " : "") + right;
}

export function captionTextOffsetAtTime(cue: CaptionCue, timeMs: number) {
	if (timeMs <= cue.startMs || timeMs >= cue.endMs || cue.text.length < 2) return 0;
	const words = cue.words?.length ? normalizeCaptionWords(cue) : [];
	let cursor = 0;
	let nearestOffset = 0;
	let closest = Infinity;
	for (let index = 0; index < words.length - 1; index++) {
		const word = words[index];
		const start = cue.text.indexOf(word.text, cursor);
		if (start < 0) break;
		cursor = start + word.text.length;
		const distance = Math.abs((word.endMs + words[index + 1].startMs) / 2 - timeMs);
		if (distance >= closest) continue;
		closest = distance;
		nearestOffset = cursor;
	}
	return nearestOffset || Math.max(1, Math.min(cue.text.length - 1,
		Math.round(cue.text.length * (timeMs - cue.startMs) / (cue.endMs - cue.startMs))));
}

/** The overview verifies adjacency among projected rows before calling this. */
export function mergeProjectedCaptionCues(cues: CaptionCue[], ids: readonly string[]): CaptionCue[] {
	const wanted = new Set(ids);
	const selected = sortCaptionCues(cues.filter(cue => wanted.has(cue.id)));
	if (selected.length < 2 || selected.length !== wanted.size) return cues;
	const first = selected[0];
	if (selected.some(cue => cue.timeBasis !== first.timeBasis)) return cues;
	const text = selected.map(cue => cue.text).reduce(joinCaptionText);
	const words = selected.some(cue => cue.words?.length) ? normalizeCaptionWordSpacing(selected.flatMap((cue, index) => {
		const words = normalizeCaptionWords(cue);
		const firstWord = words[0];
		if (!firstWord) return words;
		const previous = selected[index - 1];
		if (previous && (/\s$/.test(previous.text) || /^\s/.test(cue.text) ||
			joinCaptionText(previous.text, cue.text).length > previous.text.length + cue.text.length)) {
			words[0] = { ...firstWord, leadingSpace: true };
		}
		return words;
	})) : undefined;
	const joined = {
		...first,
		id: ids[0],
		endMs: Math.max(...selected.map(cue => cue.endMs)),
		text,
		words,
	};
	return sortCaptionCues([...cues.filter(cue => !wanted.has(cue.id)), joined]);
}

export function mergeCues(cues: CaptionCue[], idA: string, idB: string): CaptionCue[] {
	const sorted = sortCaptionCues(cues);
	const indexA = sorted.findIndex((cue) => cue.id === idA);
	const indexB = sorted.findIndex((cue) => cue.id === idB);
	if (indexA < 0 || indexB < 0 || Math.abs(indexA - indexB) !== 1) {
		return cues;
	}

	const leftIndex = Math.min(indexA, indexB);
	const left = sorted[leftIndex];
	const right = sorted[leftIndex + 1];
	if (left.timeBasis !== right.timeBasis) return cues;
	const mergedWords = normalizeCaptionWordSpacing([
		...normalizeCaptionWords(left),
		...normalizeCaptionWords(right),
	]);

	const mergedCue: CaptionCue = {
		...left,
		id: left.id,
		startMs: left.startMs,
		endMs: right.endMs,
		text: captionWordsToText(mergedWords),
		words: mergedWords,
	};

	const nextCues = sorted.flatMap((value, valueIndex) => {
		if (valueIndex === leftIndex) {
			return [mergedCue];
		}
		if (valueIndex === leftIndex + 1) {
			return [];
		}
		return [value];
	});
	return sortCaptionCues(nextCues);
}

export function deleteCue(cues: CaptionCue[], id: string): CaptionCue[] {
	const next = cues.filter((cue) => cue.id !== id);
	return next.length === cues.length ? cues : sortCaptionCues(next);
}
