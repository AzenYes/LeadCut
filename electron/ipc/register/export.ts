import { handleTrustedIpc, onTrustedIpc } from "../../trustedIpc";
import { stopProcessTree } from "../../../services/leadcut-mcp/src/stopProcessTree";
import { convertVideoToGif, type GifConversionRequest } from "../export/gif";
import { AudioPcmWindowPool, audioPcmOutputArgs, type AudioPcmWindow } from "../export/audioPcmWindows";
import { runBinaryExportProcess, runExportProcess } from "../export/runExportProcess";
import { getStagedAudioPcmWindow } from "../export/stagedAudioPcm";
import { uiText } from "../../uiI18n";
import { randomUUID } from "node:crypto";
import type { ChildProcessByStdio } from "node:child_process";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { PassThrough, type Readable, type Writable } from "node:stream";
import type { SaveDialogOptions, WebContents } from "electron";
import { app, BrowserWindow, dialog } from "electron";
import { readAppSetting, writeAppSetting } from "../../appSettingsStore";
import { logSubprocessStderr } from "../../logger";
import { buildMediaUrl, getMediaServerBaseUrl } from "../../mediaServer";
import { LAST_EXPORT_DIRECTORY_SETTING_KEY } from "../../../src/lib/storageKeys";
import { getExportStorageErrorKey, isExportStorageFull } from "../../../src/lib/exporter/exportStorageError";
import { MAX_EXPORT_SOURCE_PCM_WINDOW_BYTES } from "../../../src/lib/exporter/editedAudioWav";
import {
	cleanupAllExportStreams,
	closeExportStream,
	isDestinationStagedExportPath,
	isOwnedExportPath,
	openExportStream,
	registerOwnedExportPath,
	releaseOwnedExportPath,
	removeExportStreamDirectory,
	removeExportStreamTemp,
	writeToExportStream,
	type ExportStreamOptions,
} from "../export/exportStream";
import {
	appendCompatibleAudio,
	canRetryCompatibleAudio,
	cleanupNativeVideoExportSessions,
	buildNativeVideoAudioMuxArgs,
	enqueueNativeVideoExportFrameWrite,
	enqueueNativeVideoExportFrameWrites,
	exportNativeStaticLayoutVideo,
	flushNativeVideoExportPendingWriteRequests,
	getExportHardwareInfo,
	getNativeExportCapabilities,
	getNativeVideoExportMaxQueuedWriteBytes,
	getNativeVideoExportSessionError,
	isHardwareAcceleratedVideoEncoder,
	isIgnorableNativeVideoExportStreamError,
	muxExportedVideoAudioBuffer,
	muxNativeVideoExportAudio,
	type NativeStaticLayoutExportOptions,
	type NativeVideoExportSession,
	nativeStaticLayoutExportSessions,
	nativeVideoExportSessions,
	probeNativeVideoMetadata,
	removeTemporaryExportFile,
	resolveNativeVideoEncoder,
	sendNativeVideoExportWriteFrameResult,
	settleNativeVideoExportWriteFrameRequest,
} from "../export/native-video";
import { getFfmpegBinaryPath, getFfprobeBinaryPath } from "../ffmpeg/binary";
import {
	buildNativeH264StreamExportArgs,
	buildNativeVideoExportArgs,
	getNativeH264StreamAudioMuxOptions,
	getNativeVideoInputByteSize,
	type ExportAudioAppendDisposition,
	type ExportAudioAppendResult,
	type NativeExportEncodingMode,
	type NativeH264StreamAudioOptions,
	type NativeH264StreamSourceAudioOptions,
	type NativeVideoExportFinishOptions,
} from "../nativeVideoExport";
import { isAllowedLocalReadPath, resolveApprovedLocalMediaPath } from "../project/manager";
import { approveUserPath } from "../utils";
import {
	type CaptionSidecarPayload,
	parseCaptionSidecarPayload,
	withCaptionSidecarMessage,
	writeCaptionSidecarsBestEffort,
} from "./exportCaptionSidecars";

export async function resolveDefaultExportDirectory() {
	try {
		const directory = readAppSetting(LAST_EXPORT_DIRECTORY_SETTING_KEY);
		if (typeof directory === "string" && directory.length > 0 && (await fs.stat(directory)).isDirectory()) {
			return directory;
		}
	} catch {
		// A previously selected removable volume may no longer be mounted.
	}
	return app.getPath("downloads");
}

export function resolveUniqueExportFileName(dir: string, fileName: string, exists: (file: string) => boolean) {
	const { base, name, ext } = path.parse(path.basename(fileName));
	if (!exists(path.join(dir, base))) return base;
	let suffix = 2;
	while (exists(path.join(dir, `${name} (${suffix})${ext}`))) suffix++;
	return `${name} (${suffix})${ext}`;
}

async function resolveDefaultExportPath(fileName: string) {
	const directory = await resolveDefaultExportDirectory();
	return path.join(directory, resolveUniqueExportFileName(directory, fileName, existsSync));
}

function rememberExportDirectory(filePath: string) {
	try {
		writeAppSetting(LAST_EXPORT_DIRECTORY_SETTING_KEY, path.dirname(filePath));
	} catch (error) {
		console.warn("Could not remember export directory:", error);
	}
}

function getPartialExportDestinationPath(destinationPath: string) {
	const parsed = path.parse(destinationPath);
	const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
	return path.join(parsed.dir, `.leadcut-partial-${parsed.name}-${suffix}${parsed.ext}`);
}

const MAX_IN_MEMORY_EXPORT_BYTES = 0x7fffffff;
const MIN_AUDIO_DEMUX_INPUT_BYTES = 512 * 1024 * 1024;

function getInMemoryExportTooLargeMessage(byteLength: number) {
	if (byteLength <= MAX_IN_MEMORY_EXPORT_BYTES) {
		return null;
	}

	return "Export is too large for the legacy in-memory save path. Please retry with temp-file streaming enabled.";
}

export async function moveExportedTempFile(tempPath: string, destinationPath: string) {
	await fs.mkdir(path.dirname(destinationPath), { recursive: true });
	try {
		await fs.rename(tempPath, destinationPath);
		await removeExportStreamDirectory(tempPath);
		return;
	} catch (error) {
		const code = (error as NodeJS.ErrnoException).code;
		if (code !== "EXDEV" && code !== "EPERM" && code !== "ENOTEMPTY" && code !== "EEXIST") {
			throw error;
		}
		const targetDirectory = path.dirname(path.resolve(destinationPath));
		const tempDirectory = path.dirname(path.resolve(tempPath));
		const sameDirectory = tempDirectory === targetDirectory ||
			(isDestinationStagedExportPath(tempPath) && path.dirname(tempDirectory) === targetDirectory);
		if (code !== "EXDEV" && sameDirectory) {
			// Windows can report EPERM for replacement. Check whether the destination
			// can be moved before performing any more writes.
			await replaceExistingExport(tempPath, destinationPath);
			await removeExportStreamDirectory(tempPath);
			return;
		}
	}

	const partialDestinationPath = getPartialExportDestinationPath(destinationPath);
	try {
		await fs.copyFile(tempPath, partialDestinationPath);
		try {
			await fs.rename(partialDestinationPath, destinationPath);
		} catch (renameError) {
			const code = (renameError as NodeJS.ErrnoException).code;
			if (code !== "EEXIST" && code !== "EPERM") {
				throw renameError;
			}

			await replaceExistingExport(partialDestinationPath, destinationPath);
		}
		try {
			await removeExportStreamTemp(tempPath);
		} catch (unlinkError) {
			// Copy succeeded, so the export itself is safe; surface the leaked temp
			// path instead of silently swallowing the failure so operators can
			// reclaim disk space manually if the OS temp reaper misses it.
			console.warn(
				`[export] Failed to remove temp file after cross-volume copy (${tempPath}):`,
				unlinkError,
			);
		}
	} catch (error) {
		await fs.rm(partialDestinationPath, { force: true }).catch(() => undefined);
		throw error;
	}
}

async function replaceExistingExport(tempPath: string, destinationPath: string) {
	const backup = getPartialExportDestinationPath(destinationPath);
	let movedExistingDestination = false;
	try {
		await fs.rename(destinationPath, backup);
		movedExistingDestination = true;
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
	}

	try {
		await fs.rename(tempPath, destinationPath);
	} catch (error) {
		if (movedExistingDestination) await fs.rename(backup, destinationPath).catch(() => undefined);
		throw error;
	}
	if (movedExistingDestination) {
		await fs.rm(backup, { force: true }).catch((error) => {
			console.warn(`[export] Failed to remove backup file after replace (${backup}):`, error);
		});
	}
}

async function resolveAllowedReadableFilePath(
	filePath: string,
	label: string,
	options: { mediaOnly?: boolean } = {},
) {
	if (typeof filePath !== "string" || filePath.trim().length === 0) {
		throw new Error(`${label} requires a file path`);
	}

	if (options.mediaOnly ?? true) {
		const resolvedMediaPath = await resolveApprovedLocalMediaPath(filePath);
		if (!resolvedMediaPath) {
			throw new Error(`${label} is not an approved readable media file`);
		}

		return resolvedMediaPath;
	}

	const resolvedPath = path.resolve(filePath);
	if (!isAllowedLocalReadPath(resolvedPath)) {
		throw new Error(`${label} is not approved for local reads`);
	}

	const realPath = await fs.realpath(resolvedPath).catch(() => null);
	if (!realPath) {
		throw new Error(`${label} does not exist`);
	}

	const stat = await fs.stat(realPath).catch(() => null);
	if (!stat?.isFile()) {
		throw new Error(`${label} is not a readable file`);
	}

	if (!isAllowedLocalReadPath(realPath)) {
		throw new Error(`${label} is not approved for local reads`);
	}

	return realPath;
}

async function sanitizeNativeStaticLayoutExportOptions(
	options: NativeStaticLayoutExportOptions,
): Promise<NativeStaticLayoutExportOptions> {
	const sanitized: NativeStaticLayoutExportOptions = {
		...options,
		inputPath: await resolveAllowedReadableFilePath(options.inputPath, "Native input"),
	};
	const mutableOptions = sanitized as unknown as Record<string, unknown>;

	for (const [field, label] of [
		["backgroundImagePath", "Native background image"],
		["webcamInputPath", "Native webcam input"],
		["cursorAtlasPath", "Native cursor atlas"],
	] as const) {
		const value = mutableOptions[field];
		if (typeof value === "string" && value.trim().length > 0) {
			mutableOptions[field] = await resolveAllowedReadableFilePath(value, label);
		} else if (value === "" || value === undefined) {
			mutableOptions[field] = null;
		} else if (value !== null) {
			throw new Error(`${label} must be a file path`);
		}
	}

	for (const [field, label] of [
		["cursorTelemetryPath", "Native cursor telemetry"],
		["cursorAtlasMetadataPath", "Native cursor atlas metadata"],
		["zoomTelemetryPath", "Native zoom telemetry"],
		["timelineMapPath", "Native timeline map"],
	] as const) {
		const value = mutableOptions[field];
		if (typeof value === "string" && value.trim().length > 0) {
			mutableOptions[field] = await resolveAllowedReadableFilePath(value, label, {
				mediaOnly: false,
			});
		} else if (value === "" || value === undefined) {
			mutableOptions[field] = null;
		} else if (value !== null) {
			throw new Error(`${label} must be a file path`);
		}
	}

	const audioOptions = sanitized.audioOptions;
	if (audioOptions?.audioSourcePath) {
		sanitized.audioOptions = {
			...audioOptions,
			audioSourcePath: await resolveAllowedReadableFilePath(
				audioOptions.audioSourcePath,
				"Native audio source",
			),
		};
	}

	return sanitized;
}

function isTempPathSafe(tempPath: string): boolean {
	if (isDestinationStagedExportPath(tempPath)) return true;
	const tempRoot = path.resolve(app.getPath("temp"));
	const candidate = path.resolve(tempPath);
	if (candidate === tempRoot) {
		return false;
	}
	const withSep = tempRoot.endsWith(path.sep) ? tempRoot : tempRoot + path.sep;
	return candidate.startsWith(withSep);
}

let exportGeneration = 0;
const selectedExportDestinations = new WeakMap<WebContents, { path: string; generation: number }>();

function getSelectedExportDestination(sender: WebContents, requested: unknown, generation: number) {
	const selected = selectedExportDestinations.get(sender);
	return selected?.generation === generation && typeof requested === "string" && selected.path === path.resolve(requested)
		? selected.path : undefined;
}

const activeGifConversions = new Map<string, AbortController>();
const activeAudioPreparations = new Map<number, AbortController>();
const exportPreparations = new Set<{ controller: AbortController; finished: Promise<void> }>();
const activeAudioPcmReaders = new Map<number, {
	id: string;
	pool: AudioPcmWindowPool;
	close: () => Promise<void>;
}>();
const activeAudioAppends = new Map<string, {
	sender: WebContents;
	videoPath: string;
	input: PassThrough;
	controller: AbortController;
	completion: Promise<ExportAudioAppendResult>;
	commit: () => void;
	onDestroyed: () => void;
	writing: boolean;
}>();

function beginExportPreparation() {
	const controller = new AbortController();
	let settle: () => void = () => undefined;
	const finished = new Promise<void>(resolve => { settle = resolve; });
	const preparation = { controller, finished };
	exportPreparations.add(preparation);
	return {
		controller,
		finished,
		finish() {
			exportPreparations.delete(preparation);
			settle();
		},
	};
}

function beginAudioPreparation(sender: WebContents) {
	if (activeAudioPreparations.has(sender.id)) return null;
	const preparation = beginExportPreparation();
	const cancel = () => preparation.controller.abort();
	activeAudioPreparations.set(sender.id, preparation.controller);
	sender.once("destroyed", cancel);
	return {
		signal: preparation.controller.signal,
		finish() {
			activeAudioPreparations.delete(sender.id);
			if (!sender.isDestroyed()) sender.removeListener("destroyed", cancel);
			preparation.finish();
		},
	};
}

export async function cleanupRendererExports() {
	exportGeneration++;
	for (const session of activeAudioAppends.values()) {
		if (!session.sender.isDestroyed()) session.sender.removeListener("destroyed", session.onDestroyed);
		session.controller.abort();
	}
	activeAudioAppends.clear();
	const preparations = [...exportPreparations];
	for (const { controller } of preparations) controller.abort();
	const readers = [...activeAudioPcmReaders.values()].map(reader => reader.close());
	await Promise.all([
		cleanupNativeVideoExportSessions(),
		cleanupAllExportStreams(Promise.all([...readers, ...preparations.map(({ finished }) => finished)])),
	]);
}

async function registerRendererExportPath(tempPath: string, generation: number, stagedBesideDestination = false) {
	if (generation !== exportGeneration) {
		await removeTemporaryExportFile(tempPath);
		throw new Error("Export renderer exited.");
	}
	registerOwnedExportPath(tempPath, stagedBesideDestination);
}

export function registerExportHandlers() {
	handleTrustedIpc("start-export-audio-append", ({ sender }, videoPath: unknown, durationSec: unknown) => {
		if (typeof videoPath !== "string" || !isOwnedExportPath(videoPath) ||
			typeof durationSec !== "number" || !Number.isFinite(durationSec) || durationSec <= 0) {
			return { success: false, error: "Invalid staged video or audio duration" };
		}
		if ([...activeAudioAppends.values()].some(session => session.sender === sender || session.videoPath === videoPath)) {
			return { success: false, error: "Audio append is already active" };
		}
		const runId = randomUUID();
		const preparation = beginExportPreparation();
		const { controller } = preparation;
		const { signal } = controller;
		const input = new PassThrough({ highWaterMark: 64 * 1024 });
		input.on("error", () => { /* Surface failure via the operation's completion. */ });
		let commit: () => void = () => undefined;
		const readyToCommit = new Promise<void>(resolve => { commit = resolve; });
		const abort = () => {
			commit();
			input.destroy();
		};
		signal.addEventListener("abort", abort, { once: true });
		const completion: Promise<ExportAudioAppendResult> = appendCompatibleAudio(videoPath, "pipe:0", {
			audioMode: "edited-track", editedTrackStrategy: "offline-render-fallback", outputDurationSec: durationSec,
		}, input, signal, readyToCommit).then(
			metrics => ({ success: true as const, metrics }),
			error => ({ success: false as const, error: String(error), retryable: canRetryCompatibleAudio(error) }),
		).finally(() => {
			input.destroy();
			signal.removeEventListener("abort", abort);
			preparation.finish();
		});
		const onDestroyed = () => {
			activeAudioAppends.delete(runId);
			controller.abort();
			void completion.then(async () => {
				if (!isOwnedExportPath(videoPath)) return;
				releaseOwnedExportPath(videoPath);
				await removeExportStreamTemp(videoPath).catch(() => undefined);
			});
		};
		sender.once("destroyed", onDestroyed);
		activeAudioAppends.set(runId, { sender, videoPath, input, controller, completion, commit, onDestroyed, writing: false });
		return { success: true, runId };
	});

	handleTrustedIpc("write-export-audio-append", async ({ sender }, runId: string, chunk: unknown) => {
		const session = activeAudioAppends.get(runId);
		if (!session || session.sender !== sender || session.writing ||
			!(chunk instanceof Uint8Array) || !chunk.byteLength || chunk.byteLength > 2 * 1024 * 1024) {
			return { success: false, error: "Invalid audio append stream or chunk" };
		}
		session.writing = true;
		try {
			await new Promise<void>((resolve, reject) => {
				session.input.write(Buffer.from(chunk.buffer, chunk.byteOffset, chunk.byteLength),
					error => error ? reject(error) : resolve());
			});
			return { success: true };
		} catch (error) {
			return { success: false, error: String(error) };
		} finally {
			session.writing = false;
		}
	});

	handleTrustedIpc("finish-export-audio-append", async ({ sender }, runId: string, disposition: ExportAudioAppendDisposition) => {
		const session = activeAudioAppends.get(runId);
		if (!session || session.sender !== sender || !["finish", "retry", "cancel"].includes(disposition)) {
			return { success: false, error: "Audio append stream is no longer active" };
		}
		if (disposition === "finish") {
			if (!session.input.writableEnded && !session.input.destroyed) session.input.end();
			session.commit();
		} else {
			session.controller.abort();
		}
		const result = await session.completion;
		activeAudioAppends.delete(runId);
		if (!sender.isDestroyed()) sender.removeListener("destroyed", session.onDestroyed);
		if (disposition === "cancel" || (!result.success && !result.retryable)) {
			if (isOwnedExportPath(session.videoPath)) {
				releaseOwnedExportPath(session.videoPath);
				await removeExportStreamTemp(session.videoPath).catch(() => undefined);
			}
		}
		return result;
	});

	handleTrustedIpc("cancel-export-gif", (event, runId: unknown) => {
		if (typeof runId === "string") activeGifConversions.get(`${event.sender.id}:${runId}`)?.abort();
	});
	handleTrustedIpc("convert-export-to-gif", async (event, input: GifConversionRequest) => {
		const generation = exportGeneration;
		if (!input || typeof input.videoPath !== "string" || !isOwnedExportPath(input.videoPath) ||
			typeof input.runId !== "string" || !/^[a-f0-9-]{36}$/i.test(input.runId) ||
			![10, 15, 20, 25, 30].includes(input.fps) ||
			(input.frameCount !== undefined && (!Number.isSafeInteger(input.frameCount) || input.frameCount < 1)) ||
			![input.width, input.height].every(value => Number.isInteger(value) && value > 0 && value <= 8192)) {
			return { success: false, error: "Invalid GIF conversion inputs." };
		}
		const key = `${event.sender.id}:${input.runId}`;
		if (activeGifConversions.has(key)) return { success: false, error: "GIF conversion already running." };
		const { controller, finish } = beginExportPreparation();
		activeGifConversions.set(key, controller);
		const onDestroyed = () => controller.abort();
		event.sender.once("destroyed", onDestroyed);
		let outputPath: string | undefined;
		try {
			outputPath = path.join(app.getPath("temp"), `leadcut-export-${randomUUID()}.gif`);
			await convertVideoToGif({ ...input, outputPath, signal: controller.signal });
			controller.signal.throwIfAborted();
			await registerRendererExportPath(outputPath, generation);
			return { success: true, tempPath: outputPath };
		} catch (error) {
			if (outputPath) await removeTemporaryExportFile(outputPath);
			return { success: false, error: controller.signal.aborted ? "Export cancelled" : String(error) };
		} finally {
			activeGifConversions.delete(key);
			if (!event.sender.isDestroyed()) event.sender.removeListener("destroyed", onDestroyed);
			finish();
		}
	});
	handleTrustedIpc("cancel-export-audio-pcm", ({ sender }) => {
		activeAudioPreparations.get(sender.id)?.abort();
		return activeAudioPcmReaders.get(sender.id)?.close();
	});
	handleTrustedIpc("open-export-audio-pcm-reader", ({ sender }) => {
		const senderId = sender.id;
		if (activeAudioPcmReaders.has(senderId)) throw new Error("An export PCM reader is already active");
		const id = randomUUID();
		const pool = new AudioPcmWindowPool(getFfmpegBinaryPath());
		let closing: Promise<void> | undefined;
		const onDestroyed = () => { void close(); };
		const close = () => {
			closing ??= pool.close().finally(() => {
				activeAudioPcmReaders.delete(senderId);
				if (!sender.isDestroyed()) sender.removeListener("destroyed", onDestroyed);
			});
			return closing;
		};
		activeAudioPcmReaders.set(senderId, { id, pool, close });
		sender.once("destroyed", onDestroyed);
		return id;
	});
	handleTrustedIpc("close-export-audio-pcm-reader", ({ sender }, readerId: unknown) => {
		const reader = activeAudioPcmReaders.get(sender.id);
		if (reader && reader.id === readerId) return reader.close();
	});
	handleTrustedIpc("encode-export-audio-aac", async ({ sender, senderFrame }, input: unknown) => {
		if (
			senderFrame !== sender.mainFrame || typeof input !== "string" ||
			path.extname(input) !== ".wav" || !isOwnedExportPath(input)
		) return null;
		const generation = exportGeneration;
		const preparation = beginAudioPreparation(sender);
		if (!preparation) return null;
		const { signal, finish } = preparation;
		let outputPath: string | undefined;
		try {
			const stream = await openExportStream({ extension: "m4a" });
			outputPath = stream.tempPath;
			await closeExportStream(stream.streamId);
			await runExportProcess(getFfmpegBinaryPath(), [
				"-v", "error", "-nostdin", "-y", "-i", input, "-map", "0:a:0",
				"-c:a", "aac", "-b:a", "192k", outputPath,
			], { windowsHide: true, timeout: 30 * 60_000, signal });
			signal.throwIfAborted();
			await registerRendererExportPath(outputPath, generation);
			return outputPath;
		} catch (error) {
			if (outputPath) {
				releaseOwnedExportPath(outputPath);
				await removeExportStreamTemp(outputPath).catch(() => undefined);
			}
			if (isExportStorageFull(error)) throw error;
			return null;
		} finally {
			finish();
		}
	});
	handleTrustedIpc("prepare-export-audio-pcm", async ({ sender }, filePath: string, window?: unknown, useMemoryWindows?: unknown) => {
		const generation = exportGeneration;
		const preparation = beginAudioPreparation(sender);
		if (!preparation) return null;
		const { signal, finish } = preparation;
		let tempPath: string | undefined;
		try {
			const mediaEndpoint = getMediaServerBaseUrl();
			if (!mediaEndpoint) return null;
			const source = await resolveAllowedReadableFilePath(filePath, "Export PCM source");
			const options = { windowsHide: true, timeout: 30_000, signal };
			const result = await runExportProcess(getFfprobeBinaryPath(), [
				"-v", "error", "-select_streams", "a:0",
				"-show_entries", "stream=channels,sample_rate,duration:format=duration",
				"-of", "json", source,
			], options);
			const probe = JSON.parse(result.stdout);
			const audio = probe.streams?.[0];
			if (!audio) return null;
			const duration = Number(audio.duration) || Number(probe.format?.duration);
			if (!Number.isFinite(duration) || duration < 120) return null;
			const channels = Math.min(2, Number(audio.channels));
			const sampleRate = Number(audio.sample_rate);
			if (![1, 2].includes(channels) || !Number.isSafeInteger(sampleRate) || sampleRate < 1 || sampleRate > 384_000) return null;
			if (useMemoryWindows === true) {
				return {
					memoryWindows: true,
					frames: Math.ceil(duration * sampleRate),
					channels, sampleRate, sourceDurationSec: duration,
				};
			}
			const pcmWindow = getStagedAudioPcmWindow(window, sampleRate, duration);
			const bytesPerFrame = 2 * channels;
			const firstFrame = pcmWindow?.firstFrame ?? 0;
			const expectedFrames = pcmWindow?.endFrame === undefined ? undefined : pcmWindow.endFrame - firstFrame;
			const ffmpegArgs = [
				"-v", "error", "-nostdin", "-y", "-i", source, "-map", "0:a:0",
				...(pcmWindow ? ["-af", pcmWindow.filter] : []),
				"-ac", String(channels), "-ar", String(sampleRate), "-f", "s16le",
			];
			const describePcm = (frames: number) => ({
				frames, channels, sampleRate, firstFrame,
				sourceDurationSec: expectedFrames === undefined || frames < expectedFrames
					? (firstFrame + frames) / sampleRate : duration,
			});
			if (expectedFrames !== undefined && expectedFrames * bytesPerFrame <= MAX_EXPORT_SOURCE_PCM_WINDOW_BYTES) {
				const { stdout: pcm } = await runBinaryExportProcess(
					getFfmpegBinaryPath(), [...ffmpegArgs, "pipe:1"],
					{ ...options, timeout: 10 * 60_000, maxBuffer: MAX_EXPORT_SOURCE_PCM_WINDOW_BYTES },
				);
				signal.throwIfAborted();
				if (generation !== exportGeneration || !pcm.byteLength || pcm.byteLength % bytesPerFrame) return null;
				return { ...describePcm(pcm.byteLength / bytesPerFrame), pcm };
			}
			const stream = await openExportStream({ extension: "pcm" });
			tempPath = stream.tempPath;
			await closeExportStream(stream.streamId);
			await runExportProcess(getFfmpegBinaryPath(), [...ffmpegArgs, tempPath], { ...options, timeout: 10 * 60_000 });
			const frames = Math.floor((await fs.stat(tempPath)).size / bytesPerFrame);
			signal.throwIfAborted();
			if (frames <= 0 || generation !== exportGeneration) return null;
			const stagedPath = tempPath;
			const mediaPath = await fs.realpath(stagedPath);
			approveUserPath(mediaPath);
			tempPath = undefined;
			return { ...describePcm(frames), path: stagedPath, url: buildMediaUrl(mediaEndpoint, mediaPath) };
		} catch (error) {
			if (isExportStorageFull(error)) throw error;
			return null;
		} finally {
			if (tempPath) {
				releaseOwnedExportPath(tempPath);
				await removeExportStreamTemp(tempPath).catch(() => undefined);
			}
			finish();
		}
	});
	handleTrustedIpc("read-export-audio-pcm-window", async ({ sender }, filePath: string, window: AudioPcmWindow, readerId?: unknown) => {
		const { firstFrame, endFrame, channels, sampleRate } = window ?? {};
		const size = (endFrame - firstFrame) * channels * 2;
		if (![firstFrame, endFrame, sampleRate].every(Number.isSafeInteger) || firstFrame < 0 || endFrame <= firstFrame ||
			![1, 2].includes(channels) || !Number.isSafeInteger(endFrame * channels * 2) ||
			sampleRate < 1 || sampleRate > 384_000 || size > MAX_EXPORT_SOURCE_PCM_WINDOW_BYTES) {
			throw new Error("Invalid export PCM range");
		}
		const reader = readerId === undefined ? undefined : activeAudioPcmReaders.get(sender.id);
		if (readerId !== undefined && reader?.id !== readerId) throw new Error("Export PCM reader is closed");
		const preparation = beginAudioPreparation(sender);
		if (!preparation) throw new Error("Audio source preparation is already active");
		const { signal, finish } = preparation;
		try {
			const source = await resolveAllowedReadableFilePath(filePath, "Export PCM source");
			if (reader) {
				try {
					const timeout = AbortSignal.timeout(10 * 60_000);
					return await reader.pool.read(source, window, AbortSignal.any([signal, timeout]));
				} catch (error) {
					if (signal.aborted || (error instanceof Error && ["AbortError", "TimeoutError"].includes(error.name))) throw error;
					// Independent decoding can still succeed when a persistent stream fails.
				}
			}
			const { stdout: pcm } = await runBinaryExportProcess(getFfmpegBinaryPath(), [
				"-v", "error", "-nostdin", "-i", source, "-map", "0:a:0",
				"-af", `atrim=start_sample=${firstFrame}:end_sample=${endFrame}`,
				...audioPcmOutputArgs(channels, sampleRate),
			], { windowsHide: true, timeout: 10 * 60_000, maxBuffer: MAX_EXPORT_SOURCE_PCM_WINDOW_BYTES, signal });
			signal.throwIfAborted();
			return pcm;
		} finally {
			finish();
		}
	});
	handleTrustedIpc("prepare-export-audio-source", async (event, filePath: string) => {
		const generation = exportGeneration;
		const { controller: abort, finish } = beginExportPreparation();
		const cancel = () => abort.abort();
		let tempPath: string | undefined;
		try {
			const source = await resolveAllowedReadableFilePath(filePath, "Export audio source");
			if ((await fs.stat(source)).size < MIN_AUDIO_DEMUX_INPUT_BYTES) return null;
			const stream = await openExportStream({ extension: "mkv" });
			tempPath = stream.tempPath;
			await closeExportStream(stream.streamId);
			if (event.sender.isDestroyed()) return null;
			event.sender.once("destroyed", cancel);
			// Copy the original audio packets so range-based WebDemuxer decoding
			// can skip the large, interleaved video payload.
			await runExportProcess(
				getFfmpegBinaryPath(),
				[
					"-v", "error", "-nostdin", "-y", "-copyts", "-i", source,
					"-map", "0:a:0", "-c:a", "copy", "-avoid_negative_ts", "disabled", tempPath,
				],
				{ windowsHide: true, timeout: 120_000, signal: abort.signal },
			);
			if (event.sender.isDestroyed() || generation !== exportGeneration) return null;
			approveUserPath(tempPath);
			const prepared = tempPath;
			tempPath = undefined;
			return prepared;
		} catch {
			// The browser can still decode the original when demuxing is unavailable.
			return null;
		} finally {
			if (!event.sender.isDestroyed()) event.sender.removeListener("destroyed", cancel);
			if (tempPath) {
				releaseOwnedExportPath(tempPath);
				await removeExportStreamTemp(tempPath).catch(() => undefined);
			}
			finish();
		}
	});
	handleTrustedIpc("get-export-disk-space", async (_event, outputPath: string) => {
		const freeBytes = async (directory: string) => {
			try {
				const { bavail, bsize } = await fs.statfs(directory);
				return bavail * bsize;
			} catch {
				return null;
			}
		};
		const [targetFreeBytes, tempFreeBytes] = await Promise.all([
			freeBytes(path.dirname(outputPath)),
			freeBytes(app.getPath("temp")),
		]);
		return { targetFreeBytes, tempFreeBytes };
	});
	handleTrustedIpc("capture-export-preview", async ({ sender }, rect: unknown) => {
		if (process.platform !== "win32" || new URL(sender.getURL()).searchParams.get("windowType") !== "editor" ||
			!rect || typeof rect !== "object") return null;
		const window = BrowserWindow.fromWebContents(sender);
		if (!window?.isVisible()) return null;
		const { x, y, width, height } = rect as Record<string, unknown>;
		if (typeof x !== "number" || typeof y !== "number" || typeof width !== "number" || typeof height !== "number" ||
			![x, y, width, height].every(Number.isFinite) || x < 0 || y < 0 || width <= 0 || height <= 0) return null;
		const zoom = sender.getZoomFactor();
		const content = window.getContentBounds();
		const left = Math.ceil(x * zoom);
		const top = Math.ceil(y * zoom);
		const right = Math.min(content.width, Math.floor((x + width) * zoom));
		const bottom = Math.min(content.height, Math.floor((y + height) * zoom));
		if (right <= left || bottom <= top || (right - left) * (bottom - top) > 1920 * 1080) return null;
		try {
			const image = await sender.capturePage({ x: left, y: top, width: right - left, height: bottom - top }, { stayHidden: true });
			return image.isEmpty() ? null : image.toDataURL();
		} catch {
			return null;
		}
	});
	handleTrustedIpc("choose-export-path", async (event, fileName: string) => {
		try {
			const isGif = String(fileName).toLowerCase().endsWith(".gif");
			const options: SaveDialogOptions = {
				title: isGif ? uiText("saveExportedGIF") : uiText("saveExportedVideo"),
				defaultPath: await resolveDefaultExportPath(fileName),
				filters: [{ name: isGif ? uiText("gifImage") : uiText("mp4Video"), extensions: [isGif ? "gif" : "mp4"] }],
				properties: ["createDirectory", "showOverwriteConfirmation"],
			};
			const parent = BrowserWindow.fromWebContents(event.sender);
			const result = parent ? await dialog.showSaveDialog(parent, options) : await dialog.showSaveDialog(options);
			if (result.canceled || !result.filePath) return { success: false, canceled: true };
			selectedExportDestinations.set(event.sender, { path: path.resolve(result.filePath), generation: exportGeneration });
			rememberExportDirectory(result.filePath);
			approveUserPath(result.filePath);
			return { success: true, path: result.filePath };
		} catch (error) { return { success: false, error: String(error) }; }
	});
	handleTrustedIpc(
		"native-video-export-start",
		async (
			event,
			options: {
				width: number;
				height: number;
				frameRate: number;
				bitrate: number;
				encodingMode: NativeExportEncodingMode;
				inputMode?: "rawvideo" | "h264-stream" | "mp4-stream";
			videoOnlyIntermediate?: boolean;
			mixedAudio?: NativeH264StreamAudioOptions;
			sourceAudio?: NativeH264StreamSourceAudioOptions;
			destinationPath?: string;
			},
		) => {
			const generation = exportGeneration;
			let reservedOutputPath: string | undefined;
			try {
				if (options.width % 2 !== 0 || options.height % 2 !== 0) {
					throw new Error("Native export requires even output dimensions");
				}

				const ffmpegPath = getFfmpegBinaryPath();
				const inputMode = options.inputMode ?? "rawvideo";
				if (inputMode !== "rawvideo" && inputMode !== "h264-stream" && inputMode !== "mp4-stream") {
					throw new Error("Invalid native export input mode");
				}
				const fragmentedMp4 = inputMode === "mp4-stream";
				const encodedVideo = inputMode !== "rawvideo";
				const supportsStreamingAudio = process.platform === "win32" || process.platform === "linux";
				const mixedAudio = encodedVideo && supportsStreamingAudio && options.mixedAudio
					? getNativeH264StreamAudioMuxOptions(options.mixedAudio)
					: undefined;
				const sourceAudio = encodedVideo && supportsStreamingAudio && !mixedAudio
					? options.sourceAudio : undefined;
				const sourceAudioMux = sourceAudio ? getNativeH264StreamAudioMuxOptions(sourceAudio) : undefined;
				const sourceAudioOptions = sourceAudio?.audioOptions;
				const canMuxSource = sourceAudioOptions?.audioMode === "copy-source" ||
					sourceAudioOptions?.audioMode === "trim-source" ||
					(sourceAudioOptions?.audioMode === "edited-track" && sourceAudioOptions.editedTrackStrategy === "filtergraph-fast-path");
				const sourceAudioPath = sourceAudioMux && canMuxSource && typeof sourceAudioOptions?.audioSourcePath === "string"
					? await resolveApprovedLocalMediaPath(sourceAudioOptions.audioSourcePath) : null;
				if (fragmentedMp4 && !mixedAudio && !sourceAudioPath) {
					throw new Error("Streaming MP4 export requires a valid audio input");
				}
				const sessionId = `leadcut-export-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
				let outputPath = path.join(app.getPath("temp"), `${sessionId}.mp4`);
				const selectedDestination = getSelectedExportDestination(event.sender, options.destinationPath, generation);
				if (selectedDestination) {
					const candidate = path.join(path.dirname(selectedDestination), `.${sessionId}.mp4`);
					try {
						const handle = await fs.open(candidate, "wx");
						reservedOutputPath = candidate;
						await handle.close();
						outputPath = candidate;
					} catch (error) {
						await removeTemporaryExportFile(reservedOutputPath);
						reservedOutputPath = undefined;
						if (isExportStorageFull(error)) throw error;
					}
				}

				let encoderName: string;
				let ffmpegArgs: string[];

				if (encodedVideo) {
					// Copy the encoded video without transcoding it.
					encoderName = "h264-stream-copy";
					ffmpegArgs = sourceAudioMux && sourceAudioPath
						? buildNativeVideoAudioMuxArgs(
							"pipe:0", sourceAudioPath, outputPath,
							{ ...sourceAudioOptions, outputDurationSec: sourceAudioMux.durationSec },
							{ videoInputFrameRate: options.frameRate, fragmentedMp4Input: fragmentedMp4, moovReservedBytes: sourceAudioMux.moovReservedBytes },
						)
						: buildNativeH264StreamExportArgs({
							frameRate: options.frameRate,
							outputPath,
							fragmentedMp4,
							videoOnlyIntermediate: options.videoOnlyIntermediate,
							mixedAudio,
						});
				} else {
					encoderName = await resolveNativeVideoEncoder(ffmpegPath, options.encodingMode);
					ffmpegArgs = buildNativeVideoExportArgs(encoderName, options, outputPath);
				}
				if (generation !== exportGeneration) throw new Error("Export renderer exited.");

				const ffmpegProcess = spawn(ffmpegPath, ffmpegArgs, {
					stdio: mixedAudio ? ["pipe", "ignore", "pipe", "pipe"] : ["pipe", "ignore", "pipe"],
				}) as ChildProcessByStdio<Writable, null, Readable>;
				const audioPipe = mixedAudio ? (ffmpegProcess.stdio as unknown[])[3] as Writable : undefined;
				audioPipe?.on("error", () => {
					// The write callback and subprocess close status carry the failure.
				});
				logSubprocessStderr(ffmpegProcess, "export-ffmpeg");
				// Encoded video arrives in variable-sized chunks.
				const inputByteSize =
					inputMode === "rawvideo"
						? getNativeVideoInputByteSize(options.width, options.height)
						: 0;

				const session: NativeVideoExportSession = {
					ffmpegProcess,
					audioPipe,
					audioMuxedInStream: Boolean(mixedAudio || sourceAudioPath),
					outputPath,
					stagedBesideDestination: Boolean(reservedOutputPath),
					inputByteSize,
					inputMode,
					maxQueuedWriteBytes:
						encodedVideo
							? 32 * 1024 * 1024
							: getNativeVideoExportMaxQueuedWriteBytes(inputByteSize),
					stderrOutput: "",
					encoderName,
					processError: null,
					stdinError: null,
					terminating: false,
					writeSequence: Promise.resolve(),
					sender: event.sender,
					pendingWriteRequestIds: new Set<number>(),
					completionPromise: new Promise<void>((resolve, reject) => {
						ffmpegProcess.once("error", (error) => {
							const processError =
								error instanceof Error ? error : new Error(String(error));
							if (session.terminating) {
								resolve();
								return;
							}

							session.processError = processError;
							reject(processError);
						});
						ffmpegProcess.stdin.once("error", (error) => {
							const stdinError =
								error instanceof Error ? error : new Error(String(error));
							if (
								session.terminating &&
								isIgnorableNativeVideoExportStreamError(stdinError)
							) {
								return;
							}

							session.stdinError = stdinError;
						});
						ffmpegProcess.once("close", (code, signal) => {
							if (session.terminating) {
								resolve();
								return;
							}

							if (code === 0) {
								resolve();
								return;
							}

							reject(
								new Error(
									getNativeVideoExportSessionError(
										session,
										`FFmpeg exited with code ${code ?? "unknown"}${signal ? ` (signal ${signal})` : ""}`,
									),
								),
							);
						});
					}),
				};
				void session.completionPromise.catch(() => undefined);

				ffmpegProcess.stderr.on("data", (chunk: Buffer) => {
					session.stderrOutput += chunk.toString();
				});

				nativeVideoExportSessions.set(sessionId, session);

				console.log(
					`[native-export] Started ${isHardwareAcceleratedVideoEncoder(encoderName) ? "hardware" : "software"} session ${sessionId} with ${encoderName}`,
				);

				return {
					success: true,
					sessionId,
					encoderName,
					mixedAudio: Boolean(audioPipe),
				};
			} catch (error) {
				await removeTemporaryExportFile(reservedOutputPath);
				console.error(
					"[native-export] Failed to start native video export session:",
					error,
				);
				return {
					success: false,
					error: String(error),
				};
			}
		},
	);

	handleTrustedIpc("native-video-export-write-wav", async ({ sender }, sessionId: string, chunk: Uint8Array | null) => {
		const session = nativeVideoExportSessions.get(sessionId);
		const pipe = session?.audioPipe;
		if (!session || !pipe || session.sender !== sender || session.terminating) {
			return { success: false, error: "Native audio stream is no longer active" };
		}
		if (chunk !== null && (!(chunk instanceof Uint8Array) || chunk.byteLength > 2 * 1024 * 1024)) {
			return { success: false, error: "Invalid native audio stream chunk" };
		}

		try {
			await new Promise<void>((resolve, reject) => {
				const done = (error?: Error | null) => error ? reject(error) : resolve();
				if (chunk === null) {
					pipe.end(done);
				} else {
					pipe.write(Buffer.from(chunk.buffer, chunk.byteOffset, chunk.byteLength), done);
				}
			});
			return { success: true };
		} catch (error) {
			if (!session.terminating && error instanceof Error && isIgnorableNativeVideoExportStreamError(error)) {
				try {
					// FFmpeg can close the audio stream after reaching the requested duration.
					await session.completionPromise;
					return { success: true };
				} catch (processError) {
					return { success: false, error: String(processError) };
				}
			}
			return { success: false, error: String(error) };
		}
	});

	handleTrustedIpc("native-video-export-end-video-input", ({ sender }, sessionId: string) => {
		const session = nativeVideoExportSessions.get(sessionId);
		if (!session?.audioPipe || session.sender !== sender || session.terminating) {
			return { success: false, error: "Native mixed export is no longer active" };
		}
		const input = session.ffmpegProcess.stdin;
		if (!input.destroyed && !input.writableEnded) input.end();
		return { success: true };
	});

	handleTrustedIpc("probe-native-video-metadata", async (_, filePath: string) => {
		try {
			if (typeof filePath !== "string" || filePath.trim().length === 0) {
				throw new Error("Native metadata probe requires a file path");
			}

			const resolvedFilePath = await resolveAllowedReadableFilePath(
				filePath,
				"Native metadata probe",
			);
			const metadata = await probeNativeVideoMetadata(
				getFfmpegBinaryPath(),
				resolvedFilePath,
			);
			return {
				success: true,
				metadata,
			};
		} catch (error) {
			console.warn("[probe-native-video-metadata] Failed:", error);
			return {
				success: false,
				error: error instanceof Error ? error.message : String(error),
			};
		}
	});

	handleTrustedIpc("get-native-export-capabilities", async () => {
		try {
			return {
				success: true,
				capabilities: await getNativeExportCapabilities(),
			};
		} catch (error) {
			console.warn("[native-export-capabilities] Failed:", error);
			return {
				success: false,
				error: error instanceof Error ? error.message : String(error),
			};
		}
	});

	handleTrustedIpc("get-export-hardware-info", async () => {
		try {
			return {
				success: true,
				hardware: await getExportHardwareInfo(),
			};
		} catch (error) {
			console.warn("[export-hardware-info] Failed:", error);
			return {
				success: false,
				error: error instanceof Error ? error.message : String(error),
			};
		}
	});

	handleTrustedIpc(
		"native-static-layout-export",
		async (event, options: NativeStaticLayoutExportOptions) => {
			const generation = exportGeneration;
			try {
				if (!options || typeof options.inputPath !== "string") {
					throw new Error("Native static layout export requires an input path");
				}
				const sanitizedOptions = await sanitizeNativeStaticLayoutExportOptions(options);
				if (generation !== exportGeneration) throw new Error("Export renderer exited.");

				const result = await exportNativeStaticLayoutVideo(
					getFfmpegBinaryPath(),
					sanitizedOptions,
					(progress) => {
						if (event.sender.isDestroyed()) {
							return;
						}

						event.sender.send("native-static-layout-export-progress", progress);
					},
				);
				await registerRendererExportPath(result.outputPath, generation);
				const primaryBackend = result.metrics.chunks[0]?.backend;
				return {
					success: true,
					tempPath: result.outputPath,
					encoderName:
						primaryBackend === "nvidia-cuda-compositor"
							? "nvidia-cuda-compositor"
							: primaryBackend === "windows-d3d11-compositor"
								? "windows-d3d11-compositor"
								: result.metrics.chunkCount > 1
									? "chunked-h264-nvenc"
									: "static-layout-h264-nvenc",
					metrics: result.metrics,
				};
			} catch (error) {
				console.warn("[native-static-layout-export] Failed:", error);
				return {
					success: false,
					error: error instanceof Error ? error.message : String(error),
				};
			}
		},
	);

	handleTrustedIpc("native-static-layout-export-cancel", async (_, sessionId: string) => {
		const session = nativeStaticLayoutExportSessions.get(sessionId);
		if (!session) {
			return { success: true };
		}

		session.terminating = true;
		await stopProcessTree(session.currentProcess);

		return { success: true };
	});

	onTrustedIpc(
		"native-video-export-write-frames-async",
		(
			event,
			payload: {
				sessionId: string;
				requestId: number;
				frameDataList: Uint8Array[];
			},
		) => {
			const sessionId = payload?.sessionId;
			const requestId = payload?.requestId;
			const frameDataList = payload?.frameDataList;

			if (
				typeof sessionId !== "string" ||
				typeof requestId !== "number" ||
				!Array.isArray(frameDataList) ||
				frameDataList.length === 0
			) {
				return;
			}

			const session = nativeVideoExportSessions.get(sessionId);
			if (!session) {
				sendNativeVideoExportWriteFrameResult(event.sender, sessionId, requestId, {
					success: false,
					error: "Invalid native export session",
				});
				return;
			}

			session.sender = event.sender;
			session.pendingWriteRequestIds.add(requestId);

			if (session.terminating) {
				settleNativeVideoExportWriteFrameRequest(sessionId, session, requestId, {
					success: false,
					error: "Native video export session was cancelled",
				});
				return;
			}

			if (
			session.inputMode === "rawvideo" &&
				frameDataList.some((frameData) => frameData.byteLength !== session.inputByteSize)
			) {
				settleNativeVideoExportWriteFrameRequest(sessionId, session, requestId, {
					success: false,
					error: "Native video export batch contained invalid frame sizes",
				});
				return;
			}

			void enqueueNativeVideoExportFrameWrites(session, frameDataList)
				.then(() => {
					settleNativeVideoExportWriteFrameRequest(sessionId, session, requestId, {
						success: true,
					});
				})
				.catch((error) => {
					session.stdinError = error instanceof Error ? error : new Error(String(error));
					settleNativeVideoExportWriteFrameRequest(sessionId, session, requestId, {
						success: false,
						error: getNativeVideoExportSessionError(
							session,
							session.stdinError.message,
						),
					});
				});
		},
	);

	onTrustedIpc(
		"native-video-export-write-frame-async",
		(
			event,
			payload: {
				sessionId: string;
				requestId: number;
				frameData: Uint8Array;
			},
		) => {
			const sessionId = payload?.sessionId;
			const requestId = payload?.requestId;
			const frameData = payload?.frameData;

			if (typeof sessionId !== "string" || typeof requestId !== "number" || !frameData) {
				return;
			}

			const session = nativeVideoExportSessions.get(sessionId);
			if (!session) {
				sendNativeVideoExportWriteFrameResult(event.sender, sessionId, requestId, {
					success: false,
					error: "Invalid native export session",
				});
				return;
			}

			session.sender = event.sender;
			session.pendingWriteRequestIds.add(requestId);

			if (session.terminating) {
				settleNativeVideoExportWriteFrameRequest(sessionId, session, requestId, {
					success: false,
					error: "Native video export session was cancelled",
				});
				return;
			}

			if (
			session.inputMode === "rawvideo" &&
				frameData.byteLength !== session.inputByteSize
			) {
				settleNativeVideoExportWriteFrameRequest(sessionId, session, requestId, {
					success: false,
					error: `Native video export expected ${session.inputByteSize} bytes per frame but received ${frameData.byteLength}`,
				});
				return;
			}

			void enqueueNativeVideoExportFrameWrite(session, frameData)
				.then(() => {
					settleNativeVideoExportWriteFrameRequest(sessionId, session, requestId, {
						success: true,
					});
				})
				.catch((error) => {
					session.stdinError = error instanceof Error ? error : new Error(String(error));
					settleNativeVideoExportWriteFrameRequest(sessionId, session, requestId, {
						success: false,
						error: getNativeVideoExportSessionError(
							session,
							session.stdinError.message,
						),
					});
				});
		},
	);

	handleTrustedIpc(
		"native-video-export-finish",
		async (_, sessionId: string, options?: NativeVideoExportFinishOptions) => {
			const generation = exportGeneration;
			const session = nativeVideoExportSessions.get(sessionId);
			if (!session) {
				return { success: false, error: "Invalid native export session" };
			}
			if (session.finalization) return { success: false, error: "Native export session is already finalizing" };
			const finalization = beginExportPreparation();
			session.finalization = finalization;

			try {
				await session.writeSequence;
				if (
					!session.ffmpegProcess.stdin.destroyed &&
					!session.ffmpegProcess.stdin.writableEnded
				) {
					session.ffmpegProcess.stdin.end();
				}
				await session.completionPromise;
				if (session.terminating) throw new Error("Export renderer exited.");

				const finalized = await muxNativeVideoExportAudio(
					session.outputPath,
					session.audioMuxedInStream ? { audioMode: "none" } : options ?? {},
					undefined, undefined, finalization.controller.signal,
				);
				finalization.controller.signal.throwIfAborted();
				nativeVideoExportSessions.delete(sessionId);
				// Register the finalized path so only app-produced paths can flow back
				// through finalize-exported-video / discard-exported-temp.
				await registerRendererExportPath(finalized.outputPath, generation, session.stagedBesideDestination);
				if (finalized.outputPath !== session.outputPath) {
					// muxNativeVideoExportAudio removes the intermediate on success, but
					// clear our registry entry defensively in case a future refactor
					// changes that contract.
					releaseOwnedExportPath(session.outputPath);
				}

				// Return a temp path instead of reading the file back into memory so we
				// never hit V8's per-ArrayBuffer limit on >2 GiB exports. The renderer
				// uses finalize-exported-video to move the file to its final path.
				return {
					success: true,
					tempPath: finalized.outputPath,
					encoderName: session.encoderName,
					metrics: finalized.metrics,
				};
			} catch (error) {
				flushNativeVideoExportPendingWriteRequests(sessionId, session, String(error));
				nativeVideoExportSessions.delete(sessionId);
				await removeTemporaryExportFile(session.outputPath);
				const finalizedSuffix = session.outputPath.replace(/\.mp4$/, "-final.mp4");
				await removeTemporaryExportFile(finalizedSuffix);
				return {
					success: false,
					error: String(error),
				};
			} finally {
				finalization.finish();
			}
		},
	);

	handleTrustedIpc(
		"mux-exported-video-audio-from-path",
		async ({ sender }, videoPath: string, options?: NativeVideoExportFinishOptions) => {
			const generation = exportGeneration;
			if (typeof videoPath !== "string" || !isOwnedExportPath(videoPath)) {
				return {
					success: false,
					error: "Video path is not an app-managed export temp",
				};
			}
			const preparation = beginAudioPreparation(sender);
			if (!preparation) return { success: false, error: "Audio export is already active" };
			const stagedBesideDestination = isDestinationStagedExportPath(videoPath);
			let outputPath: string | undefined;
			try {
				const finalized = await muxNativeVideoExportAudio(videoPath, options ?? {}, undefined, undefined, preparation.signal);
				outputPath = finalized.outputPath;
				preparation.signal.throwIfAborted();
				if (finalized.outputPath !== videoPath) {
					await registerRendererExportPath(finalized.outputPath, generation, stagedBesideDestination);
					// muxNativeVideoExportAudio removes the intermediate on success, so
					// the input is no longer owned by the registry after the call
					// returns.
					releaseOwnedExportPath(videoPath);
				}
				return {
					success: true,
					tempPath: finalized.outputPath,
					metrics: finalized.metrics,
				};
			} catch (error) {
				if (outputPath && outputPath !== videoPath) await removeExportStreamTemp(outputPath).catch(() => undefined);
				// Only clean up the input path if it is still an owned temp (i.e.
				// muxNativeVideoExportAudio failed before consuming it).
				if (isOwnedExportPath(videoPath)) {
					await removeExportStreamTemp(videoPath).catch(() => undefined);
					releaseOwnedExportPath(videoPath);
				}
				return { success: false, error: String(error) };
			} finally {
				preparation.finish();
			}
		},
	);

	handleTrustedIpc(
		"mux-exported-video-audio",
		async ({ sender }, videoData: ArrayBuffer, options?: NativeVideoExportFinishOptions) => {
			const generation = exportGeneration;
			const preparation = beginAudioPreparation(sender);
			if (!preparation) return { success: false, error: "Audio export is already active" };
			let outputPath: string | undefined;
			try {
				const sizeError = getInMemoryExportTooLargeMessage(videoData.byteLength);
				if (sizeError) {
					return {
						success: false,
						error: sizeError,
					};
				}

				const result = await muxExportedVideoAudioBuffer(videoData, options ?? {}, preparation.signal);
				outputPath = result.outputPath;
				preparation.signal.throwIfAborted();
				// Register the muxed output so finalize-exported-video / discard-
				// exported-temp accept it. Returning a temp path (instead of the
				// muxed bytes) keeps us off Node's >2 GiB fs.readFile cap and
				// avoids a redundant copy through the renderer.
				await registerRendererExportPath(result.outputPath, generation);
				return {
					success: true,
					tempPath: result.outputPath,
					metrics: result.metrics,
				};
			} catch (error) {
				await removeTemporaryExportFile(outputPath);
				return {
					success: false,
					error: String(error),
				};
			} finally {
				preparation.finish();
			}
		},
	);

	handleTrustedIpc("export-stream-open", async ({ sender }, options?: ExportStreamOptions) => {
		const generation = exportGeneration;
		try {
			const destination = options?.extension === "mp4" && !options.mode
				? getSelectedExportDestination(sender, options.destinationPath, generation) : undefined;
			const staged = destination && await openExportStream(options, path.dirname(destination)).catch(error => {
				if (isExportStorageFull(error)) throw error;
				return undefined;
			});
			const result = staged || await openExportStream(options);
			if (generation !== exportGeneration) {
				await closeExportStream(result.streamId, { abort: true });
				return { success: false, error: "Export renderer exited." };
			}
			return { success: true, streamId: result.streamId, tempPath: result.tempPath };
		} catch (error) {
			return { success: false, error: String(error) };
		}
	});

	handleTrustedIpc(
		"export-stream-write",
		async (_event, streamId: string, position: number, chunk: Uint8Array) => {
			try {
				await writeToExportStream(streamId, position, chunk);
				return { success: true };
			} catch (error) {
				return { success: false, error: String(error) };
			}
		},
	);

	handleTrustedIpc(
		"export-stream-close",
		async (_event, streamId: string, options?: { abort?: boolean }) => {
			try {
				const result = await closeExportStream(streamId, options);
				return {
					success: true,
					tempPath: result.tempPath,
					bytesWritten: result.bytesWritten,
				};
			} catch (error) {
				return { success: false, error: String(error) };
			}
		},
	);

	handleTrustedIpc("native-video-export-cancel", async (_, sessionId: string) => {
		const session = nativeVideoExportSessions.get(sessionId);
		if (!session) {
			return { success: true };
		}

		session.terminating = true;
		session.finalization?.controller.abort();
		nativeVideoExportSessions.delete(sessionId);
		flushNativeVideoExportPendingWriteRequests(
			sessionId,
			session,
			"Native video export session was cancelled",
		);

		try {
			if (
				!session.ffmpegProcess.stdin.destroyed &&
				!session.ffmpegProcess.stdin.writableEnded
			) {
				session.ffmpegProcess.stdin.destroy();
			}
			session.audioPipe?.destroy();
		} catch {
			// Stream may already be closed.
		}

		try {
			session.ffmpegProcess.kill("SIGKILL");
		} catch {
			// Process may already be closed.
		}

		await Promise.allSettled([session.completionPromise, session.finalization?.finished]);
		await removeTemporaryExportFile(session.outputPath);
		return { success: true };
	});

	handleTrustedIpc(
		"save-exported-video",
		async (
			event,
			videoData: ArrayBuffer,
			fileName: string,
			captionSidecar?: CaptionSidecarPayload,
		) => {
			try {
				const sidecarPayload = parseCaptionSidecarPayload(captionSidecar);
				const sizeError = getInMemoryExportTooLargeMessage(videoData.byteLength);
				if (sizeError) {
					return {
						success: false,
						message: sizeError,
						error: sizeError,
					};
				}

				// Determine file type from extension
				const isGif = fileName.toLowerCase().endsWith(".gif");
				const filters = isGif
					? [{ name: uiText("gifImage"), extensions: ["gif"] }]
					: [{ name: uiText("mp4Video"), extensions: ["mp4"] }];
				const parentWindow = BrowserWindow.fromWebContents(event.sender);
				const saveDialogOptions: SaveDialogOptions = {
					title: isGif ? uiText("saveExportedGIF") : uiText("saveExportedVideo"),
					defaultPath: await resolveDefaultExportPath(fileName),
					filters,
					properties: ["createDirectory", "showOverwriteConfirmation"],
				};

				const result = parentWindow
					? await dialog.showSaveDialog(parentWindow, saveDialogOptions)
					: await dialog.showSaveDialog(saveDialogOptions);

				if (result.canceled || !result.filePath) {
					return {
						success: false,
						canceled: true,
						message: uiText("exportCanceled"),
					};
				}

				rememberExportDirectory(result.filePath);
				await fs.writeFile(result.filePath, Buffer.from(videoData));
				const captionSidecarResult = await writeCaptionSidecarsBestEffort(
					result.filePath,
					sidecarPayload,
				);
				approveUserPath(result.filePath);

				return {
					success: true,
					path: result.filePath,
					message: withCaptionSidecarMessage(
						uiText("videoExportedSuccessfully"),
						captionSidecarResult,
					),
				};
			} catch (error) {
				console.error("Failed to save exported video:", error);
				return {
					success: false,
					message: uiText(getExportStorageErrorKey(error) ?? "failedToSaveExportedVideo"),
					error: String(error),
				};
			}
		},
	);

	handleTrustedIpc(
		"write-exported-video-to-path",
		async (
			_event,
			videoData: ArrayBuffer,
			outputPath: string,
			captionSidecar?: CaptionSidecarPayload,
		) => {
			try {
				const sidecarPayload = parseCaptionSidecarPayload(captionSidecar);
				const sizeError = getInMemoryExportTooLargeMessage(videoData.byteLength);
				if (sizeError) {
					return {
						success: false,
						message: sizeError,
						canceled: false,
						error: sizeError,
					};
				}

				const resolvedPath = path.resolve(outputPath);
				await fs.mkdir(path.dirname(resolvedPath), { recursive: true });
				await fs.writeFile(resolvedPath, Buffer.from(videoData));
				const captionSidecarResult = await writeCaptionSidecarsBestEffort(
					resolvedPath,
					sidecarPayload,
				);
				approveUserPath(resolvedPath);

				return {
					success: true,
					path: resolvedPath,
					message: withCaptionSidecarMessage(
						uiText("videoExportedSuccessfully"),
						captionSidecarResult,
					),
					canceled: false,
				};
			} catch (error) {
				console.error("Failed to write exported video to path:", error);
				return {
					success: false,
					message: uiText(getExportStorageErrorKey(error) ?? "failedToWriteExportedVideo"),
					canceled: false,
					error: String(error),
				};
			}
		},
	);

	handleTrustedIpc(
		"finalize-exported-video",
		async (
			event,
			payload: {
				tempPath: string;
				fileName: string;
				outputPath?: string | null;
				captionSidecar?: CaptionSidecarPayload;
			},
		) => {
			const tempPath = payload?.tempPath;
			const fileName = payload?.fileName;
			if (typeof tempPath !== "string" || typeof fileName !== "string") {
				return { success: false, error: "Invalid finalize-exported-video payload" };
			}

			if (!isTempPathSafe(tempPath) || !isOwnedExportPath(tempPath)) {
				return {
					success: false,
					error: "Temp path is not an app-managed export temp",
				};
			}

			try {
				await fs.access(tempPath);
			} catch {
				return {
					success: false,
					error: `Exported video temp file is missing: ${tempPath}`,
				};
			}

			try {
				const sidecarPayload = parseCaptionSidecarPayload(payload.captionSidecar);
				if (payload.outputPath) {
					const resolvedPath = path.resolve(payload.outputPath);
					await moveExportedTempFile(tempPath, resolvedPath);
					releaseOwnedExportPath(tempPath);
					const captionSidecarResult = await writeCaptionSidecarsBestEffort(
						resolvedPath,
						sidecarPayload,
					);
					approveUserPath(resolvedPath);
					return {
						success: true,
						path: resolvedPath,
						canceled: false,
						message: withCaptionSidecarMessage(
							uiText("videoExportedSuccessfully"),
							captionSidecarResult,
						),
					};
				}

				const isGif = fileName.toLowerCase().endsWith(".gif");
				const filters = isGif
					? [{ name: uiText("gifImage"), extensions: ["gif"] }]
					: [{ name: uiText("mp4Video"), extensions: ["mp4"] }];
				const parentWindow = BrowserWindow.fromWebContents(event.sender);
				const saveDialogOptions: SaveDialogOptions = {
					title: isGif ? uiText("saveExportedGIF") : uiText("saveExportedVideo"),
					defaultPath: await resolveDefaultExportPath(fileName),
					filters,
					properties: ["createDirectory", "showOverwriteConfirmation"],
				};

				const result = parentWindow
					? await dialog.showSaveDialog(parentWindow, saveDialogOptions)
					: await dialog.showSaveDialog(saveDialogOptions);

				if (result.canceled || !result.filePath) {
					// Leave the temp file in place so the renderer can offer "Save Again"
					// without re-rendering. The renderer owns cleanup on discard.
					return {
						success: false,
						canceled: true,
						message: uiText("exportCanceled"),
					};
				}

				rememberExportDirectory(result.filePath);
				await moveExportedTempFile(tempPath, result.filePath);
				releaseOwnedExportPath(tempPath);
				const captionSidecarResult = await writeCaptionSidecarsBestEffort(
					result.filePath,
					sidecarPayload,
				);
				approveUserPath(result.filePath);

				return {
					success: true,
					path: result.filePath,
					canceled: false,
					message: withCaptionSidecarMessage(
						uiText("videoExportedSuccessfully"),
						captionSidecarResult,
					),
				};
			} catch (error) {
				console.error("Failed to finalize exported video:", error);
				return {
					success: false,
					canceled: false,
					message: uiText(getExportStorageErrorKey(error) ?? "failedToSaveExportedVideo"),
					error: String(error),
				};
			}
		},
	);

	handleTrustedIpc("discard-exported-temp", async (_event, tempPath: string) => {
		if (typeof tempPath !== "string" || tempPath.length === 0) {
			return { success: false, error: "Invalid temp path" };
		}
		if (!isTempPathSafe(tempPath) || !isOwnedExportPath(tempPath)) {
			return {
				success: false,
				error: "Temp path is not an app-managed export temp",
			};
		}
		try {
			await removeExportStreamTemp(tempPath);
			releaseOwnedExportPath(tempPath);
			return { success: true };
		} catch (error) {
			return { success: false, error: String(error) };
		}
	});
}
