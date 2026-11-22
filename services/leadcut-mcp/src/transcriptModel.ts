export interface TranscriptWord {
	text: string;
	startMs: number;
	endMs: number;
	leadingSpace?: boolean;
	confidence?: number;
	flags?: string[];
}

export interface TranscriptSegment {
	id: string;
	startMs: number;
	endMs: number;
	text: string;
	words: TranscriptWord[];
}

export interface ProjectTranscript {
	version: 1;
	engine: string;
	model?: string;
	language?: string;
	audioPath?: string;
	timeBasis: "source";
	createdAt: string;
	segments: TranscriptSegment[];
}

type Metadata = Pick<ProjectTranscript, "engine"> &
	Partial<Pick<ProjectTranscript, "createdAt" | "model" | "language" | "audioPath">>;

function record(value: unknown): Record<string, unknown> | null {
	return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function text(value: unknown) {
	return typeof value === "string" ? value.trim() : "";
}

function milliseconds(value: unknown, scale = 1) {
	if (typeof value !== "number") return null;
	const result = Math.round(value * scale);
	return Number.isSafeInteger(result) ? result : null;
}

function flags(value: unknown): string[] {
	return Array.isArray(value) ? value.map(text).filter(Boolean) : [];
}

function normalizedWord(value: unknown, segment: Pick<TranscriptSegment, "startMs" | "endMs">): TranscriptWord | null {
	const word = record(value);
	if (!word) return null;
	const token = text(word.text);
	const startMs = milliseconds(word.startMs);
	const endMs = milliseconds(word.endMs);
	if (!token || startMs === null || endMs === null) return null;
	const notes = flags(word.flags);
	if (startMs < segment.startMs || endMs > segment.endMs || endMs <= startMs) notes.push("timing-unreliable");
	const confidence = typeof word.confidence === "number" && word.confidence >= 0 && word.confidence <= 1
		? word.confidence : undefined;
	return {
		text: token, startMs, endMs,
		...(word.leadingSpace === true ? { leadingSpace: true } : {}),
		...(confidence !== undefined ? { confidence } : {}),
		...(notes.length > 0 ? { flags: [...new Set(notes)] } : {}),
	};
}

export function normalizeTranscript(value: unknown): ProjectTranscript | null {
	const source = record(value);
	if (!source || source.version !== 1 || source.timeBasis !== "source" || !Array.isArray(source.segments)) return null;
	const engine = text(source.engine);
	const createdAt = text(source.createdAt);
	if (!engine || !createdAt || !Number.isFinite(Date.parse(createdAt))) return null;
	const segments: TranscriptSegment[] = [];
	const ids = new Set<string>();
	for (const item of source.segments) {
		const segment = record(item);
		if (!segment) continue;
		const id = text(segment.id);
		const startMs = milliseconds(segment.startMs);
		const endMs = milliseconds(segment.endMs);
		const caption = text(segment.text);
		if (!id || ids.has(id) || !caption || startMs === null || startMs < 0 || endMs === null || endMs < startMs) continue;
		const bounds = { startMs, endMs };
		const words = Array.isArray(segment.words) ? segment.words.flatMap(word => normalizedWord(word, bounds) ?? []) : [];
		segments.push({ id, ...bounds, text: caption, words });
		ids.add(id);
	}
	const model = text(source.model);
	const language = text(source.language);
	const audioPath = text(source.audioPath);
	return {
		version: 1, timeBasis: "source", engine, createdAt,
		...(model ? { model } : {}), ...(language ? { language } : {}), ...(audioPath ? { audioPath } : {}),
		segments: segments.sort((left, right) => left.startMs - right.startMs || left.endMs - right.endMs),
	};
}

function externalTranscript(value: unknown, engine: "qwen3-asr" | "faster-whisper", createdAt: string) {
	const input = record(value);
	if (!input || !Array.isArray(input.segments) || input.complete === false) return null;
	const parameters = record(input.parameters);
	const convertWords = (words: unknown, captionText: string) => {
		if (!Array.isArray(words)) return [];
		let cursor = 0;
		return words.flatMap(item => {
			const word = record(item);
			if (!word || typeof word.word !== "string" || !word.word.trim()) return [];
			const token = word.word.trim();
			const offset = captionText.indexOf(token, cursor);
			if (offset >= cursor) cursor = offset + token.length;
			const warnings = flags(word.timingWarnings);
			return [{
				text: token, startMs: milliseconds(word.start, 1000), endMs: milliseconds(word.end, 1000),
				leadingSpace: word.leadingSpace === true || /^\s/u.test(word.word) ||
					(offset > 0 && /\s/u.test(captionText[offset - 1])),
				confidence: word.probability ?? word.confidence,
				flags: warnings.length > 0 ? ["timing-unreliable", ...warnings] : [],
			}];
		});
	};
	const segments = input.segments.flatMap((item, index) => {
		const segment = record(item);
		if (!segment) return [];
		const start = milliseconds(segment.start, 1000);
		const end = milliseconds(segment.end, 1000);
		if (start === null || end === null || end < start) return [];
		return [{
			id: `segment-${index + 1}`, text: segment.text, startMs: Math.max(0, start), endMs: Math.max(0, end),
			words: convertWords(segment.words, text(segment.text)),
		}];
	});
	const transcript = normalizeTranscript({
		version: 1, timeBasis: "source", engine, createdAt: text(input.createdAt) || createdAt,
		model: input.model ?? input.modelPath, language: input.language ?? parameters?.language, audioPath: input.audioPath,
		segments,
	});
	if (input.segments.length > 0 && !transcript?.segments.length) return null;
	return transcript;
}

export function fromFasterWhisperJson(value: unknown, createdAt = new Date().toISOString()) {
	return externalTranscript(value, "faster-whisper", createdAt);
}

export function fromQwenJson(value: unknown, createdAt = new Date().toISOString()) {
	return externalTranscript(value, "qwen3-asr", createdAt);
}

export function fromCaptionCues(
	cues: readonly (Omit<TranscriptSegment, "words"> & { words?: TranscriptWord[]; timeBasis?: "timeline" })[],
	metadata: Metadata,
) {
	return normalizeTranscript({
		...metadata,
		version: 1, timeBasis: "source",
		createdAt: metadata.createdAt ?? new Date().toISOString(),
		segments: cues.filter(cue => cue.timeBasis !== "timeline"),
	});
}

export function parseExternalTranscript(contents: string) {
	const data = record(JSON.parse(contents.replace(/^\uFEFF/, "")));
	if (data?.backend === "qwen3-asr") return fromQwenJson(data);
	if (data && data.backend === undefined) return fromFasterWhisperJson(data);
	return null;
}
