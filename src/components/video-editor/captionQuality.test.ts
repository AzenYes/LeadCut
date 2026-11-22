import { expect, it } from "vitest";
import { checkCaptions, DEFAULT_CAPTION_QUALITY_RULES, normalizeCaptionQualityRules } from "./captionQuality";

const check = (rows: Parameters<typeof checkCaptions>[0], rules = DEFAULT_CAPTION_QUALITY_RULES) =>
	checkCaptions(rows, rules, text => text.length * 10, 50);

it("identifies all six quality issues and isolates overlap to neighbouring captions", () => {
	const rows = [
		{ id: "short", startMs: 0, endMs: 299, text: "abcdef" },
		{ id: "long", startMs: 250, endMs: 7251, text: "word。" },
		{ id: "blank", startMs: 8000, endMs: 8500, text: "   " },
	];
	expect(check(rows)).toEqual(new Map([
		["short", ["tooWide", "tooShort", "overlap"]],
		["long", ["tooLong", "overlap", "trailingPunctuation"]],
		["blank", ["empty"]],
	]));
	expect(check(rows, normalizeCaptionQualityRules({ enabled: { tooWide: false, overlap: false } })))
		.toEqual(new Map([
			["short", ["tooShort"]], ["long", ["tooLong", "trailingPunctuation"]], ["blank", ["empty"]],
		]));
});

it("does not flag exact width, duration or shared time boundaries", () => {
	expect(check([
		{ id: "minimal", startMs: 0, endMs: 300, text: "small" },
		{ id: "maximal", startMs: 300, endMs: 7300, text: "last" },
	])).toEqual(new Map());
});
