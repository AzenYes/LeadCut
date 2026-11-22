import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { expect, it } from "vitest";
import { importTranscriptFile, parseImportedTranscript, rebuildCaptionsFromTranscript } from "./transcriptImport";

const example = {
	backend: "qwen3-asr", complete: true, parameters: { language: "English" },
	segments: [{
		start: 0.5, end: 1.5, text: "Hello world.",
		words: [{ word: "Hello", start: 0.5, end: 0.9 }, { word: "world.", start: 0.93, end: 1.5 }],
	}],
};

it("reads a BOM-prefixed local JSON file and rebuilds captions using source word milliseconds", async () => {
	const workspace = await fs.mkdtemp(path.join(os.tmpdir(), "leadcut-transcript-import-"));
	const file = path.join(workspace, "逐词.JSON");
	try {
		await fs.writeFile(file, "\uFEFF" + JSON.stringify(example));
		const transcript = await importTranscriptFile(file);
		expect(transcript).toMatchObject({ engine: "qwen3-asr", timeBasis: "source" });
		expect(rebuildCaptionsFromTranscript(transcript)).toMatchObject([{
			startMs: 500, endMs: 1500, text: "Hello world.",
			words: [{ text: "Hello", startMs: 500, endMs: 900 }, { text: "world.", startMs: 930, endMs: 1500, leadingSpace: true }],
		}]);
		await expect(importTranscriptFile(path.join(workspace, "subtitles.srt"))).rejects.toMatchObject({ code: "extension" });
	} finally {
		await fs.rm(workspace, { recursive: true, force: true });
	}
});

it("keeps uncertain words visible and marks them for the editor", () => {
	const unreliable = structuredClone(example);
	unreliable.segments[0].words[1].end = 0.93;
	const transcript = parseImportedTranscript(JSON.stringify(unreliable));
	expect(transcript.segments[0].words[1]).toHaveProperty("flags", ["timing-unreliable"]);
	const cues = rebuildCaptionsFromTranscript(transcript);
	expect(cues[0].text).toBe("Hello world.");
	expect(cues[0].words).toMatchObject([
		{ text: "Hello", startMs: 500, endMs: 900 },
		{ text: "world.", startMs: 930, endMs: 931, timingUnreliable: true },
	]);
});

it.each([
	["this is not JSON", "invalidFormat"],
	[JSON.stringify({ ...example, complete: false }), "invalidFormat"],
	[JSON.stringify({ ...example, segments: [] }), "empty"],
])("rejects invalid or empty JSON without partial output", (contents, code) => {
	expect(() => parseImportedTranscript(contents)).toThrow(expect.objectContaining({ code }));
});
