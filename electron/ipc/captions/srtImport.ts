import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { parseSrtCues, parseSrtTimestamp } from "./parser";

export const MAX_SRT_BYTES = 10 * 1024 * 1024;
export class SrtImportError extends Error {
	constructor(public readonly code: string) {
		super(code);
	}
}

/** Preserve authored cue text and timing; never run ASR or resegment an import. */
export function parseImportedSrt(content: string) {
	const normalized = content
		.replace(/^\uFEFF/, "")
		.replace(/\r\n?/g, "\n")
		.trim();
	if (!normalized) throw new SrtImportError("empty");
	if (normalized.includes("\0")) throw new SrtImportError("invalidFormat");
	const blocks = normalized.split(/\n[ \t]*\n+/);
	for (const block of blocks) {
		const lines = block.split("\n");
		const timingIndex = /^\d+\s*$/.test(lines[0]) ? 1 : 0;
		const timing = lines[timingIndex]
			?.trim()
			.match(/^(\d{2,}:\d{2}:\d{2}[,.]\d{3})\s*-->\s*(\d{2,}:\d{2}:\d{2}[,.]\d{3})$/);
		if (!timing) throw new SrtImportError("invalidFormat");
		const start = parseSrtTimestamp(timing[1]);
		const end = parseSrtTimestamp(timing[2]);
		if (start === null || end === null || end <= start)
			throw new SrtImportError("invalidTiming");
		if (
			!lines
				.slice(timingIndex + 1)
				.join("\n")
				.trim()
		)
			throw new SrtImportError("emptyText");
	}
	const cues = parseSrtCues(blocks.join("\n\n")).sort(
		(a, b) => a.startMs - b.startMs || a.endMs - b.endMs,
	);
	if (cues.length !== blocks.length) throw new SrtImportError("invalidFormat");
	for (let index = 1; index < cues.length; index++) {
		if (cues[index].startMs < cues[index - 1].endMs) throw new SrtImportError("overlap");
	}
	const importId = randomUUID();
	return cues.map((cue, index) => ({
		...cue,
		id: `srt-${importId}-${index + 1}`,
		timeBasis: "timeline" as const,
	}));
}

export function decodeSrtBytes(bytes: Uint8Array): string {
	try {
		if (bytes[0] === 0xff && bytes[1] === 0xfe)
			return new TextDecoder("utf-16le", { fatal: true }).decode(bytes);
		if (bytes[0] === 0xfe && bytes[1] === 0xff)
			return new TextDecoder("utf-16be", { fatal: true }).decode(bytes);
		try {
			return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
		} catch {
			return new TextDecoder("gb18030", { fatal: true }).decode(bytes);
		}
	} catch {
		throw new SrtImportError("encoding");
	}
}

export async function importSrtFile(filePath: string) {
	if (path.extname(filePath).toLowerCase() !== ".srt") throw new SrtImportError("extension");
	const stat = await fs.stat(filePath);
	if (!stat.isFile()) throw new SrtImportError("readFailed");
	if (stat.size > MAX_SRT_BYTES) throw new SrtImportError("tooLarge");
	const bytes = await fs.readFile(filePath);
	if (bytes.length > MAX_SRT_BYTES) throw new SrtImportError("tooLarge");
	return parseImportedSrt(decodeSrtBytes(bytes));
}
