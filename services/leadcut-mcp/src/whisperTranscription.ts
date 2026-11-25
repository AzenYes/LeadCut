import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { getFfmpegPath } from "./binaries.js";
import { normalizeTranscript } from "./transcriptModel.js";

const run = promisify(execFile);

export async function transcribeWithWhisper(options: {
	audioPath: string;
	modelPath?: string;
	outputPath: string;
	language: string;
	delayMs: number;
	signal: AbortSignal;
}) {
	const executable = process.env.WHISPER_CPP_PATH;
	const model = options.modelPath ?? process.env.LEADCUT_WHISPER_MODEL_PATH;
	if (!executable || !model) throw new Error("Install LeadCut and download a Whisper model before transcribing.");
	await fs.access(model);
	const working = await fs.mkdtemp(path.join(os.tmpdir(), "leadcut-whisper-"));
	try {
		const wav = path.join(working, "audio.wav");
		const output = path.join(working, "transcript");
		const spawnOptions = { windowsHide: true, signal: options.signal, maxBuffer: 8 * 1024 * 1024, timeout: 60 * 60_000 };
		await run(getFfmpegPath(), [
			"-hide_banner", "-loglevel", "error", "-nostdin", "-i", path.resolve(options.audioPath),
			"-vn", "-ac", "1", "-ar", "16000", "-c:a", "pcm_s16le", wav,
		], spawnOptions);
		await run(executable, [
			"-m", path.resolve(model), "-f", wav, "-l", options.language,
			"-t", String(Math.max(1, Math.floor(os.availableParallelism() / 2))),
			"-ojf", "-of", output,
		], spawnOptions);
		const raw = JSON.parse(await fs.readFile(`${output}.json`, "utf8")) as {
			transcription?: Array<{ text?: string; offsets?: { from: number; to: number }; tokens?: Array<{ text?: string; offsets?: { from: number; to: number } }> }>;
		};
		if (!Array.isArray(raw.transcription)) throw new Error("Whisper produced an invalid transcript.");
		const aligned = (ms: number) => Math.max(0, Math.round(ms + options.delayMs));
		const transcript = normalizeTranscript({
			version: 1, engine: "whisper.cpp", timeBasis: "source", createdAt: new Date().toISOString(),
			language: options.language, audioPath: path.resolve(options.audioPath), model: path.basename(model),
			segments: raw.transcription.flatMap((segment, index) => {
				if (!segment.offsets || !segment.text?.trim()) return [];
				const { from, to } = segment.offsets;
				return [{
					id: `whisper-${index + 1}`, startMs: aligned(from), endMs: aligned(to), text: segment.text,
					words: (segment.tokens ?? []).flatMap(token => {
						if (!token.text?.trim() || /^\[_.*\]$/.test(token.text) || !token.offsets ||
							token.offsets.from < from || token.offsets.to > to || token.offsets.to <= token.offsets.from) return [];
						return [{
							text: token.text, startMs: aligned(token.offsets.from), endMs: aligned(token.offsets.to),
							leadingSpace: /^\s/.test(token.text),
						}];
					}),
				}];
			}),
		});
		options.signal.throwIfAborted();
		const outputPath = path.resolve(options.outputPath);
		await fs.writeFile(outputPath, JSON.stringify(transcript, null, 2), { flag: "wx" });
		return { outputPath, segmentCount: transcript?.segments.length ?? 0 };
	} finally {
		await fs.rm(working, { recursive: true, force: true });
	}
}
