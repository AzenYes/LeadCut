import { expect, it } from "vitest";
import type { CaptionCue } from "../types";
import { replaceInCaptions } from "./captionSearch";

const cues: CaptionCue[] = [
	{
		id: "a", startMs: 0, endMs: 900, text: "Hello hello",
		words: [
			{ text: "Hello", startMs: 0, endMs: 500 },
			{ text: "hello", startMs: 500, endMs: 900, leadingSpace: true },
		],
	},
	{ id: "b", startMs: 1000, endMs: 1900, text: "Hi [hello]" },
];

it("replaces literal matches and updates word timings with the current text", () => {
	const result = replaceInCaptions(cues, "hello", "bye");
	expect(result.count).toBe(3);
	expect(result.cues[0]).toMatchObject({ text: "bye bye", words: [
		{ text: "bye", startMs: 0, endMs: 450 },
		{ text: "bye", startMs: 450, endMs: 900 },
	] });
	expect(result.cues[1].text).toBe("Hi [bye]");
	expect(replaceInCaptions(cues, "[hello]", "$$", { firstOnly: true }).cues[1].text).toBe("Hi $$");
	expect(replaceInCaptions(cues, "Hello", "bye", { caseSensitive: true }).count).toBe(1);
});

it("keeps the original array when nothing changed, including outside the visible cue scope", () => {
	expect(replaceInCaptions(cues, "missing", "word").cues).toBe(cues);
	expect(replaceInCaptions(cues, "hello", "bye", { cueIds: new Set() }).cues).toBe(cues);
});
