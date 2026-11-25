import type { CaptionEditTarget } from "./captionEditing";
import type {
	AutoCaptionAnimation,
	AutoCaptionSettings,
	CaptionCue,
	CaptionCueWord,
} from "./types";

export type CaptionWordState = "spoken" | "active" | "upcoming";

export interface CaptionWordLayout {
	cueId: string;
	cueWordIndex: number;
	text: string;
	index: number;
	forcedBreakBefore: boolean;
	leadingSpace: boolean;
	startMs: number;
	endMs: number;
	hasRealTiming: boolean;
	state: CaptionWordState;
}

export interface CaptionLineLayout {
	words: CaptionWordLayout[];
	width: number;
	startWordIndex: number;
	endWordIndex: number;
}

interface CaptionPageLayout {
	startLine: number;
	endLine: number;
	startMs: number;
	endMs: number;
}

export interface ActiveCaptionLayout {
	cue: CaptionCue;
	blockKey: string;
	visibleLines: CaptionLineLayout[];
	hasWordTimings: boolean;
	activeWordIndex: number;
	activeWordProgress: number;
	editTarget: CaptionEditTarget;
	visiblePageIndex: number;
	opacity: number;
	translateY: number;
	scale: number;
}

type CaptionSourceWord = {
	cueId: string;
	cueWordIndex: number;
	text: string;
	forcedBreakBefore: boolean;
	leadingSpace?: boolean;
	startMs?: number;
	endMs?: number;
};

const CAPTION_ENTER_MS = 180;
// Keep the exit symmetric with the entrance so captions fade out with the
// same opacity/translateY/scale curve and duration they faded in with.
const CAPTION_EXIT_MS = CAPTION_ENTER_MS;
const CAPTION_BLOCK_GAP_BREAK_MS = 500;

function clamp(value: number, min: number, max: number) {
	return Math.min(max, Math.max(min, value));
}

function clamp01(value: number) {
	return clamp(value, 0, 1);
}

function splitCaptionWordsFromText(text: string) {
	const sourceLines = text
		.split(/\r?\n/)
		.map((line) => line.trim())
		.filter((line) => line.length > 0);
	const words: CaptionSourceWord[] = [];

	sourceLines.forEach((line, lineIndex) => {
		line.split(/\s+/)
			.filter(Boolean)
			.forEach((word, wordIndex) => {
				words.push({
					cueId: "",
					cueWordIndex: words.length,
					text: word,
					forcedBreakBefore: lineIndex > 0 && wordIndex === 0,
				});
			});
	});

	return words;
}

function splitCaptionWords(cue: CaptionCue) {
	if (Array.isArray(cue.words) && cue.words.length > 0) {
		const words = cue.words
			.filter((word): word is CaptionCueWord =>
				Boolean(word && typeof word.text === "string"),
			)
			.map((word, cueWordIndex) => ({
				cueId: cue.id,
				cueWordIndex,
				text: word.text.trim(),
				forcedBreakBefore: false,
				leadingSpace: Boolean(word.leadingSpace),
				startMs: word.startMs,
				endMs: word.endMs,
			}))
			.filter((word) => word.text.length > 0);

		if (words.length > 0) {
			return words;
		}
	}

	return splitCaptionWordsFromText(cue.text).map((word) => ({
		...word,
		cueId: cue.id,
	}));
}

function getActiveCaptionCue(cues: CaptionCue[], timeMs: number, endIndex: number[] | null) {
	if (endIndex) {
		const cue = cues[findFirstIntervalEnd(endIndex, timeMs, true)];
		return cue && cue.startMs <= timeMs && timeMs <= cue.endMs ? cue : null;
	}
	for (const cue of cues) {
		if (timeMs >= cue.startMs && timeMs <= cue.endMs) {
			return cue;
		}
	}

	return null;
}

function getCaptionCoverage(cues: CaptionCue[]) {
	const sorted = [...cues].sort((left, right) => left.startMs - right.startMs);
	const coverage: { startMs: number; endMs: number }[] = [];
	for (let index = 0; index < sorted.length; index += 1) {
		const cue = sorted[index];
		const next = sorted[index + 1];
		const bridgesGap =
			next !== undefined && next.startMs - cue.endMs < CAPTION_BLOCK_GAP_BREAK_MS;
		const endMs = bridgesGap ? Math.max(cue.endMs, next.startMs) : cue.endMs;
		if (endMs < cue.startMs) continue;
		const previous = coverage[coverage.length - 1];
		if (previous && cue.startMs <= previous.endMs)
			previous.endMs = Math.max(previous.endMs, endMs);
		else coverage.push({ startMs: cue.startMs, endMs });
	}
	return coverage;
}

function isWithinCaptionCoverage(coverage: ReturnType<typeof getCaptionCoverage>, timeMs: number) {
	let low = 0;
	let high = coverage.length;
	while (low < high) {
		const middle = (low + high) >>> 1;
		if (coverage[middle].startMs <= timeMs) low = middle + 1;
		else high = middle;
	}
	return low > 0 && timeMs <= coverage[low - 1].endMs;
}

export function flattenCaptionWords(cues: CaptionCue[]) {
	const flattened: Array<{
		cueId: string;
		cueWordIndex: number;
		text: string;
		forcedBreakBefore: boolean;
		leadingSpace: boolean;
		startMs: number;
		endMs: number;
		hasRealTiming: boolean;
	}> = [];

	cues.forEach((cue, cueIndex) => {
		const sourceWords = splitCaptionWords(cue);
		if (sourceWords.length === 0) {
			return;
		}

		const cueHasRealWordTimings = sourceWords.every(
			(word) =>
				isFiniteNumber(word.startMs) &&
				isFiniteNumber(word.endMs) &&
				word.endMs > word.startMs,
		);
		const cueDuration = Math.max(1, cue.endMs - cue.startMs);
		const fallbackWordDuration = cueDuration / sourceWords.length;
		const previousCue = cueIndex > 0 ? cues[cueIndex - 1] : null;
		// Each cue is its own phrase, so always start a new line/page at a cue boundary.
		// Otherwise back-to-back phrases (a small gap) get re-packed together by width and
		// their boundary disappears on screen — we want one phrase shown at a time.
		const shouldForceCueBreak = previousCue !== null;

		sourceWords.forEach((word, wordIndex) => {
			const fallbackStartMs = cue.startMs + fallbackWordDuration * wordIndex;
			const fallbackEndMs =
				wordIndex === sourceWords.length - 1
					? cue.endMs
					: cue.startMs + fallbackWordDuration * (wordIndex + 1);
			const startsMergedCue =
				wordIndex === 0 && !word.forcedBreakBefore && !shouldForceCueBreak;
			const leadingSpace =
				wordIndex === 0
					? flattened.length > 0 && startsMergedCue
					: (word.leadingSpace ?? true);

			flattened.push({
				cueId: cue.id,
				cueWordIndex: word.cueWordIndex,
				text: word.text,
				forcedBreakBefore:
					word.forcedBreakBefore || (wordIndex === 0 && shouldForceCueBreak),
				leadingSpace,
				startMs: cueHasRealWordTimings ? word.startMs! : fallbackStartMs,
				endMs: cueHasRealWordTimings
					? word.endMs!
					: Math.max(fallbackStartMs + 1, fallbackEndMs),
				hasRealTiming: cueHasRealWordTimings,
			});
		});
	});

	return flattened;
}

function getCaptionAnimationState(
	animationStyle: AutoCaptionAnimation,
	enterProgress: number,
	exitProgress: number,
) {
	const visibility = Math.min(enterProgress, exitProgress);

	switch (animationStyle) {
		case "none":
			return {
				opacity: 1,
				translateY: 0,
				scale: 1,
			};
		case "fade":
			return {
				opacity: 0.3 + visibility * 0.7,
				translateY: 0,
				scale: 1,
			};
		case "rise":
			return {
				opacity: 0.25 + visibility * 0.75,
				translateY: (1 - visibility) * 18,
				scale: 0.985 + visibility * 0.015,
			};
		case "pop":
		default:
			return {
				opacity: 0.35 + visibility * 0.65,
				translateY: (1 - visibility) * 8,
				scale: 0.94 + visibility * 0.06,
			};
	}
}

type CaptionTimingWord = ReturnType<typeof flattenCaptionWords>[number];

type CaptionMeasurementIndex = {
	texts: string[];
	plain: Uint32Array;
	spaced: Uint32Array;
};

function prepareCaptionPagination(lineCount: number, maxRows: number) {
	const pageCount = Math.ceil(lineCount / maxRows);
	// Evenly distribute rows, putting the larger pages first.
	return { pageCount, rowsPerPage: Math.floor(lineCount / pageCount), largerPages: lineCount % pageCount };
}

function getCaptionPageAtIndex(
	lineStarts: number[], words: CaptionTimingWord[],
	pagination: ReturnType<typeof prepareCaptionPagination>, pageIndex: number,
): CaptionPageLayout {
	const { rowsPerPage, largerPages } = pagination;
	const startLine = pageIndex * rowsPerPage + Math.min(pageIndex, largerPages);
	const endLine = startLine + rowsPerPage + Number(pageIndex < largerPages);
	const startMs = words[lineStarts[startLine]].startMs;
	const endWord = lineStarts[endLine];
	const endMs = Math.max(startMs + 1, words[endWord]?.startMs ?? words[words.length - 1].endMs);
	return { startLine, endLine, startMs, endMs };
}

function captionLinePenalty(lineWidth: number, maxWidth: number, isLastLine: boolean) {
	const slack = Math.max(0, maxWidth - lineWidth);
	const fullness = maxWidth <= 0 ? 1 : lineWidth / maxWidth;
	return isLastLine
		? slack * slack * 0.18
		: slack * slack + (fullness < 0.72 ? (0.72 - fullness) * 26000 : 0);
}

function buildCaptionLineBreaks(options: {
	segmentStarts: number[];
	measurement: CaptionMeasurementIndex;
	maxWidthPx: number;
	measureText: (text: string) => number;
	measuredWidths?: Float64Array;
}) {
	const { segmentStarts, measurement: { texts, plain, spaced }, maxWidthPx, measureText, measuredWidths } = options;
	const wordCount = plain.length;
	const widths = measuredWidths?.length === texts.length
		? measuredWidths : Float64Array.from(texts, text => measureText(text));
	const bestCost = new Float64Array(wordCount + 1).fill(Number.POSITIVE_INFINITY);
	const nextBreak = new Uint32Array(wordCount).fill(wordCount);

	bestCost[wordCount] = 0;

	for (let segmentIndex = segmentStarts.length - 2; segmentIndex >= 0; segmentIndex--) {
		const start = segmentStarts[segmentIndex];
		const end = segmentStarts[segmentIndex + 1];
		let wholeWidth = widths[plain[start]];
		let fitsOnOneLine = wholeWidth >= 0 && wholeWidth <= maxWidthPx;
		for (let index = start + 1; fitsOnOneLine && index < end; index++) {
			const wordWidth = widths[plain[index]];
			const spacedWidth = widths[spaced[index]];
			wholeWidth += spacedWidth;
			fitsOnOneLine = wordWidth >= 0 && wordWidth <= spacedWidth && wholeWidth <= maxWidthPx;
		}
		const slack = maxWidthPx - wholeWidth;
		// A split can only make each line narrower. The additional line has a positive
		// cost when the whole phrase fits. Leave near ties to the original cost order.
		const roundoff = Number.EPSILON * (bestCost[end] + maxWidthPx * maxWidthPx + 26_000) * (end - start + 2);
		if (fitsOnOneLine && slack * slack * 0.18 > roundoff) {
			bestCost[start] = captionLinePenalty(wholeWidth, maxWidthPx, end === wordCount) + bestCost[end];
			nextBreak[start] = end;
			continue;
		}

		for (let startIndex = end - 1; startIndex >= start; startIndex--) {
			let lineWidth = widths[plain[startIndex]];
			for (let endIndex = startIndex; endIndex < end; endIndex++) {
				if (endIndex > startIndex) {
					lineWidth += widths[spaced[endIndex]];
					if (lineWidth > maxWidthPx) break;
				}
				const candidateCost = captionLinePenalty(lineWidth, maxWidthPx, endIndex === wordCount - 1) +
					bestCost[endIndex + 1];

				if (candidateCost < bestCost[startIndex]) {
					bestCost[startIndex] = candidateCost;
					nextBreak[startIndex] = endIndex + 1;
				}
			}
		}
	}

	const lineStarts = [0];
	const lineWidths: number[] = [];
	let startIndex = 0;
	while (startIndex < wordCount) {
		const endIndex = Math.max(startIndex + 1, nextBreak[startIndex]);
		let width = widths[plain[startIndex]];
		for (let index = startIndex + 1; index < endIndex; index++) width += widths[spaced[index]];
		lineWidths.push(width);
		startIndex = endIndex;
		lineStarts.push(startIndex);
	}

	return { lineStarts, lineWidths };
}

function getIntervalEndIndex(intervals: { startMs: number; endMs: number }[]) {
	const ends: number[] = [];
	for (let index = 0; index < intervals.length; index++) {
		const interval = intervals[index];
		if (index > 0 && interval.startMs < intervals[index - 1].startMs) return null;
		ends.push(Math.max(interval.endMs, ends[index - 1] ?? Number.NEGATIVE_INFINITY));
	}
	return ends;
}

function findFirstIntervalEnd(ends: number[], timeMs: number, includeEnd: boolean) {
	let low = 0;
	let high = ends.length;
	while (low < high) {
		const middle = (low + high) >>> 1;
		if (ends[middle] < timeMs || (!includeEnd && ends[middle] === timeMs)) low = middle + 1;
		else high = middle;
	}
	return low;
}

function getVisibleCaptionText(lines: CaptionLineLayout[]) {
	return lines
		.map((line) =>
			line.words
				.map((word, index) => `${index > 0 && word.leadingSpace ? " " : ""}${word.text}`)
				.join("")
				.trim(),
		)
		.filter(Boolean)
		.join(" ");
}

type CaptionLayoutOptions = {
	cues: CaptionCue[];
	settings: Pick<AutoCaptionSettings, "maxRows">;
	maxWidthPx: number;
	measureText: (text: string) => number;
	measuredWidths?: Float64Array;
};

export function canWindowCaptionLayout(cues: CaptionCue[]) {
	return cues.every((cue, index) => cue.endMs > cue.startMs &&
		(index === 0 || cue.startMs >= cues[index - 1].endMs) &&
		Boolean(cue.text.trim()) &&
		(cue.words?.every((word, wordIndex, words) => word.startMs >= cue.startMs &&
			word.endMs <= cue.endMs && word.endMs > word.startMs &&
			(wordIndex === 0 || word.startMs >= words[wordIndex - 1].endMs)) ?? true));
}

export function findPreviewCaptionCueIndex(cues: CaptionCue[], timeMs: number) {
	let low = 0;
	let high = cues.length;
	while (low < high) {
		const middle = (low + high) >>> 1;
		if (cues[middle].startMs <= timeMs) low = middle + 1;
		else high = middle;
	}
	return Math.max(0, low - 1);
}

export function getPreviewCaptionCues(cues: CaptionCue[], index: number) {
	// A single-row page cannot cross a cue break. Include adjacent cues for shared
	// endpoints and for the short gaps that keep the previous phrase on screen.
	return index < 0 ? cues : cues.slice(Math.max(0, index - 1), index + 2);
}

export function prepareCaptionTiming(cues: CaptionCue[]) {
	const sourceWords = flattenCaptionWords(cues);
	const segmentStarts = [0];
	const texts: string[] = [];
	const textIndices = new Map<string, number>();
	const plain = new Uint32Array(sourceWords.length);
	const spaced = new Uint32Array(sourceWords.length);
	const getTextIndex = (text: string) => {
		const known = textIndices.get(text);
		if (known !== undefined) return known;
		const index = texts.length;
		texts.push(text);
		textIndices.set(text, index);
		return index;
	};
	for (let index = 0; index < sourceWords.length; index++) {
		const word = sourceWords[index];
		if (index > 0 && word.forcedBreakBefore) segmentStarts.push(index);
		plain[index] = getTextIndex(word.text);
		spaced[index] = word.leadingSpace ? getTextIndex(` ${word.text}`) : plain[index];
	}
	segmentStarts.push(sourceWords.length);
	const cuesById = new Map<string, CaptionCue>();
	for (const cue of cues) {
		if (!cuesById.has(cue.id)) cuesById.set(cue.id, cue);
	}
	const cueEndIndex = cues.every(cue => Number.isFinite(cue.startMs) && Number.isFinite(cue.endMs))
		? getIntervalEndIndex(cues)
		: null;
	const wordEndIndex = getIntervalEndIndex(sourceWords);
	return {
		sourceWords,
		segmentStarts,
		measurement: { texts, plain, spaced },
		cueIndex: { cues, cuesById, cueEndIndex },
		wordEndIndex,
		orderedPageTimes: wordEndIndex !== null && sourceWords.every(word =>
			Number.isFinite(word.startMs) && Number.isFinite(word.endMs)),
		coverage: getCaptionCoverage(cues),
	};
}

export function prepareCaptionLayout(
	options: CaptionLayoutOptions,
	timing = prepareCaptionTiming(options.cues),
) {
	const { sourceWords, segmentStarts, measurement, cueIndex, wordEndIndex, orderedPageTimes, coverage } = timing;
	if (sourceWords.length === 0) return null;
	const maxRows = clamp(Math.round(options.settings.maxRows || 1), 1, 4);

	const lineBreaks = buildCaptionLineBreaks({
		segmentStarts,
		measurement,
		maxWidthPx: options.maxWidthPx,
		measureText: options.measureText,
		measuredWidths: options.measuredWidths,
	});
	const pagination = prepareCaptionPagination(lineBreaks.lineStarts.length - 1, maxRows);
	let unorderedPages: { pages: CaptionPageLayout[]; endIndex: number[] | null } | null = null;
	if (!orderedPageTimes) {
		const pages = Array.from({ length: pagination.pageCount }, (_, index) =>
			getCaptionPageAtIndex(lineBreaks.lineStarts, sourceWords, pagination, index));
		unorderedPages = { pages, endIndex: getIntervalEndIndex(pages) };
	}
	return { sourceWords, lineBreaks, pagination, unorderedPages, cueIndex, wordEndIndex, coverage };
}

export function buildActiveCaptionLayout(options: CaptionLayoutOptions & { timeMs: number; settings: AutoCaptionSettings }) {
	return getActiveCaptionLayout(prepareCaptionLayout(options), options);
}

export function getActiveCaptionLayout(
	layout: ReturnType<typeof prepareCaptionLayout>,
	options: Pick<CaptionLayoutOptions, "cues"> & { settings: Pick<AutoCaptionSettings, "animationStyle">; timeMs: number },
) {
	if (!layout || !isWithinCaptionCoverage(layout.coverage, options.timeMs)) return null;
	const { sourceWords, lineBreaks, pagination, unorderedPages, wordEndIndex } = layout;
	const { timeMs } = options;
	let activeWordIndex: number;
	if (wordEndIndex) {
		const next = findFirstIntervalEnd(wordEndIndex, timeMs, false);
		activeWordIndex = next < sourceWords.length && sourceWords[next].startMs <= timeMs
			? next : Math.max(0, next - 1);
	} else {
		activeWordIndex = sourceWords.findIndex(word => timeMs >= word.startMs && timeMs < word.endMs);
		if (activeWordIndex < 0) {
			const next = sourceWords.findIndex(word => timeMs < word.startMs);
			activeWordIndex = next < 0 ? sourceWords.length - 1 : Math.max(0, next - 1);
		}
	}
	const { lineStarts, lineWidths } = lineBreaks;
	const pageAt = (index: number) => getCaptionPageAtIndex(lineStarts, sourceWords, pagination, index);
	let visiblePageIndex: number;
	if (unorderedPages) {
		const { pages, endIndex } = unorderedPages;
		visiblePageIndex = endIndex
			? findFirstIntervalEnd(endIndex, timeMs, true)
			: pages.findIndex(page => timeMs >= page.startMs && timeMs <= page.endMs);
	} else {
		let low = 0;
		let high = pagination.pageCount;
		while (low < high) {
			const middle = (low + high) >>> 1;
			if (pageAt(middle).endMs < timeMs) low = middle + 1;
			else high = middle;
		}
		visiblePageIndex = low;
	}
	if (visiblePageIndex < 0 || visiblePageIndex >= pagination.pageCount) return null;
	const visiblePage = pageAt(visiblePageIndex);
	if (timeMs < visiblePage.startMs) return null;
	// Keep pagination global while materializing only the rows consumed by this frame.
	const visibleLines: CaptionLineLayout[] = [];
	for (let lineIndex = visiblePage.startLine; lineIndex < visiblePage.endLine; lineIndex++) {
		const startWordIndex = lineStarts[lineIndex];
		const endWordIndex = lineStarts[lineIndex + 1] - 1;
		const words: CaptionWordLayout[] = [];
		for (let index = startWordIndex; index <= endWordIndex; index++) {
			const word = sourceWords[index];
			words.push({
				...word,
				index,
				leadingSpace: index > startWordIndex && word.leadingSpace,
				state: index < activeWordIndex ? "spoken" : index === activeWordIndex ? "active" : "upcoming",
			});
		}
		visibleLines.push({ words, width: lineWidths[lineIndex], startWordIndex, endWordIndex });
	}
	const activeWord = sourceWords[activeWordIndex];
	const activeWordProgress = activeWord
		? clamp01(
				(options.timeMs - activeWord.startMs) /
					Math.max(1, activeWord.endMs - activeWord.startMs),
			)
		: 0;
	const animationStartMs = visiblePage.startMs;
	const animationEndMs = visiblePage.endMs;
	const pageStartWordIndex = visibleLines[0]?.startWordIndex ?? 0;
	const visibleWords = visibleLines.flatMap((line) => line.words);
	const visibleHasWordTimings = visibleWords.every((word) => word.hasRealTiming);
	const pageCueId = sourceWords[pageStartWordIndex]?.cueId ?? sourceWords[0].cueId;
	const cueIndex = options.cues === layout.cueIndex.cues ? layout.cueIndex : null;
	const activeCue =
		getActiveCaptionCue(options.cues, options.timeMs, cueIndex?.cueEndIndex ?? null) ??
		(cueIndex ? cueIndex.cuesById.get(pageCueId) : options.cues.find((candidate) => candidate.id === pageCueId)) ??
		options.cues[0];
	// `animationEndMs` is stretched to the next page's start (see buildCaptionPages)
	// so consecutive pages stay on screen with no gap. That's right for continuous
	// speech, but pages are built from every cue flattened together — so when a
	// caption component (cue) is the last before a pause, its stitched end points
	// across the silence into the next cue. exitProgress would then stay pinned at
	// 1 and the caption would vanish with no fade. Anchor the exit to the real end
	// of the visible words instead, and only when nothing follows within the
	// gap-break window (otherwise keep the stitched end so continuous page swaps
	// don't flicker).
	const visibleContentEndMs = visibleWords.reduce(
		(latest, word) => Math.max(latest, word.endMs),
		animationStartMs,
	);
	const willDisappear =
		options.settings.animationStyle !== "none" &&
		!isWithinCaptionCoverage(layout.coverage, visibleContentEndMs + 1);
	const exitAnchorMs = willDisappear ? visibleContentEndMs : animationEndMs;
	const enterProgress = clamp01((options.timeMs - animationStartMs) / CAPTION_ENTER_MS);
	const exitProgress = clamp01((exitAnchorMs - options.timeMs) / CAPTION_EXIT_MS);
	const animation = getCaptionAnimationState(
		options.settings.animationStyle,
		enterProgress,
		exitProgress,
	);
	// On a real disappearance the per-style opacity only eases to its readability
	// floor (~0.3) before the element unmounts, which reads as a snap. Fade fully
	// to 0 across the exit window so the caption leaves smoothly.
	const opacity = willDisappear ? animation.opacity * exitProgress : animation.opacity;

	return {
		cue: activeCue,
		blockKey: `${Math.round(animationStartMs)}-${Math.round(animationEndMs)}`,
		visibleLines,
		hasWordTimings: visibleHasWordTimings,
		activeWordIndex,
		activeWordProgress,
		editTarget: {
			id: `${Math.round(animationStartMs)}-${Math.round(animationEndMs)}:${visibleWords
				.map((word) => `${word.cueId}:${word.cueWordIndex}`)
				.join("|")}`,
			startMs: animationStartMs,
			endMs: animationEndMs,
			text: getVisibleCaptionText(visibleLines),
			words: visibleWords.map((word) => ({
				cueId: word.cueId,
				cueWordIndex: word.cueWordIndex,
				startMs: word.startMs,
				endMs: word.endMs,
				text: word.text,
				leadingSpace: word.leadingSpace,
			})),
		},
		visiblePageIndex,
		opacity,
		translateY: animation.translateY,
		scale: animation.scale,
	} satisfies ActiveCaptionLayout;
}

function isFiniteNumber(value: unknown): value is number {
	return typeof value === "number" && Number.isFinite(value);
}
