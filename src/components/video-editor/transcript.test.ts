import { expect, it } from "vitest";
import { normalizeTranscript } from "./transcript";

const header = {
	version: 1,
	engine: "qwen3-asr",
	timeBasis: "source",
	createdAt: "2026-11-20T00:00:00.000Z",
};

it("normalizes valid segments and preserves suspect word timing for review", () => {
	const segment = {
		id: "first", startMs: 100, endMs: 500, text: " Example  ",
		words: [
			{ text: " Example ", startMs: 250, endMs: 249, confidence: 0.7, flags: ["bad-duration"] },
			{ text: "drop", startMs: Infinity, endMs: 300 },
		],
	};
	expect(normalizeTranscript({
		...header,
		segments: [segment, { ...segment, text: "Duplicate" }, { ...segment, id: "bad", startMs: NaN }, null],
	})).toEqual({
		...header,
		segments: [{
			id: "first", startMs: 100, endMs: 500, text: "Example",
			words: [{ text: "Example", startMs: 250, endMs: 249, confidence: 0.7, flags: ["bad-duration", "timing-unreliable"] }],
		}],
	});
	expect(normalizeTranscript({ ...header, timeBasis: "timeline", segments: [] })).toBeNull();
	expect(normalizeTranscript({ ...header, createdAt: "invalid", segments: [] })).toBeNull();
});
