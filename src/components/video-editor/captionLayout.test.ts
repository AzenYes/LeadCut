import { describe, expect, it } from "vitest";
import { canWindowCaptionLayout, findPreviewCaptionCueIndex, flattenCaptionWords, getActiveCaptionLayout, getPreviewCaptionCues, prepareCaptionLayout, prepareCaptionTiming } from "./captionLayout";
import type { CaptionCue } from "./types";

describe("flattenCaptionWords", () => {
	it("forces a break at every cue boundary so each phrase shows on its own", () => {
		const cues: CaptionCue[] = [
			{
				id: "a",
				startMs: 0,
				endMs: 1_000,
				text: "hello world",
				words: [
					{ text: "hello", startMs: 0, endMs: 500 },
					{ text: "world", startMs: 500, endMs: 1_000, leadingSpace: true },
				],
			},
			{
				// back-to-back with cue "a" (no gap) — would previously be re-packed by width
				id: "b",
				startMs: 1_000,
				endMs: 2_000,
				text: "next one",
				words: [
					{ text: "next", startMs: 1_000, endMs: 1_500 },
					{ text: "one", startMs: 1_500, endMs: 2_000, leadingSpace: true },
				],
			},
		];

		const flattened = flattenCaptionWords(cues);
		const firstWordOfSecondCue = flattened.find(
			(word) => word.cueId === "b" && word.cueWordIndex === 0,
		);

		expect(firstWordOfSecondCue?.forcedBreakBefore).toBe(true);
		expect(firstWordOfSecondCue?.leadingSpace).toBe(false);
		// the very first word of the first cue never forces a break
		expect(flattened[0].forcedBreakBefore).toBe(false);
	});
});

describe("single-row preview window", () => {
	it("matches the full layout across wraps, shared endpoints and short and long gaps", () => {
		const cues: CaptionCue[] = Array.from({ length: 15 }, (_, index) => {
			const startMs = index * 1800;
			const endMs = startMs + [1800, 1500, 900][index % 3];
			const words = ["One", "small", "example", "with", "enough", "words", "to", "wrap"];
			return {
				id: String(index), startMs, endMs, text: words.join(" "),
				words: words.map((text, word) => ({ text, startMs: startMs + word * 60, endMs: startMs + (word + 1) * 60 })),
			};
		});
		expect(canWindowCaptionLayout(cues)).toBe(true);
		const layout = (input: CaptionCue[]) => prepareCaptionLayout({ cues: input, settings: { maxRows: 1 }, maxWidthPx: 21, measureText: text => text.length });
		const full = layout(cues);
		const visible = (prepared: typeof full, input: CaptionCue[], timeMs: number) => {
			const active = getActiveCaptionLayout(prepared, { cues: input, settings: { animationStyle: "pop" }, timeMs });
			return active && {
				cue: active.cue.id,
				editTarget: active.editTarget,
				words: active.visibleLines.map(line => line.words.map(word => [word.text, word.state])),
				progress: active.activeWordProgress,
				opacity: active.opacity,
				translateY: active.translateY,
				scale: active.scale,
			};
		};
		for (let timeMs = 0; timeMs <= 27_000; timeMs += 30) {
			const previewCues = getPreviewCaptionCues(cues, findPreviewCaptionCueIndex(cues, timeMs));
			expect(previewCues.length).toBeLessThanOrEqual(3);
			expect(visible(layout(previewCues), previewCues, timeMs)).toEqual(visible(full, cues, timeMs));
		}
	});

	it("keeps the full layout for overlapping cues or words outside cue timing", () => {
		const first = { id: "a", startMs: 0, endMs: 100, text: "First" };
		expect(canWindowCaptionLayout([first, { ...first, id: "b", startMs: 95, endMs: 110 }])).toBe(false);
		expect(canWindowCaptionLayout([{ ...first, words: [{ text: "First", startMs: 3, endMs: 103 }] }])).toBe(false);
	});
});

it("reuses caption timing for new wraps across fonts and multiple rows", () => {
	const cues: CaptionCue[] = [
		{ id: "first", startMs: 0, endMs: 650, text: "One two\nthree four" },
		{
			id: "second", startMs: 650, endMs: 1250, text: "你好 world",
			words: [
				{ text: "你好", startMs: 650, endMs: 850 },
				{ text: "world", startMs: 900, endMs: 1250, leadingSpace: true },
			],
		},
		{ id: "third", startMs: 1800, endMs: 2200, text: "Another phrase after two gaps" },
	];
	const timing = prepareCaptionTiming(cues);
	const originalWords = structuredClone(timing.sourceWords);
	for (const maxRows of [1, 2, 4]) {
		for (const maxWidthPx of [10, 28, 56]) {
			const options = { cues, settings: { maxRows }, maxWidthPx, measureText: (text: string) => text.length * 1.3 };
			const measurements: string[] = [];
			const layout = prepareCaptionLayout({ ...options, measureText: text => {
				measurements.push(text);
				return options.measureText(text);
			} }, timing);
			expect(layout).toEqual(prepareCaptionLayout(options));
			expect(measurements.length).toBe(new Set(measurements).size);
			const measuredWidths = Float64Array.from(timing.measurement.texts, options.measureText);
			expect(prepareCaptionLayout({ ...options, measuredWidths, measureText: () => {
				throw new Error("Premeasured words should skip synchronous measurement");
			} }, timing)).toEqual(layout);
			expect(prepareCaptionLayout({ ...options, measuredWidths: measuredWidths.subarray(1) }, timing)).toEqual(layout);
		}
	}
	expect(timing.sourceWords).toEqual(originalWords);
});

it("keeps multi-row page boundaries and word editing across adjacent cues", () => {
	const cues: CaptionCue[] = [
		{ id: "first", startMs: 0, endMs: 200, text: "A" },
		{ id: "second", startMs: 200, endMs: 600, text: "B C\nD E" },
		{ id: "third", startMs: 600, endMs: 800, text: "F" },
	];
	const layout = prepareCaptionLayout({ cues, settings: { maxRows: 2 }, maxWidthPx: 6, measureText: text => text.length });
	const visible = (timeMs: number) => getActiveCaptionLayout(layout, { cues, timeMs, settings: { animationStyle: "none" } });
	expect(visible(400)?.editTarget).toMatchObject({ startMs: 0, endMs: 400, text: "A B C" });
	const active = visible(430);
	expect(active?.editTarget).toMatchObject({ startMs: 400, endMs: 800, text: "D E F" });
	expect(active?.visibleLines.map(line => line.width)).toEqual([3, 1]);
	expect(active?.visibleLines.flatMap(line => line.words.map(word => [word.cueId, word.cueWordIndex, word.state]))).toEqual([
		["second", 2, "active"], ["second", 3, "upcoming"], ["third", 0, "upcoming"],
	]);
	expect(active?.activeWordProgress).toBeCloseTo(0.3);
});

it("keeps mandatory breaks while wrapping an overflowing phrase between fitting phrases", () => {
	const cues: CaptionCue[] = [
		{ id: "first", startMs: 0, endMs: 200, text: "A B" },
		{ id: "second", startMs: 200, endMs: 600, text: "word test\nend" },
		{ id: "third", startMs: 600, endMs: 800, text: "C D" },
	];
	const layout = prepareCaptionLayout({
		cues,
		settings: { maxRows: 2 },
		maxWidthPx: 7,
		measureText: (text) => text.length,
	});

	expect(layout?.lineBreaks).toEqual({
		lineStarts: [0, 2, 3, 4, 5, 7],
		lineWidths: [3, 4, 4, 3, 3],
	});
	const visiblePages = [0, 350, 650].map(timeMs => getActiveCaptionLayout(layout, {
		cues, timeMs, settings: { animationStyle: "none" },
	}));
	expect(visiblePages.map(page => page?.visiblePageIndex)).toEqual([0, 1, 2]);
	expect(visiblePages.map(page => page?.visibleLines.map(line => line.startWordIndex))).toEqual([
		[0, 2], [3, 4], [5],
	]);
});

it("finds the active cue near the end of a long transcript without scanning earlier cues", () => {
	let cueReads = 0;
	const cues: CaptionCue[] = new Proxy(Array.from({ length: 2_000 }, (_, index) => ({
		id: String(index), startMs: index * 300, endMs: index * 300 + 250, text: "A phrase",
	})), {
		get(target, property, receiver) {
			if (typeof property === "string" && /^\d+$/.test(property)) cueReads++;
			return Reflect.get(target, property, receiver);
		},
	});
	const layout = prepareCaptionLayout({
		cues, settings: { maxRows: 2 }, maxWidthPx: 100, measureText: (text) => text.length,
	});
	cueReads = 0;

	const active = getActiveCaptionLayout(layout, {
		cues, timeMs: 1_975 * 300 + 10, settings: { animationStyle: "none" },
	});

	expect(active?.cue.id).toBe("1975");
	expect(cueReads).toBeLessThanOrEqual(2);
});
