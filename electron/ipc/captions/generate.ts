import { execFile, spawnSync } from "node:child_process";
import { constants as fsConstants } from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { app } from "electron";
import { fromCaptionCues } from "../../../services/leadcut-mcp/src/transcriptModel";
import { uiText } from "../../uiI18n";
import { getFfmpegBinaryPath } from "../ffmpeg/binary";
import { getBundledWhisperExecutableCandidates } from "../paths/binaries";
import { resolveRecordingSession } from "../project/session";
import {
	getCompanionAudioStartDelayMs,
	getUsableCompanionAudioCandidates,
} from "../recording/diagnostics";
import { normalizeVideoSourcePath } from "../utils";
import { type CaptionAudioCandidate, getCaptionCompanionAudioCandidates } from "./audioCandidates";
import { shouldRetryWhisperWithoutJson } from "./parser";
import { readWhisperCaptionOutput } from "./output";
import { createCaptionCheckpoint } from "./checkpoint";
import { isMissingWindowsWhisperRuntimeDependency } from "./runtimeErrors";
import { mergeCaptionSources } from "./mergeSources";
import { segmentCuesIntoPhrases } from "./segment";
import {
	parseSilenceIntervals,
	SILENCE_DETECT_MIN_S,
	SILENCE_NOISE_DB,
	type SilenceInterval,
} from "./silence";

const execFileAsync = promisify(execFile);

class NoCaptionAudioError extends Error {}

const WHISPER_WINDOW_MS = 10 * 60_000;
const WAV_BYTES_PER_MILLISECOND = 32; // 16 kHz, mono, 16-bit PCM.

async function executeWhisper(whisperExecutablePath: string, args: string[], signal?: AbortSignal) {
	try {
		await execFileAsync(whisperExecutablePath, args, {
			windowsHide: true,
			signal,
			timeout: 30 * 60 * 1000,
			maxBuffer: 20 * 1024 * 1024,
		});
	} catch (error) {
		if (isMissingWindowsWhisperRuntimeDependency(error)) {
			throw new Error(uiText("whisperRuntimeDependencyMissing"));
		}
		throw error;
	}
}

export async function ensureReadableFile(filePath: string, options?: { executable?: boolean }) {
	await fs.access(filePath, fsConstants.R_OK);
	if (options?.executable) {
		try {
			await fs.access(filePath, fsConstants.X_OK);
		} catch {
			throw new Error("The selected Whisper executable is not marked as executable.");
		}
	}
}

export async function isExecutableFile(filePath: string) {
	try {
		await fs.access(filePath, fsConstants.R_OK | fsConstants.X_OK);
		return true;
	} catch {
		return false;
	}
}

export async function resolveWhisperExecutablePath(preferredPath?: string | null) {
	const candidatePaths = [
		preferredPath?.trim() || null,
		...getBundledWhisperExecutableCandidates(),
		process.env["WHISPER_CPP_PATH"]?.trim() || null,
		process.platform === "darwin" ? "/opt/homebrew/bin/whisper-cli" : null,
		process.platform === "darwin" ? "/usr/local/bin/whisper-cli" : null,
		process.platform === "darwin" ? "/opt/homebrew/bin/whisper-cpp" : null,
		process.platform === "darwin" ? "/usr/local/bin/whisper-cpp" : null,
	].filter((value): value is string => Boolean(value));

	for (const candidate of candidatePaths) {
		const normalized = path.resolve(candidate);
		if (await isExecutableFile(normalized)) {
			return normalized;
		}
	}

	const pathCommand = process.platform === "win32" ? "where" : "which";
	const binaryNames =
		process.platform === "win32"
			? ["whisper-cli.exe", "whisper.exe", "main.exe"]
			: ["whisper-cli", "whisper-cpp", "whisper", "main"];

	for (const binaryName of binaryNames) {
		const result = spawnSync(pathCommand, [binaryName], { encoding: "utf-8", windowsHide: true });
		if (result.status === 0) {
			const resolvedPath = result.stdout
				.split(/\r?\n/)
				.map((line) => line.trim())
				.find(Boolean);

			if (resolvedPath && (await isExecutableFile(resolvedPath))) {
				return resolvedPath;
			}
		}
	}

	throw new Error(
		`No Whisper runtime was found for ${process.platform}/${process.arch}. ` +
			uiText("whisperCaptionRuntimeMissing"),
	);
}

export async function resolveCaptionAudioCandidates(videoPath: string) {
	const candidates: Array<{ path: string; label: string }> = [];
	const seenPaths = new Set<string>();

	const pushCandidate = (candidatePath: string | null | undefined, label: string) => {
		const normalizedCandidatePath = normalizeVideoSourcePath(candidatePath);
		if (!normalizedCandidatePath || seenPaths.has(normalizedCandidatePath)) {
			return;
		}

		seenPaths.add(normalizedCandidatePath);
		candidates.push({ path: normalizedCandidatePath, label });
	};

	const companionAudio = await getUsableCompanionAudioCandidates(videoPath);
	const companions = getCaptionCompanionAudioCandidates(companionAudio);
	for (const candidate of companions.filter(
		(candidate) => candidate.label === "microphone audio sidecar",
	)) {
		pushCandidate(candidate.path, candidate.label);
	}
	pushCandidate(videoPath, "recording");
	for (const candidate of companions) {
		pushCandidate(candidate.path, candidate.label);
	}

	const requestedRecordingSession = await resolveRecordingSession(videoPath);
	pushCandidate(requestedRecordingSession?.webcamPath, "linked webcam recording");

	return candidates;
}

export async function extractCaptionAudioSource(options: {
	videoPath: string;
	ffmpegPath: string;
	wavPath: string;
	candidates?: CaptionAudioCandidate[];
	signal?: AbortSignal;
}) {
	const candidates =
		options.candidates ?? (await resolveCaptionAudioCandidates(options.videoPath));
	const attemptedCandidates: Array<{
		path: string;
		label: string;
		readable: boolean;
		extractedAudio: boolean;
		error?: string;
	}> = [];

	for (const candidate of candidates) {
		try {
			await ensureReadableFile(candidate.path);
			const delayMs = candidate.label.endsWith("audio sidecar")
				? ((await getCompanionAudioStartDelayMs(candidate.path)) ?? 0)
				: 0;
			await execFileAsync(
				options.ffmpegPath,
				[
					"-y",
					"-i",
					candidate.path,
					"-map",
					"0:a:0",
					"-vn",
					...(delayMs > 0 ? ["-af", `adelay=${delayMs}:all=1`] : []),
					"-ac",
					"1",
					"-ar",
					"16000",
					"-c:a",
					"pcm_s16le",
					options.wavPath,
				],
				{ timeout: 5 * 60 * 1000, maxBuffer: 20 * 1024 * 1024, windowsHide: true, signal: options.signal },
			);
			attemptedCandidates.push({ ...candidate, readable: true, extractedAudio: true });
			return candidate;
		} catch (error) {
			options.signal?.throwIfAborted();
			attemptedCandidates.push({
				...candidate,
				readable: true,
				extractedAudio: false,
				error: error instanceof Error ? error.message : String(error),
			});
		}
	}

	console.warn(
		"[auto-captions] No audio source candidate could be extracted:",
		attemptedCandidates,
	);

	throw new NoCaptionAudioError(
		"No audio was found to transcribe in the saved recording file. Captions need an audio track. If this recording should have contained sound, the recording was saved without an audio stream.",
	);
}

export async function detectSilenceIntervals(options: {
	ffmpegPath: string;
	wavPath: string;
	signal?: AbortSignal;
}): Promise<SilenceInterval[]> {
	// ffmpeg writes silencedetect results to stderr; the null muxer just runs the filter.
	const { stderr } = await execFileAsync(
		options.ffmpegPath,
		[
			"-hide_banner",
			"-nostats",
			"-i",
			options.wavPath,
			"-af",
			`silencedetect=noise=${SILENCE_NOISE_DB}dB:d=${SILENCE_DETECT_MIN_S}`,
			"-f",
			"null",
			"-",
		],
		{ timeout: 5 * 60 * 1000, maxBuffer: 20 * 1024 * 1024, windowsHide: true, signal: options.signal },
	);

	return parseSilenceIntervals(stderr ?? "");
}

async function generateCaptionsForSource(options: {
	videoPath: string;
	whisperExecutablePath?: string;
	whisperModelPath: string;
	language?: string;
	candidates: CaptionAudioCandidate[];
	signal?: AbortSignal;
	onProgress?: (progress: number) => void;
}) {
	const ffmpegPath = getFfmpegBinaryPath();
	const normalizedVideoPath = normalizeVideoSourcePath(options.videoPath);
	if (!normalizedVideoPath) {
		throw new Error("Missing source video path.");
	}

	const whisperExecutablePath = await resolveWhisperExecutablePath(options.whisperExecutablePath);
	const whisperModelPath = path.resolve(options.whisperModelPath);
	await ensureReadableFile(whisperExecutablePath, { executable: true });
	await ensureReadableFile(whisperModelPath);

	const tempBase = path.join(
		app.getPath("temp"),
		`leadcut-captions-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
	);
	const wavPath = `${tempBase}.wav`;

	try {
		const audioSource = await extractCaptionAudioSource({
			videoPath: normalizedVideoPath,
			ffmpegPath,
			wavPath,
			candidates: options.candidates,
			signal: options.signal,
		});

		const language =
			options.language && options.language.trim() ? options.language.trim() : "auto";
		const { signal } = options;
		const durationMs = Math.max(0, Math.floor(((await fs.stat(wavPath)).size - 44) / WAV_BYTES_PER_MILLISECOND / 10) * 10);
		const chunks = Math.max(1, Math.ceil(durationMs / WHISPER_WINDOW_MS));
		const checkpoint = chunks > 1 ? await createCaptionCheckpoint(
			path.join(app.getPath("userData"), "caption-progress"), {
				audioPath: audioSource.path, modelPath: whisperModelPath, executablePath: whisperExecutablePath,
				language, durationMs, windowMs: WHISPER_WINDOW_MS, windowCount: chunks,
			},
		) : null;
		const saved = await checkpoint?.read();
		const cues = saved?.cues ?? [];
		let jsonEnabled = saved?.usesFullJson ?? true;
		const firstChunk = saved?.nextWindow ?? 0;
		if (firstChunk > 0) options.onProgress?.(0.9 * firstChunk / chunks);
		for (let chunk = firstChunk; chunk < chunks; chunk++) {
			signal?.throwIfAborted();
			const offsetMs = chunk * WHISPER_WINDOW_MS;
			const output = `${tempBase}-whisper-${chunk}`;
			const chunkWav = chunks === 1 ? wavPath : `${output}.wav`;
			try {
				if (chunks > 1) {
					await execFileAsync(ffmpegPath, [
						"-hide_banner", "-loglevel", "error", "-nostdin", "-ss", String(offsetMs / 1000),
						"-i", wavPath, "-t", String(WHISPER_WINDOW_MS / 1000), "-c:a", "pcm_s16le", chunkWav,
					], { timeout: 60_000, windowsHide: true, signal });
				}
				const args = [
					"-m", whisperModelPath, "-f", chunkWav, "-osrt", "-of", output, "-l", language,
					"-t", String(Math.max(1, Math.floor(os.availableParallelism() / 2))),
					// Keep each piece independent of the previous decoder context.
					"-np", "-mc", "0",
				];
				try {
					await executeWhisper(whisperExecutablePath, jsonEnabled ? [...args, "-ojf"] : args, signal);
				} catch (error) {
					if (!jsonEnabled || signal?.aborted || !shouldRetryWhisperWithoutJson(error)) throw error;
					jsonEnabled = false;
					await executeWhisper(whisperExecutablePath, args, signal);
				}
				const decoded = await readWhisperCaptionOutput(output, jsonEnabled);
				for (const cue of decoded) {
					cues.push({
						...cue, id: `caption-${cues.length + 1}`,
						startMs: cue.startMs + offsetMs, endMs: cue.endMs + offsetMs,
						...(cue.words && {
							words: cue.words.map(word => ({ ...word, startMs: word.startMs + offsetMs, endMs: word.endMs + offsetMs })),
						}),
					});
				}
				await checkpoint?.save({ nextWindow: chunk + 1, usesFullJson: jsonEnabled, cues });
				options.onProgress?.(0.9 * (chunk + 1) / chunks);
			} finally {
				await Promise.allSettled([
					fs.rm(`${output}.srt`, { force: true }),
					fs.rm(`${output}.json`, { force: true }),
					...(chunkWav === wavPath ? [] : [fs.rm(chunkWav, { force: true })]),
				]);
			}
		}
		const rawCues = structuredClone(cues);

		// Whisper cues run sentences together and don't break on pauses. Re-segment them
		// into one caption per sentence/phrase using Whisper's own word stream (punctuation
		// + pauses), backed by ground-truth acoustic silence (ffmpeg `silencedetect`).
		// Failure here must not block caption generation — fall back to raw.
		let cuesToReturn = cues;
		try {
			const silences = await detectSilenceIntervals({ ffmpegPath, wavPath, signal });
			// An empty result is a valid resegmentation (e.g. every transcribed word fell
			// inside a long detected silence and was dropped as a hallucination), so take it
			// as-is. Only a thrown exception should fall back to the raw cues.
			cuesToReturn = segmentCuesIntoPhrases(cues, silences);
		} catch (error) {
			signal?.throwIfAborted();
			console.warn(
				"[auto-captions] Silence-aware re-segmentation failed, using raw cues:",
				error,
			);
		}
		await checkpoint?.clear();
		options.onProgress?.(1);

		return {
			cues: cuesToReturn,
			rawCues,
			audioPath: audioSource.path,
			audioSourceLabel: audioSource.label,
		};
	} finally {
		await fs.rm(wavPath, { force: true }).catch(() => undefined);
	}
}

export async function generateAutoCaptionsFromVideo(options: {
	videoPath: string;
	whisperExecutablePath?: string;
	whisperModelPath: string;
	language?: string;
	signal?: AbortSignal;
	onProgress?: (progress: number) => void;
}) {
	const createTranscript = (sources: Awaited<ReturnType<typeof generateCaptionsForSource>>[]) =>
		fromCaptionCues(sources.flatMap(result => result.rawCues).map((cue, index) => ({
			...cue, id: `segment-${index + 1}`,
		})), {
			engine: "whisper.cpp",
			model: path.resolve(options.whisperModelPath),
			language: options.language?.trim() || "auto",
			...(sources.length === 1 ? { audioPath: sources[0].audioPath } : {}),
		});
	const candidates = await resolveCaptionAudioCandidates(options.videoPath);
	const microphone = candidates.filter((source) => source.label === "microphone audio sidecar");
	const system = candidates.filter((source) => source.label === "system audio sidecar");
	const secondary = candidates.filter(
		(source) => !microphone.includes(source) && !system.includes(source),
	);
	if (microphone.length === 0) {
		const source = await generateCaptionsForSource({ ...options, candidates: [...system, ...secondary] });
		return { cues: source.cues, transcript: createTranscript([source]), audioSourceLabel: source.audioSourceLabel };
	}
	// Decode independently so simultaneous voices do not confuse recognition. The
	// sidecar replaces embedded system audio to avoid transcribing it twice.
	const transcribeTrack = async (sources: CaptionAudioCandidate[], track: number) => {
		try {
			return await generateCaptionsForSource({
				...options,
				candidates: sources,
				onProgress: (progress) => options.onProgress?.((track + progress) / 2),
			});
		} catch (error) {
			if (!(error instanceof NoCaptionAudioError)) throw error;
			return null;
		}
	};
	const micTrack = await transcribeTrack(microphone, 0);
	const systemTrack = await transcribeTrack([...system, ...secondary], 1);
	options.onProgress?.(1);
	if (micTrack === null && systemTrack === null)
		throw new NoCaptionAudioError("No audio could be extracted from the recording.");
	return {
		cues: mergeCaptionSources(micTrack?.cues ?? [], systemTrack?.cues ?? []),
		transcript: createTranscript([micTrack, systemTrack].filter(track => track !== null)),
		audioSourceLabel: "microphone and system audio",
	};
}
