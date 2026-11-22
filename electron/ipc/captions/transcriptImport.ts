import fs from "node:fs/promises";
import path from "node:path";
import {
	normalizeTranscript,
	parseExternalTranscript,
	type ProjectTranscript,
} from "../../../services/leadcut-mcp/src/transcriptModel";
import type { CaptionCuePayload } from "../types";
import { segmentCuesIntoPhrases } from "./segment";

export class TranscriptImportError extends Error {
	constructor(public readonly code: "extension" | "invalidFormat" | "empty") {
		super(code);
	}
}

export function parseImportedTranscript(contents: string): ProjectTranscript {
	let transcript: ProjectTranscript | null;
	try {
		transcript = parseExternalTranscript(contents);
	} catch {
		throw new TranscriptImportError("invalidFormat");
	}
	if (!transcript) throw new TranscriptImportError("invalidFormat");
	if (!transcript.segments.length) throw new TranscriptImportError("empty");
	return transcript;
}

export async function importTranscriptFile(filePath: string) {
	if (path.extname(filePath).toLowerCase() !== ".json") throw new TranscriptImportError("extension");
	return parseImportedTranscript(await fs.readFile(filePath, "utf8"));
}

export function rebuildCaptionsFromTranscript(value: unknown): CaptionCuePayload[] {
	const transcript = normalizeTranscript(value);
	if (!transcript) throw new TranscriptImportError("invalidFormat");
	const cues = transcript.segments.flatMap(({ id, startMs, endMs, text, words }) => {
		if (endMs <= startMs) return [];
		const cue: CaptionCuePayload = { id, startMs, endMs, text };
		if (words.length > 0) cue.words = words.map(word => {
			const start = Math.min(endMs - 1, Math.max(startMs, word.startMs));
			return {
				text: word.text, startMs: start, endMs: Math.max(start + 1, Math.min(endMs, word.endMs)),
				leadingSpace: Boolean(word.leadingSpace),
				...(word.flags?.includes("timing-unreliable") ? { timingUnreliable: true } : {}),
			};
		});
		return [cue];
	});
	return segmentCuesIntoPhrases(cues, [], { edgePadMs: 0 }).map(cue => ({
		...cue,
		endMs: cue.words?.reduce((end, word) => Math.max(end, word.endMs), cue.endMs) ?? cue.endMs,
	}));
}
