import { handleTrustedIpc } from "../../trustedIpc";
import { uiText } from "../../uiI18n";
import { logSubprocessStderr } from "../../logger";
import type { ChildProcessWithoutNullStreams } from "node:child_process";
import { execFile, spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import {
	app,
	BrowserWindow,
	desktopCapturer,
	dialog,
	shell,
	systemPreferences,
} from "electron";
import { getHudCaptureExcludedProcessIds } from "../../../src/lib/hudCaptureProtection";
import { getHudOverlayCaptureProtectionEnabled, beginHudCaptureProtection, getHudOverlayWindow } from "../../windows";
import { ALLOW_OWN_WINDOW_CAPTURE } from "../constants";
import { startWindowBoundsCapture, stopWindowBoundsCapture } from "../cursor/bounds";
import { startInteractionCapture, stopInteractionCapture } from "../cursor/interaction";
import { startNativeCursorMonitor, stopNativeCursorMonitor } from "../cursor/monitor";
import {
	finishCursorJournal,
	getCursorCaptureElapsedMs,
	isCursorCapturePaused,
	normalizeCursorTelemetrySamples,
	pauseCursorCaptureAtBoundary,
	resetCursorCaptureClock,
	resumeCursorCapture,
	sampleCursorPoint,
	snapshotCursorTelemetryForPersistence,
	startCursorSampling,
	stopCursorCapture,
	writeCursorTelemetry,
} from "../cursor/telemetry";
import { getFfmpegBinaryPath } from "../ffmpeg/binary";
import { getMonitorHandles } from "../monitorResolver";
import {
	ensureNativeCaptureHelperBinary,
	ensureSwiftHelperBinary,
	getNativeCaptureHelperBinaryPath,
	getSystemCursorHelperBinaryPath,
	getSystemCursorHelperSourcePath,
	getWindowsCaptureExePath,
} from "../paths/binaries";
import { rememberApprovedLocalReadPath, resolveApprovedLocalMediaPath } from "../project/manager";
import { prepareSeekableMedia } from "../project/seekableMedia";
import { shouldKeepRecordingAudioSidecars } from "../recording/audioFilters";
import { convertBrowserMicrophone, createBrowserMicrophoneStreams } from "../recording/browserMicrophone";
import {
	getCompanionAudioFallbackInfo,
	getFileSizeIfPresent,
	type MicrophoneChunkTimingEvent,
	type MicrophonePauseInterval,
	type RecordingDiagnosticsSnapshot,
	recordNativeCaptureDiagnostics,
	summarizeMicrophoneChunkTiming,
	validateRecordedVideo,
	writeRecordingDiagnosticsSnapshot,
} from "../recording/diagnostics";
import {
	RECORDING_DISK_CHECK_INTERVAL_MS,
	type RecordingDiskStatus,
	getRecordingDiskLevel,
} from "../recording/diskEstimate";
import {
	buildFfmpegCaptureArgs,
	waitForFfmpegCaptureStart,
	waitForFfmpegCaptureStop,
} from "../recording/ffmpeg";
import {
	discardInterruptedRecording,
	getInterruptedRecording,
	recoverInterruptedRecording,
} from "../recording/interruptedRecording";
import {
	attachNativeCaptureLifecycle,
	finalizeStoredVideo,
	muxNativeMacRecordingWithAudio,
	recoverNativeMacCaptureOutput,
	waitForNativeCaptureCommand,
	waitForNativeCaptureStart,
	waitForNativeCaptureStop,
} from "../recording/mac";
import {
	clearRecordingJournal,
	updateRecordingJournal,
	writeRecordingJournal,
} from "../recording/recoveryJournal";
import { resolveRecordedVideoStoragePath } from "../recording/storagePath";
import { addRecordingMarkerAndNotify } from "../recording/events";
import { getCurrentMarkerCount, isRecordingMarkerKind, readRecordingMarkers, resetRecordingMarkers } from "../recording/markers";
import { persistRecordingSidecars } from "../recording/sidecars";
import { createBrowserRecordingStreamStore, finalizeWebcamRecording, findBrowserRecordingPartial, recoverBrowserRecordingPartial } from "../recording/browserStream";
import { discardKeystrokes, readKeystrokes, releaseHeldKeystrokes, startKeystrokeCapture, trimKeystrokesAfter } from "../cursor/keystrokes";
import { appLog } from "../../logger";
import {
	attachWindowsCaptureLifecycle,
	isNativeWindowsCaptureAvailable,
	muxNativeWindowsVideoWithAudio,
	waitForWindowsCaptureStart,
	waitForWindowsCaptureStop,
} from "../recording/windows";
import { stageWindowsCaptureOutputs } from "../recording/windowsCaptureOutputs";
import {
	shouldStartWindowsBrowserMicrophoneFallback,
	shouldUseWindowsBrowserMicrophoneFallback,
} from "../recording/windowsFallbacks";
import {
	cachedSystemCursorAssets,
	cachedSystemCursorAssetsSourceMtimeMs,
	currentVideoPath,
	ffmpegCaptureOutputBuffer,
	ffmpegCaptureProcess,
	ffmpegCaptureTargetPath,
	ffmpegScreenRecordingActive,
	isCursorCaptureActive,
	lastNativeCaptureDiagnostics,
	nativeCaptureMicrophonePath,
	nativeCaptureOutputBuffer,
	nativeCapturePaused,
	nativeCaptureProcess,
	nativeCaptureSystemAudioPath,
	nativeCaptureTargetPath,
	nativeScreenRecordingActive,
	selectedSource,
	setActiveCursorSamples,
	setCachedSystemCursorAssets,
	setCachedSystemCursorAssetsSourceMtimeMs,
	setCursorCaptureStartTimeMs,
	setFfmpegCaptureOutputBuffer,
	setFfmpegCaptureProcess,
	setFfmpegCaptureTargetPath,
	setFfmpegScreenRecordingActive,
	setIsCursorCaptureActive,
	setLastLeftClick,
	setLinuxCursorScreenPoint,
	setNativeCaptureMicrophonePath,
	setNativeCaptureOutputBuffer,
	setNativeCapturePaused,
	setNativeCaptureProcess,
	setNativeCaptureStopRequested,
	setNativeCaptureSystemAudioPath,
	setNativeCaptureTargetPath,
	setNativeScreenRecordingActive,
	setPendingCursorSamples,
	setWindowsCaptureOutputBuffer,
	setWindowsCapturePaused,
	setWindowsCaptureProcess,
	setWindowsCaptureStopRequested,
	setWindowsCaptureTargetPath,
	setWindowsMicAudioPath,
	setWindowsNativeCaptureActive,
	setWindowsOrphanedMicAudioPath,
	setWindowsPendingVideoPath,
	setWindowsSystemAudioPath,
	windowsCaptureOutputBuffer,
	windowsCapturePaused,
	windowsCaptureProcess,
	windowsCaptureStopRequested,
	windowsCaptureTargetPath,
	windowsMicAudioPath,
	windowsNativeCaptureActive,
	windowsOrphanedMicAudioPath,
	windowsPendingVideoPath,
	windowsSystemAudioPath,
} from "../state";
import type { CursorTelemetryPoint, NativeMacRecordingOptions, NativeRecordingFinalization, SelectedSource } from "../types";
import {
	getMacPrivacySettingsUrl,
	getRecordingsDir,
	getScreen,
	getTelemetryPathForVideo,
	moveFileWithOverwrite,
	normalizeVideoSourcePath,
	parseJsonWithByteOrderMark,
	parseWindowId,
} from "../utils";
import { resolveWindowsCaptureTarget } from "../windowsCaptureSelection";
import { bringSelectedWindowForward } from "./sources";

const execFileAsync = promisify(execFile);

async function writeWindowsRecordingDiagnostics(
	videoPath: string | null | undefined,
	snapshot: Omit<RecordingDiagnosticsSnapshot, "backend">,
) {
	if (!videoPath) {
		return null;
	}

	try {
		return await writeRecordingDiagnosticsSnapshot(videoPath, {
			backend: "windows-wgc",
			...snapshot,
		});
	} catch (error) {
		console.warn("Failed to write Windows recording diagnostics:", error);
		return null;
	}
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function pickPrimitiveRecord(value: unknown) {
	if (!isRecord(value)) {
		return null;
	}

	const entries = Object.entries(value).filter(
		(entry): entry is [string, boolean | number | string] => {
			const primitive = entry[1];
			return (
				typeof primitive === "boolean" ||
				typeof primitive === "number" ||
				typeof primitive === "string"
			);
		},
	);

	return entries.length > 0 ? Object.fromEntries(entries) : null;
}

function normalizeRendererTimestampMs(value: unknown) {
	const nowMs = Date.now();
	if (typeof value !== "number" || !Number.isFinite(value)) {
		return nowMs;
	}

	return Math.min(Math.max(0, Math.round(value)), nowMs);
}

function pickMicrophoneChunkEvents(value: unknown): MicrophoneChunkTimingEvent[] | null {
	if (!Array.isArray(value)) {
		return null;
	}

	const events = value
		.map((event) => {
			if (!isRecord(event)) {
				return null;
			}

			const { index, size, elapsedMs, deltaMs, recordedElapsedMs, recordedDeltaMs } = event;
			if (
				typeof index !== "number" ||
				!Number.isFinite(index) ||
				index < 0 ||
				typeof size !== "number" ||
				!Number.isFinite(size) ||
				size < 0 ||
				typeof elapsedMs !== "number" ||
				!Number.isFinite(elapsedMs) ||
				elapsedMs < 0
			) {
				return null;
			}

			return {
				index: Math.round(index),
				size: Math.round(size),
				elapsedMs: Math.round(elapsedMs),
				deltaMs:
					typeof deltaMs === "number" && Number.isFinite(deltaMs)
						? Math.max(0, Math.round(deltaMs))
						: null,
				...(typeof recordedElapsedMs === "number" &&
				Number.isFinite(recordedElapsedMs) &&
				recordedElapsedMs >= 0
					? { recordedElapsedMs: Math.round(recordedElapsedMs) }
					: {}),
				recordedDeltaMs:
					typeof recordedDeltaMs === "number" && Number.isFinite(recordedDeltaMs)
						? Math.max(0, Math.round(recordedDeltaMs))
						: null,
			};
		})
		.filter((event): event is NonNullable<typeof event> => event !== null);

	return events.length > 0 ? events : null;
}

function pickMicrophonePauseIntervals(value: unknown): MicrophonePauseInterval[] | null {
	if (!Array.isArray(value)) {
		return null;
	}

	const intervals = value
		.map((interval) => {
			if (
				!isRecord(interval) ||
				typeof interval.startElapsedMs !== "number" ||
				!Number.isFinite(interval.startElapsedMs) ||
				interval.startElapsedMs < 0
			) {
				return null;
			}

			const startElapsedMs = Math.max(0, Math.round(interval.startElapsedMs));
			return {
				startElapsedMs,
				...(typeof interval.endElapsedMs === "number" &&
				Number.isFinite(interval.endElapsedMs) &&
				interval.endElapsedMs >= startElapsedMs
					? { endElapsedMs: Math.round(interval.endElapsedMs) }
					: {}),
				...(typeof interval.durationMs === "number" &&
				Number.isFinite(interval.durationMs) &&
				interval.durationMs >= 0
					? { durationMs: Math.round(interval.durationMs) }
					: {}),
			};
		})
		.filter((interval): interval is NonNullable<typeof interval> => interval !== null);

	return intervals.length > 0 ? intervals : null;
}

function pickAudioInputDevices(value: unknown) {
	if (!Array.isArray(value)) {
		return null;
	}

	const devices = value
		.map((device) => {
			if (!isRecord(device) || typeof device.deviceId !== "string") {
				return null;
			}

			return {
				deviceId: device.deviceId,
				...(typeof device.groupId === "string" ? { groupId: device.groupId } : {}),
				label: typeof device.label === "string" ? device.label : "",
			};
		})
		.filter((device): device is NonNullable<typeof device> => device !== null);

	return devices.length > 0 ? devices : null;
}

async function getSystemCursorAssets() {
	if (process.platform !== "darwin") {
		setCachedSystemCursorAssets({});
		setCachedSystemCursorAssetsSourceMtimeMs(null);
		return cachedSystemCursorAssets ?? {};
	}
	const sourcePath = getSystemCursorHelperSourcePath();
	const sourceStat = await fs.stat(sourcePath);
	if (cachedSystemCursorAssets && cachedSystemCursorAssetsSourceMtimeMs === sourceStat.mtimeMs) {
		return cachedSystemCursorAssets;
	}
	const binaryPath = await ensureSwiftHelperBinary(
		sourcePath,
		getSystemCursorHelperBinaryPath(),
		"system cursor helper",
		"leadcut-system-cursors",
	);
	const { stdout } = await execFileAsync(binaryPath, [], {
		timeout: 15000,
		maxBuffer: 20 * 1024 * 1024,
	});
	const parsed = JSON.parse(stdout) as Record<
		string,
		Partial<import("../types").SystemCursorAsset>
	>;
	const result = Object.fromEntries(
		Object.entries(parsed).filter(
			([, asset]) =>
				typeof asset?.dataUrl === "string" &&
				typeof asset?.hotspotX === "number" &&
				typeof asset?.hotspotY === "number" &&
				typeof asset?.width === "number" &&
				typeof asset?.height === "number",
		),
	) as Record<string, import("../types").SystemCursorAsset>;
	setCachedSystemCursorAssets(result);
	setCachedSystemCursorAssetsSourceMtimeMs(sourceStat.mtimeMs);
	return result;
}

function normalizeDesktopSourceName(value: string) {
	return value.trim().replace(/\s+/g, " ").toLowerCase();
}

async function cleanupWindowsOrphanedMicAudioPath(filePath: string | null) {
	if (!filePath) {
		return;
	}

	if (shouldKeepRecordingAudioSidecars()) {
		console.log(`[recording] Keeping orphaned native mic sidecar for diagnostics: ${filePath}`);
		return;
	}

	await fs.rm(filePath, { force: true }).catch(() => undefined);
}

async function pathExists(filePath: string | null | undefined) {
	if (!filePath) {
		return false;
	}

	try {
		await fs.access(filePath);
		return true;
	} catch {
		return false;
	}
}

async function resolveExistingPath(...candidates: Array<string | null | undefined>) {
	for (const candidate of candidates) {
		if (await pathExists(candidate)) {
			return candidate ?? null;
		}
	}

	return null;
}

async function getRecordingDiskStatus(): Promise<RecordingDiskStatus> {
	const targetPath = windowsCaptureTargetPath ?? nativeCaptureTargetPath ?? ffmpegCaptureTargetPath;
	const recordingDirectory = targetPath ? path.dirname(targetPath) : await getRecordingsDir();
	const volumes = await Promise.all([fs.statfs(recordingDirectory), fs.statfs(app.getPath("temp"))]);
	const freeBytes = Math.min(...volumes.map((volume) => volume.bavail * volume.bsize));
	return { freeBytes, level: getRecordingDiskLevel(freeBytes) };
}

export function registerRecordingHandlers(
	onRecordingStateChange?: (recording: boolean, sourceName: string) => void,
) {
	let activeRecoveryStartedAt: number | null = null;
	const browserMicrophones = createBrowserMicrophoneStreams();
	const microphoneOwners = new Set<number>();
	let diskCheckTimer: ReturnType<typeof setInterval> | null = null;
	const stopDiskChecks = () => {
		if (diskCheckTimer) clearInterval(diskCheckTimer);
		diskCheckTimer = null;
	};
	const startDiskChecks = () => {
		stopDiskChecks();
		let checking = false;
		let lastLevel: RecordingDiskStatus["level"] = "ok";
		const timer = setInterval(async () => {
			if (checking) return;
			checking = true;
			try {
				const status = await getRecordingDiskStatus();
				if (diskCheckTimer !== timer || status.level === lastLevel) return;
				const hud = getHudOverlayWindow();
				if (!hud) return;
				lastLevel = status.level;
				hud.webContents.send("recording-disk-low", status);
				if (status.level === "stop") {
					stopDiskChecks();
					hud.webContents.send("stop-recording-from-tray");
				}
			} catch (error) {
				console.warn("Could not check recording disk space:", error);
			} finally {
				checking = false;
			}
		}, RECORDING_DISK_CHECK_INTERVAL_MS);
		timer.unref();
		diskCheckTimer = timer;
	};
	const clearCompletedWindowsRecording = async () => {
		const startedAt = activeRecoveryStartedAt;
		if (startedAt === null) return;
		await clearRecordingJournal(startedAt).catch((error) => {
			console.warn("Could not clear recording recovery journal:", error);
		});
		if (activeRecoveryStartedAt === startedAt) activeRecoveryStartedAt = null;
	};
	handleTrustedIpc("get-recording-disk-status", () => getRecordingDiskStatus().catch(() => null));
	handleTrustedIpc("get-interrupted-recording", () => getInterruptedRecording());
	handleTrustedIpc("recover-interrupted-recording", (_event, startedAt: number) =>
		Number.isSafeInteger(startedAt) ? recoverInterruptedRecording(startedAt) : { success: false },
	);
	handleTrustedIpc("discard-interrupted-recording", (_event, startedAt: number) =>
		Number.isSafeInteger(startedAt) ? discardInterruptedRecording(startedAt) : { success: false },
	);

	handleTrustedIpc(
		"start-native-screen-recording",
		async (_, source: SelectedSource, options?: NativeMacRecordingOptions) => {
			// Protect the HUD at the capture boundary, before the renderer publishes recording state.
			beginHudCaptureProtection();
			const visibleWindowBounds = source.id?.startsWith("window:")
				? await bringSelectedWindowForward(source)
				: null;

			// Windows native capture path
			if (process.platform === "win32") {
				if (windowsNativeCaptureActive || windowsCaptureStopRequested) {
					return { success: false, message: uiText("failedToStartNativeWindowsCapture") };
				}
				const windowsCaptureAvailable = await isNativeWindowsCaptureAvailable();
				if (!windowsCaptureAvailable) {
					return {
						success: false,
						message: uiText("nativeWindowsCaptureIsNotAvailableOnThisSystem"),
					};
				}

				if (windowsCaptureProcess && !windowsNativeCaptureActive) {
					try {
						windowsCaptureProcess.kill();
					} catch {
						/* ignore */
					}
					setWindowsCaptureProcess(null);
					setWindowsCaptureTargetPath(null);
					setWindowsCaptureStopRequested(false);
				}

				if (windowsCaptureProcess) {
					return {
						success: false,
						message: uiText("aNativeWindowsScreenRecordingIsAlreadyActive"),
					};
				}

				let wcProc: ChildProcessWithoutNullStreams | null = null;
				let tempVideoPath: string | null = null;
				let tempSystemAudioPath: string | null = null;
				let tempMicPath: string | null = null;
				let journalStartedAt: number | null = null;
				try {
					const exePath = getWindowsCaptureExePath();
					const recordingsDir = await getRecordingsDir();
					const timestamp = Date.now();
					const outputPath = path.join(recordingsDir, `recording-${timestamp}.mp4`);
					const temporaryStem = path.join(recordingsDir, `.leadcut-native-${timestamp}`);
					tempVideoPath = `${temporaryStem}.mp4`;

					let captureOutput = "";
					let systemAudioPath: string | null = null;
					let microphonePath: string | null = null;
					let orphanedMicAudioPath: string | null = null;

					const browserMicFallbackRequested =
						shouldStartWindowsBrowserMicrophoneFallback(options);
					const captureTarget = resolveWindowsCaptureTarget(
						source,
						getScreen().getAllDisplays(),
						getScreen().getPrimaryDisplay(),
					);
					const displayBounds =
						captureTarget.kind === "display" ? captureTarget.bounds : null;
					setWindowsOrphanedMicAudioPath(null);

					const config: Record<string, unknown> = {
						outputPath: tempVideoPath,
						fps: 60,
					};

					if (captureTarget.kind === "invalid-window") {
						return {
							success: false,
							message:
								uiText("selectedWindowIsNoLongerAvailablePleaseChooseTheWindowAgain"),
						};
					}

					if (captureTarget.kind === "window") {
						config.windowHandle = captureTarget.windowHandle;
					} else {
						// Windows Graphics Capture (WGC) requires a raw HMONITOR handle.
						// We attempt to resolve the handle by matching the physical coordinates of the target display.
						const monitors = getMonitorHandles();
						const matchedMonitor = monitors.find(
							(monitor) =>
								monitor.x === Math.round(captureTarget.bounds.x) &&
								monitor.y === Math.round(captureTarget.bounds.y),
						);

						if (matchedMonitor) {
							config.displayId = matchedMonitor.handle;
						} else {
							// Fallback to coordinate-based matching if handle resolution fails
							config.displayId = captureTarget.displayId;
						}

						config.displayX = Math.round(captureTarget.bounds.x);
						config.displayY = Math.round(captureTarget.bounds.y);
						config.displayW = Math.round(captureTarget.bounds.width);
						config.displayH = Math.round(captureTarget.bounds.height);
					}

					if (options?.capturesSystemAudio) {
						systemAudioPath = path.join(
							recordingsDir,
							`recording-${timestamp}.system.wav`,
						);
						tempSystemAudioPath = `${temporaryStem}.system.wav`;
						config.captureSystemAudio = true;
						config.audioOutputPath = tempSystemAudioPath;
						setWindowsSystemAudioPath(systemAudioPath);
					} else {
						setWindowsSystemAudioPath(null);
					}

					if (options?.capturesMicrophone && !browserMicFallbackRequested) {
						microphonePath = path.join(recordingsDir, `recording-${timestamp}.mic.wav`);
						tempMicPath = `${temporaryStem}.mic.wav`;
						config.captureMic = true;
						config.micOutputPath = tempMicPath;
						if (options.microphoneDeviceId) {
							config.micDeviceId = options.microphoneDeviceId;
						}
						if (options.microphoneLabel) {
							config.micDeviceName = options.microphoneLabel;
						}
						setWindowsMicAudioPath(microphonePath);
					} else if (browserMicFallbackRequested) {
						config.captureMic = false;
						setWindowsMicAudioPath(null);
					} else {
						setWindowsMicAudioPath(null);
					}

					recordNativeCaptureDiagnostics({
						backend: "windows-wgc",
						phase: "start",
						sourceId: source?.id ?? null,
						sourceType: source?.sourceType ?? "unknown",
						displayId: typeof config.displayId === "number" ? config.displayId : null,
						displayBounds,
						windowHandle:
							typeof config.windowHandle === "number" ? config.windowHandle : null,
						helperPath: exePath,
						outputPath,
						systemAudioPath,
						microphonePath,
					});

					setWindowsCaptureOutputBuffer("");
					setWindowsCaptureTargetPath(outputPath);
					setWindowsCaptureStopRequested(false);
					setWindowsCapturePaused(false);

					wcProc = spawn(exePath, [JSON.stringify(config)], {
						cwd: recordingsDir,
						stdio: ["pipe", "pipe", "pipe"],
						env: process.env,
					});
					logSubprocessStderr(wcProc, "wgc-capture");
					setWindowsCaptureProcess(wcProc);
					attachWindowsCaptureLifecycle(wcProc);

					wcProc.stdout.on("data", (chunk: Buffer) => {
						const msg = chunk.toString();
						captureOutput = (captureOutput + msg).slice(-64 * 1024);
						setWindowsCaptureOutputBuffer(captureOutput);
					});
					wcProc.stderr.on("data", (chunk: Buffer) => {
						const msg = chunk.toString();
						captureOutput = (captureOutput + msg).slice(-64 * 1024);
						setWindowsCaptureOutputBuffer(captureOutput);
					});

					await waitForWindowsCaptureStart(wcProc);
					const microphoneFallbackRequired =
						browserMicFallbackRequested ||
						shouldUseWindowsBrowserMicrophoneFallback(captureOutput, options);
					if (microphoneFallbackRequired) {
						orphanedMicAudioPath = tempMicPath ?? microphonePath;
						setWindowsOrphanedMicAudioPath(orphanedMicAudioPath);
						microphonePath = null;
						setWindowsMicAudioPath(null);
					}
					await writeRecordingJournal({
						version: 1,
						startedAt: timestamp,
						tempVideoPath,
						tempSystemAudioPath: tempSystemAudioPath ?? undefined,
						tempMicAudioPath: tempMicPath ?? undefined,
						finalVideoPath: outputPath,
					}).then(() => {
						journalStartedAt = timestamp;
						activeRecoveryStartedAt = timestamp;
					}).catch((error) => {
						console.warn("Could not write recording recovery journal:", error);
					});
					setWindowsNativeCaptureActive(true);
					setNativeScreenRecordingActive(true);
					recordNativeCaptureDiagnostics({
						backend: "windows-wgc",
						phase: "start",
						sourceId: source?.id ?? null,
						sourceType: source?.sourceType ?? "unknown",
						displayId: typeof config.displayId === "number" ? config.displayId : null,
						displayBounds,
						windowHandle:
							typeof config.windowHandle === "number" ? config.windowHandle : null,
						helperPath: exePath,
						outputPath,
						systemAudioPath,
						microphonePath,
						processOutput: captureOutput.trim() || undefined,
					});
					return { success: true, microphoneFallbackRequired };
				} catch (error) {
					recordNativeCaptureDiagnostics({
						backend: "windows-wgc",
						phase: "start",
						sourceId: source?.id ?? null,
						sourceType: source?.sourceType ?? "unknown",
						helperPath: windowsCaptureTargetPath ? getWindowsCaptureExePath() : null,
						outputPath: windowsCaptureTargetPath,
						systemAudioPath: windowsSystemAudioPath,
						microphonePath: windowsMicAudioPath,
						processOutput: windowsCaptureOutputBuffer.trim() || undefined,
						error: String(error),
					});
					console.error("Failed to start native Windows capture:", error);
					try {
						if (wcProc) wcProc.kill();
					} catch {
						/* ignore */
					}
					await Promise.allSettled([
						tempVideoPath
							? fs.rm(tempVideoPath, { force: true }).catch(() => undefined)
							: Promise.resolve(),
						tempSystemAudioPath
							? fs.rm(tempSystemAudioPath, { force: true }).catch(() => undefined)
							: Promise.resolve(),
						tempMicPath
							? fs.rm(tempMicPath, { force: true }).catch(() => undefined)
							: Promise.resolve(),
					]);
					if (journalStartedAt !== null && activeRecoveryStartedAt === journalStartedAt) {
						await clearCompletedWindowsRecording();
					}
					setWindowsNativeCaptureActive(false);
					setNativeScreenRecordingActive(false);
					setWindowsCaptureProcess(null);
					setWindowsCaptureTargetPath(null);
					setWindowsSystemAudioPath(null);
					setWindowsMicAudioPath(null);
					setWindowsOrphanedMicAudioPath(null);
					setWindowsCaptureStopRequested(false);
					setWindowsCapturePaused(false);
					return {
						success: false,
						message: uiText("failedToStartNativeWindowsCapture"),
						error: String(error),
					};
				}
			}

			if (process.platform !== "darwin") {
				return {
					success: false,
					message: uiText("nativeScreenRecordingIsOnlyAvailableOnMacOS"),
				};
			}

			if (nativeCaptureProcess && !nativeScreenRecordingActive) {
				try {
					nativeCaptureProcess.kill();
				} catch {
					// ignore stale helper cleanup failures
				}
				setNativeCaptureProcess(null);
				setNativeCaptureTargetPath(null);
				setNativeCaptureStopRequested(false);
			}

			if (nativeCaptureProcess) {
				return { success: false, message: uiText("aNativeScreenRecordingIsAlreadyActive") };
			}

			let captProc: ChildProcessWithoutNullStreams | null = null;
			try {
				const recordingsDir = await getRecordingsDir();

				// Warm up TCC: trigger an Electron-level screen capture API call so macOS
				// activates the screen-recording grant for this process tree before the
				// native helper binary spawns and calls SCStream.startCapture().
				try {
					await desktopCapturer.getSources({
						types: ["screen"],
						thumbnailSize: { width: 1, height: 1 },
					});
				} catch {
					// non-fatal – the helper will report its own TCC status
				}

				// Ensure microphone TCC is granted for this process tree when mic capture
				// is requested, so the child helper inherits the grant.
				if (options?.capturesMicrophone) {
					const micStatus = systemPreferences.getMediaAccessStatus("microphone");
					if (micStatus !== "granted") {
						await systemPreferences.askForMediaAccess("microphone");
					}
				}

				const appName = normalizeDesktopSourceName(String(source?.appName ?? ""));
				const ownAppName = normalizeDesktopSourceName(app.getName());
				if (
					!ALLOW_OWN_WINDOW_CAPTURE &&
					source?.id?.startsWith("window:") &&
					appName &&
					appName === ownAppName
				) {
					return {
						success: false,
						message:
							uiText("cannotRecordLeadCutWindowsPleaseSelectAnotherAppWindow"),
					};
				}

				const helperPath = await ensureNativeCaptureHelperBinary();
				const timestamp = Date.now();
				const outputPath = path.join(recordingsDir, `recording-${timestamp}.mp4`);
				const capturesSystemAudio = Boolean(options?.capturesSystemAudio);
				const capturesMicrophone = Boolean(options?.capturesMicrophone);
				const systemAudioOutputPath = capturesSystemAudio
					? path.join(recordingsDir, `recording-${timestamp}.system.m4a`)
					: null;
				const microphoneOutputPath = capturesMicrophone
					? path.join(recordingsDir, `recording-${timestamp}.mic.m4a`)
					: null;
				const config: Record<string, unknown> = {
					fps: 60,
					outputPath,
					capturesSystemAudio,
					capturesMicrophone,
				};

				const excludedProcessIds = getHudCaptureExcludedProcessIds(
					process.platform,
					getHudOverlayCaptureProtectionEnabled(),
					process.pid,
				);
				if (excludedProcessIds.length > 0) {
					config.excludedProcessIds = excludedProcessIds;
				}

				if (options?.microphoneDeviceId) {
					config.microphoneDeviceId = options.microphoneDeviceId;
				}

				if (options?.microphoneLabel) {
					config.microphoneLabel = options.microphoneLabel;
				}

				if (systemAudioOutputPath) {
					config.systemAudioOutputPath = systemAudioOutputPath;
				}

				if (microphoneOutputPath) {
					config.microphoneOutputPath = microphoneOutputPath;
				}

				const windowId = parseWindowId(source?.id);
				const screenId = Number(source?.display_id);

				if (Number.isFinite(windowId) && windowId && source?.id?.startsWith("window:")) {
					config.windowId = windowId;
					if (visibleWindowBounds) {
						config.windowX = visibleWindowBounds.x;
						config.windowY = visibleWindowBounds.y;
						config.windowWidth = visibleWindowBounds.width;
						config.windowHeight = visibleWindowBounds.height;
					}
				} else if (Number.isFinite(screenId) && screenId > 0) {
					config.displayId = screenId;
				} else {
					config.displayId = Number(getScreen().getPrimaryDisplay().id);
				}

				setNativeCaptureOutputBuffer("");
				setNativeCaptureTargetPath(outputPath);
				setNativeCaptureSystemAudioPath(systemAudioOutputPath);
				setNativeCaptureMicrophonePath(microphoneOutputPath);
				setNativeCaptureStopRequested(false);
				setNativeCapturePaused(false);
				captProc = spawn(helperPath, [JSON.stringify(config)], {
					cwd: recordingsDir,
					stdio: ["pipe", "pipe", "pipe"],
				});
				setNativeCaptureProcess(captProc);
				attachNativeCaptureLifecycle(captProc);

				captProc.stdout.on("data", (chunk: Buffer) => {
					setNativeCaptureOutputBuffer(nativeCaptureOutputBuffer + chunk.toString());
				});
				captProc.stderr.on("data", (chunk: Buffer) => {
					setNativeCaptureOutputBuffer(nativeCaptureOutputBuffer + chunk.toString());
				});

				await waitForNativeCaptureStart(captProc);
				setNativeScreenRecordingActive(true);

				// If the native helper reported MICROPHONE_CAPTURE_UNAVAILABLE, it started
				// capture without microphone.  Clear the mic path so the renderer can fall
				// back to a browser-side sidecar recording for the microphone track.
				const micUnavailableNatively = nativeCaptureOutputBuffer.includes(
					"MICROPHONE_CAPTURE_UNAVAILABLE",
				);
				if (micUnavailableNatively) {
					setNativeCaptureMicrophonePath(null);
				}

				recordNativeCaptureDiagnostics({
					backend: "mac-screencapturekit",
					phase: "start",
					sourceId: source?.id ?? null,
					sourceType: source?.sourceType ?? "unknown",
					displayId: typeof config.displayId === "number" ? config.displayId : null,
					helperPath,
					outputPath,
					systemAudioPath: systemAudioOutputPath,
					microphonePath: nativeCaptureMicrophonePath,
					processOutput: nativeCaptureOutputBuffer.trim() || undefined,
				});
				return {
					success: true,
					microphoneFallbackRequired: micUnavailableNatively,
				};
			} catch (error) {
				console.error("Failed to start native ScreenCaptureKit recording:", error);
				const errorStr = String(error);

				// Detect TCC (screen recording permission) errors and show a helpful dialog
				if (
					errorStr.includes("declined TCC") ||
					errorStr.includes("declined TCCs") ||
					errorStr.includes("SCREEN_RECORDING_PERMISSION_DENIED")
				) {
					const { response } = await dialog.showMessageBox({
						type: "warning",
						title: uiText("screenRecordingPermissionRequired"),
						message:
							uiText("leadcutNeedsScreenRecordingPermissionToCaptureYourScreen"),
						detail: uiText("pleaseOpenSystemSettingsPrivacySecurityScreenRecordingMakeSureRecord8a633981"),
						buttons: [uiText("openSystemSettings"), uiText("cancel")],
						defaultId: 0,
						cancelId: 1,
					});
					if (response === 0) {
						await shell.openExternal(getMacPrivacySettingsUrl("screen"));
					}
					try {
						if (captProc) captProc.kill();
					} catch {
						/* ignore */
					}
					setNativeScreenRecordingActive(false);
					setNativeCaptureProcess(null);
					setNativeCaptureTargetPath(null);
					setNativeCaptureSystemAudioPath(null);
					setNativeCaptureMicrophonePath(null);
					setNativeCaptureStopRequested(false);
					setNativeCapturePaused(false);
					return {
						success: false,
						message:
							uiText("screenRecordingPermissionNotGrantedPleaseAllowAccessInSystemSettings639f728c"),
						userNotified: true,
					};
				}

				if (errorStr.includes("MICROPHONE_PERMISSION_DENIED")) {
					const { response } = await dialog.showMessageBox({
						type: "warning",
						title: uiText("microphonePermissionRequired"),
						message: uiText("leadcutNeedsMicrophonePermissionToRecordAudio"),
						detail: uiText("pleaseOpenSystemSettingsPrivacySecurityMicrophoneMakeSureLeadCutIsTa144eec8"),
						buttons: [uiText("openSystemSettings"), uiText("cancel")],
						defaultId: 0,
						cancelId: 1,
					});
					if (response === 0) {
						await shell.openExternal(getMacPrivacySettingsUrl("microphone"));
					}
					try {
						if (captProc) captProc.kill();
					} catch {
						/* ignore */
					}
					setNativeScreenRecordingActive(false);
					setNativeCaptureProcess(null);
					setNativeCaptureTargetPath(null);
					setNativeCaptureSystemAudioPath(null);
					setNativeCaptureMicrophonePath(null);
					setNativeCaptureStopRequested(false);
					setNativeCapturePaused(false);
					return {
						success: false,
						message:
							uiText("microphonePermissionNotGrantedPleaseAllowAccessInSystemSettings"),
						userNotified: true,
					};
				}

				recordNativeCaptureDiagnostics({
					backend: "mac-screencapturekit",
					phase: "start",
					sourceId: source?.id ?? null,
					sourceType: source?.sourceType ?? "unknown",
					helperPath: getNativeCaptureHelperBinaryPath(),
					outputPath: nativeCaptureTargetPath,
					systemAudioPath: nativeCaptureSystemAudioPath,
					microphonePath: nativeCaptureMicrophonePath,
					processOutput: nativeCaptureOutputBuffer.trim() || undefined,
					fileSizeBytes: await getFileSizeIfPresent(nativeCaptureTargetPath),
					error: String(error),
				});
				try {
					if (captProc) captProc.kill();
				} catch {
					// ignore cleanup failures
				}
				setNativeScreenRecordingActive(false);
				setNativeCaptureProcess(null);
				setNativeCaptureTargetPath(null);
				setNativeCaptureSystemAudioPath(null);
				setNativeCaptureMicrophonePath(null);
				setNativeCaptureStopRequested(false);
				setNativeCapturePaused(false);
				return {
					success: false,
					message: uiText("failedToStartNativeScreenCaptureKitRecording"),
					error: String(error),
				};
			}
		},
	);

	handleTrustedIpc("stop-native-screen-recording", async (event, discard?: unknown) => {
		const start = Date.now();
		const reportFinalization = (status: NativeRecordingFinalization) => {
			if (discard !== true && !event.sender.isDestroyed()) {
				event.sender.send("recording-finalization", status);
			}
		};
		const reportStagedVideo = async (filePath: string) => {
			if (discard === true) return;
			const info = await fs.stat(filePath).catch(() => null);
			reportFinalization({ stage: "preparing", savedPath: info?.isFile() && info.size > 0 ? filePath : undefined });
		};
		console.log("[PERF:MAIN] Handler: stop-native-screen-recording: STARTED");
		try {
			// Windows native capture stop path
			if (process.platform === "win32" && windowsNativeCaptureActive) {
				if (windowsCaptureStopRequested) return { success: false, message: uiText("failedToStopNativeWindowsCapture") };
				let stagedTempVideoPath: string | null = null;
				let stagedTempSystemAudioPath: string | null = null;
				let stagedTempMicAudioPath: string | null = null;
				try {
					if (!windowsCaptureProcess) {
						throw new Error("Native Windows capture process is not running");
					}

					const proc = windowsCaptureProcess;
					const preferredVideoPath = windowsCaptureTargetPath;
					const preferredOrphanedMicAudioPath = windowsOrphanedMicAudioPath;
					const diagnosticsSystemAudioPath = windowsSystemAudioPath;
					const diagnosticsMicAudioPath = windowsMicAudioPath;
					setWindowsCaptureStopRequested(true);
					proc.stdin.write("stop\n");
					const tempVideoPath = await waitForWindowsCaptureStop(proc);
					stagedTempVideoPath = tempVideoPath;
					if (discard === true && activeRecoveryStartedAt !== null) {
						const result = await discardInterruptedRecording(activeRecoveryStartedAt, proc);
						if (result.success) {
							activeRecoveryStartedAt = null;
							setWindowsCaptureProcess(null);
							setWindowsNativeCaptureActive(false);
							setNativeScreenRecordingActive(false);
							setWindowsCaptureTargetPath(null);
							setWindowsCaptureStopRequested(false);
							setWindowsCapturePaused(false);
							setWindowsOrphanedMicAudioPath(null);
							setWindowsSystemAudioPath(null);
							setWindowsMicAudioPath(null);
							setWindowsPendingVideoPath(null);
							await cleanupWindowsOrphanedMicAudioPath(preferredOrphanedMicAudioPath);
							return { success: true };
						}
					}
					const finalVideoPath = preferredVideoPath ?? tempVideoPath;
					reportFinalization({ stage: "saving" });

					const audio = [];
					if (windowsSystemAudioPath && tempVideoPath.endsWith(".mp4")) {
						stagedTempSystemAudioPath = tempVideoPath.replace(/\.mp4$/, ".system.wav");
						audio.push({ temporary: stagedTempSystemAudioPath, final: windowsSystemAudioPath });
					}
					if (windowsMicAudioPath && tempVideoPath.endsWith(".mp4")) {
						stagedTempMicAudioPath = tempVideoPath.replace(/\.mp4$/, ".mic.wav");
						audio.push({ temporary: stagedTempMicAudioPath, final: windowsMicAudioPath });
					}
					// Stage with Node so user-selected directories may contain Unicode characters.
					await stageWindowsCaptureOutputs({
						temporaryVideo: tempVideoPath,
						finalVideo: finalVideoPath,
						audio,
						onVideoStaged: async () => {
							if (activeRecoveryStartedAt !== null && tempVideoPath !== finalVideoPath) {
								await updateRecordingJournal(activeRecoveryStartedAt, { tempVideoPath: finalVideoPath })
									.catch(error => console.warn("Could not update recording recovery path:", error));
							}
							await reportStagedVideo(finalVideoPath);
						},
					});
					await prepareSeekableMedia(finalVideoPath, { replaceOriginal: true });
					const validation = await validateRecordedVideo(finalVideoPath);

					setWindowsCaptureProcess(null);
					setWindowsNativeCaptureActive(false);
					setNativeScreenRecordingActive(false);
					setWindowsCaptureTargetPath(null);
					setWindowsCaptureStopRequested(false);
					setWindowsCapturePaused(false);
					setWindowsOrphanedMicAudioPath(null);
					await cleanupWindowsOrphanedMicAudioPath(preferredOrphanedMicAudioPath);
					setWindowsPendingVideoPath(finalVideoPath);
					recordNativeCaptureDiagnostics({
						backend: "windows-wgc",
						phase: "stop",
						outputPath: finalVideoPath,
						systemAudioPath: diagnosticsSystemAudioPath,
						microphonePath: diagnosticsMicAudioPath,
						processOutput: windowsCaptureOutputBuffer.trim() || undefined,
						fileSizeBytes: validation.fileSizeBytes,
					});
					await writeWindowsRecordingDiagnostics(finalVideoPath, {
						phase: "stop",
						outputPath: finalVideoPath,
						systemAudioPath: diagnosticsSystemAudioPath,
						microphonePath: diagnosticsMicAudioPath,
						processOutput: windowsCaptureOutputBuffer.trim() || undefined,
						details: {
							fileSizeBytes: validation.fileSizeBytes,
							durationSeconds: validation.durationSeconds,
						},
					});

					// Persist recording sidecars before the editor opens the new source.
					snapshotCursorTelemetryForPersistence();
					await persistRecordingSidecars(finalVideoPath);
					if (!browserMicrophones.hasRecording(activeRecoveryStartedAt)) {
						await clearCompletedWindowsRecording();
					}

					return { success: true, path: finalVideoPath };
				} catch (error) {
					console.error("Failed to stop native Windows capture:", error);
					const fallbackPath = await resolveExistingPath(
						windowsCaptureTargetPath,
						stagedTempVideoPath,
					);
					const recoveredSystemAudioPath = await resolveExistingPath(
						windowsSystemAudioPath,
						stagedTempSystemAudioPath,
					);
					const recoveredMicAudioPath = await resolveExistingPath(
						windowsMicAudioPath,
						stagedTempMicAudioPath,
					);
					const fallbackOrphanedMicAudioPath = windowsOrphanedMicAudioPath;
					const diagnosticsSystemAudioPath =
						recoveredSystemAudioPath ?? windowsSystemAudioPath;
					const diagnosticsMicAudioPath = recoveredMicAudioPath ?? windowsMicAudioPath;
					setWindowsNativeCaptureActive(false);
					setNativeScreenRecordingActive(false);
					setWindowsCaptureProcess(null);
					setWindowsCaptureTargetPath(null);
					setWindowsCaptureStopRequested(false);
					setWindowsCapturePaused(false);
					setWindowsOrphanedMicAudioPath(null);

					if (fallbackPath) {
						try {
							const validation = await validateRecordedVideo(fallbackPath);
							setWindowsPendingVideoPath(fallbackPath);
							setWindowsSystemAudioPath(recoveredSystemAudioPath);
							setWindowsMicAudioPath(recoveredMicAudioPath);
							await cleanupWindowsOrphanedMicAudioPath(fallbackOrphanedMicAudioPath);
							recordNativeCaptureDiagnostics({
								backend: "windows-wgc",
								phase: "stop",
								outputPath: fallbackPath,
								systemAudioPath: diagnosticsSystemAudioPath,
								microphonePath: diagnosticsMicAudioPath,
								processOutput: windowsCaptureOutputBuffer.trim() || undefined,
								fileSizeBytes: validation.fileSizeBytes,
								error: String(error),
							});
							await writeWindowsRecordingDiagnostics(fallbackPath, {
								phase: "stop",
								outputPath: fallbackPath,
								systemAudioPath: diagnosticsSystemAudioPath,
								microphonePath: diagnosticsMicAudioPath,
								processOutput: windowsCaptureOutputBuffer.trim() || undefined,
								error: String(error),
								details: {
									fileSizeBytes: validation.fileSizeBytes,
									durationSeconds: validation.durationSeconds,
									recoveredAfterStopFailure: true,
								},
							});
							snapshotCursorTelemetryForPersistence();
							await persistRecordingSidecars(fallbackPath);
							await clearCompletedWindowsRecording();
							return { success: true, path: fallbackPath };
						} catch {
							// File is absent or failed validation.
						}
					}

					setWindowsSystemAudioPath(null);
					setWindowsMicAudioPath(null);
					setWindowsPendingVideoPath(null);
					await cleanupWindowsOrphanedMicAudioPath(fallbackOrphanedMicAudioPath);

					recordNativeCaptureDiagnostics({
						backend: "windows-wgc",
						phase: "stop",
						outputPath: fallbackPath,
						systemAudioPath: diagnosticsSystemAudioPath,
						microphonePath: diagnosticsMicAudioPath,
						processOutput: windowsCaptureOutputBuffer.trim() || undefined,
						fileSizeBytes: await getFileSizeIfPresent(fallbackPath),
						error: String(error),
					});
					await writeWindowsRecordingDiagnostics(fallbackPath, {
						phase: "stop",
						outputPath: fallbackPath,
						systemAudioPath: diagnosticsSystemAudioPath,
						microphonePath: diagnosticsMicAudioPath,
						processOutput: windowsCaptureOutputBuffer.trim() || undefined,
						error: String(error),
						details: {
							fileSizeBytes: await getFileSizeIfPresent(fallbackPath),
						},
					});

					return {
						success: false,
						message: uiText("failedToStopNativeWindowsCapture"),
						error: String(error),
					};
				}
			}

			if (process.platform !== "darwin") {
				return {
					success: false,
					message: uiText("nativeScreenRecordingIsOnlyAvailableOnMacOS"),
				};
			}

			if (!nativeScreenRecordingActive) {
				const recovered = await recoverNativeMacCaptureOutput();
				if (recovered) {
					return recovered;
				}

				return { success: false, message: uiText("noNativeScreenRecordingIsActive") };
			}

			try {
				if (!nativeCaptureProcess) {
					throw new Error("Native capture helper process is not running");
				}

				const process = nativeCaptureProcess;
				const preferredVideoPath = nativeCaptureTargetPath;
				const preferredSystemAudioPath = nativeCaptureSystemAudioPath;
				const preferredMicrophonePath = nativeCaptureMicrophonePath;
				console.log(
					"[stop-native] Audio paths — system:",
					preferredSystemAudioPath,
					"mic:",
					preferredMicrophonePath,
				);
				setNativeCaptureStopRequested(true);
				process.stdin.write("stop\n");
				const tempVideoPath = await waitForNativeCaptureStop(process);
				console.log("[stop-native] Helper stopped, tempVideoPath:", tempVideoPath);
				setNativeCaptureProcess(null);
				setNativeScreenRecordingActive(false);
				setNativeCaptureTargetPath(null);
				setNativeCaptureSystemAudioPath(null);
				setNativeCaptureMicrophonePath(null);
				setNativeCaptureStopRequested(false);
				setNativeCapturePaused(false);

				const finalVideoPath = preferredVideoPath ?? tempVideoPath;
				reportFinalization({ stage: "saving" });
				if (tempVideoPath !== finalVideoPath) {
					await moveFileWithOverwrite(tempVideoPath, finalVideoPath);
				}
				await reportStagedVideo(finalVideoPath);

				if (preferredSystemAudioPath || preferredMicrophonePath) {
					console.log(
						"[stop-native] Attempting audio mux (merging separate tracks) into:",
						finalVideoPath,
					);
					try {
						await muxNativeMacRecordingWithAudio(
							finalVideoPath,
							preferredSystemAudioPath,
							preferredMicrophonePath,
						);
						console.log("[stop-native] Audio mux completed successfully");
					} catch (error) {
						console.warn(
							"[stop-native] Audio mux failed (video still has inline audio):",
							error,
						);
					}
				} else {
					console.log("[stop-native] No separate audio tracks to mux");
				}

				return await finalizeStoredVideo(finalVideoPath);
			} catch (error) {
				console.error("Failed to stop native ScreenCaptureKit recording:", error);
				const fallbackPath = nativeCaptureTargetPath;
				const fallbackSystemAudioPath = nativeCaptureSystemAudioPath;
				const fallbackMicrophonePath = nativeCaptureMicrophonePath;
				const fallbackFileSizeBytes = await getFileSizeIfPresent(fallbackPath);
				setNativeScreenRecordingActive(false);
				setNativeCaptureProcess(null);
				setNativeCaptureTargetPath(null);
				setNativeCaptureSystemAudioPath(null);
				setNativeCaptureMicrophonePath(null);
				setNativeCaptureStopRequested(false);
				setNativeCapturePaused(false);

				recordNativeCaptureDiagnostics({
					backend: "mac-screencapturekit",
					phase: "stop",
					sourceId: lastNativeCaptureDiagnostics?.sourceId ?? null,
					sourceType: lastNativeCaptureDiagnostics?.sourceType ?? "unknown",
					displayId: lastNativeCaptureDiagnostics?.displayId ?? null,
					displayBounds: lastNativeCaptureDiagnostics?.displayBounds ?? null,
					windowHandle: lastNativeCaptureDiagnostics?.windowHandle ?? null,
					helperPath: lastNativeCaptureDiagnostics?.helperPath ?? null,
					outputPath: fallbackPath,
					systemAudioPath: fallbackSystemAudioPath,
					microphonePath: fallbackMicrophonePath,
					osRelease: lastNativeCaptureDiagnostics?.osRelease,
					supported: lastNativeCaptureDiagnostics?.supported,
					helperExists: lastNativeCaptureDiagnostics?.helperExists,
					processOutput: nativeCaptureOutputBuffer.trim() || undefined,
					fileSizeBytes: fallbackFileSizeBytes,
					error: String(error),
				});

				// Try to recover: if the target file exists on disk, finalize with it
				if (fallbackPath) {
					try {
						await fs.access(fallbackPath);
						console.log(
							"[stop-native-screen-recording] Recovering with fallback path:",
							fallbackPath,
						);
						if (fallbackSystemAudioPath || fallbackMicrophonePath) {
							try {
								await muxNativeMacRecordingWithAudio(
									fallbackPath,
									fallbackSystemAudioPath,
									fallbackMicrophonePath,
								);
							} catch (muxError) {
								console.warn(
									"Failed to mux recovered native macOS audio into capture:",
									muxError,
								);
							}
						}
						return await finalizeStoredVideo(fallbackPath);
					} catch {
						// File doesn't exist or isn't accessible
					}
				}

				const recovered = await recoverNativeMacCaptureOutput();
				if (recovered) {
					return recovered;
				}

				return {
					success: false,
					message: uiText("failedToStopNativeScreenCaptureKitRecording"),
					error: String(error),
				};
			}
		} finally {
			console.log(
				`[PERF:MAIN] Handler: stop-native-screen-recording: COMPLETED in ${Date.now() - start}ms`,
			);
		}
	});

	handleTrustedIpc("recover-native-screen-recording", async () => {
		if (process.platform === "win32") {
			if (activeRecoveryStartedAt === null) {
				return { success: false, message: uiText("recordingStoppedUnexpectedly") };
			}
			const result = await recoverInterruptedRecording(activeRecoveryStartedAt);
			if (result.success) {
				activeRecoveryStartedAt = null;
				setNativeScreenRecordingActive(false);
				setWindowsCaptureTargetPath(null);
				setWindowsSystemAudioPath(null);
				setWindowsMicAudioPath(null);
				setWindowsCapturePaused(false);
				setWindowsOrphanedMicAudioPath(null);
			}
			return result;
		}
		if (process.platform !== "darwin") {
			return {
				success: false,
				message: uiText("nativeScreenRecordingRecoveryIsOnlyAvailableOnMacOS"),
			};
		}

		const recovered = await recoverNativeMacCaptureOutput();
		if (recovered) {
			return recovered;
		}

		return {
			success: false,
			message: uiText("noRecoverableNativeMacOSRecordingOutputWasFound"),
		};
	});

	handleTrustedIpc("pause-native-screen-recording", async () => {
		if (process.platform === "win32") {
			if (!windowsNativeCaptureActive || !windowsCaptureProcess) {
				return { success: false, message: uiText("noNativeWindowsScreenRecordingIsActive") };
			}

			if (windowsCapturePaused) {
				return { success: true };
			}

			try {
				windowsCaptureProcess.stdin.write("pause\n");
				setWindowsCapturePaused(true);
				return { success: true };
			} catch (error) {
				return {
					success: false,
					message: uiText("failedToPauseNativeWindowsCapture"),
					error: String(error),
				};
			}
		}

		if (process.platform !== "darwin") {
			return {
				success: false,
				message: uiText("nativeScreenRecordingIsOnlyAvailableOnMacOS"),
			};
		}

		if (!nativeScreenRecordingActive || !nativeCaptureProcess) {
			return { success: false, message: uiText("noNativeScreenRecordingIsActive") };
		}

		if (nativeCapturePaused) {
			return { success: true };
		}

		try {
			const commandApplied = waitForNativeCaptureCommand(
				nativeCaptureProcess,
				"Recording paused",
			);
			nativeCaptureProcess.stdin.write("pause\n");
			await commandApplied;
			setNativeCapturePaused(true);
			return { success: true };
		} catch (error) {
			return {
				success: false,
				message: uiText("failedToPauseNativeScreenRecording"),
				error: String(error),
			};
		}
	});

	handleTrustedIpc("resume-native-screen-recording", async () => {
		if (process.platform === "win32") {
			if (!windowsNativeCaptureActive || !windowsCaptureProcess) {
				return { success: false, message: uiText("noNativeWindowsScreenRecordingIsActive") };
			}

			if (!windowsCapturePaused) {
				return { success: true };
			}

			try {
				windowsCaptureProcess.stdin.write("resume\n");
				setWindowsCapturePaused(false);
				return { success: true };
			} catch (error) {
				return {
					success: false,
					message: uiText("failedToResumeNativeWindowsCapture"),
					error: String(error),
				};
			}
		}

		if (process.platform !== "darwin") {
			return {
				success: false,
				message: uiText("nativeScreenRecordingIsOnlyAvailableOnMacOS"),
			};
		}

		if (!nativeScreenRecordingActive || !nativeCaptureProcess) {
			return { success: false, message: uiText("noNativeScreenRecordingIsActive") };
		}

		if (!nativeCapturePaused) {
			return { success: true };
		}

		try {
			const commandApplied = waitForNativeCaptureCommand(
				nativeCaptureProcess,
				"Recording resumed",
			);
			nativeCaptureProcess.stdin.write("resume\n");
			await commandApplied;
			setNativeCapturePaused(false);
			return { success: true };
		} catch (error) {
			return {
				success: false,
				message: uiText("failedToResumeNativeScreenRecording"),
				error: String(error),
			};
		}
	});

	handleTrustedIpc("get-system-cursor-assets", async () => {
		try {
			return { success: true, cursors: await getSystemCursorAssets() };
		} catch (error) {
			console.error("Failed to load system cursor assets:", error);
			return { success: false, cursors: {}, error: String(error) };
		}
	});

	handleTrustedIpc("is-native-windows-capture-available", async () => {
		return { available: await isNativeWindowsCaptureAvailable() };
	});

	handleTrustedIpc("get-last-native-capture-diagnostics", async () => {
		return { success: true, diagnostics: lastNativeCaptureDiagnostics };
	});

	handleTrustedIpc("get-video-audio-fallback-paths", async (_event, videoPath: string) => {
		const empty = { paths: [], sidecarPaths: [], startDelayMsByPath: {} };
		if (typeof videoPath !== "string" || !videoPath) {
			return { success: true, ...empty };
		}

		try {
			const source = await resolveApprovedLocalMediaPath(videoPath);
			if (!source) return { success: true, ...empty };
			const audio = await getCompanionAudioFallbackInfo(source);
			await Promise.all(audio.sidecarPaths.map(sidecarPath => rememberApprovedLocalReadPath(sidecarPath)));
			return { success: true, ...audio };
		} catch (error) {
			console.error("Failed to resolve companion audio fallback paths:", error);
			return { success: false, ...empty, error: String(error) };
		}
	});

	handleTrustedIpc("mux-native-windows-recording", async (_event, expectedDurationMs?: number) => {
		const start = Date.now();
		console.log("[PERF:MAIN] Handler: mux-native-windows-recording: STARTED");
		try {
			const videoPath = windowsPendingVideoPath;
			const orphanedMicAudioPath = windowsOrphanedMicAudioPath;
			const diagnosticsSystemAudioPath = windowsSystemAudioPath;
			const diagnosticsMicAudioPath = windowsMicAudioPath;
			setWindowsPendingVideoPath(null);
			setWindowsOrphanedMicAudioPath(null);

			if (!videoPath) {
				return { success: false, message: uiText("noNativeWindowsVideoPendingForMux") };
			}

			try {
				await writeWindowsRecordingDiagnostics(videoPath, {
					phase: "mux-start",
					expectedDurationMs,
					outputPath: videoPath,
					systemAudioPath: diagnosticsSystemAudioPath,
					microphonePath: diagnosticsMicAudioPath,
					details: {
						hasSystemAudio: Boolean(diagnosticsSystemAudioPath),
						hasMicrophone: Boolean(diagnosticsMicAudioPath),
						hasOrphanedMicrophone: Boolean(orphanedMicAudioPath),
					},
				});
				console.log("[mux-win] Optimization active: skipping video padding.");

				let muxDetails: unknown = null;
				if (diagnosticsSystemAudioPath || diagnosticsMicAudioPath) {
					muxDetails = await muxNativeWindowsVideoWithAudio(
						videoPath,
						diagnosticsSystemAudioPath,
						diagnosticsMicAudioPath,
					);
					setWindowsSystemAudioPath(null);
					setWindowsMicAudioPath(null);
				}

				recordNativeCaptureDiagnostics({
					backend: "windows-wgc",
					phase: "mux",
					outputPath: videoPath,
					fileSizeBytes: await getFileSizeIfPresent(videoPath),
				});
				await writeWindowsRecordingDiagnostics(videoPath, {
					phase: "mux-complete",
					expectedDurationMs,
					outputPath: videoPath,
					systemAudioPath: diagnosticsSystemAudioPath,
					microphonePath: diagnosticsMicAudioPath,
					details: {
						fileSizeBytes: await getFileSizeIfPresent(videoPath),
						mux: muxDetails,
					},
				});
				await cleanupWindowsOrphanedMicAudioPath(orphanedMicAudioPath);
				return await finalizeStoredVideo(videoPath);
			} catch (error) {
				console.error("Failed to mux native Windows recording:", error);
				recordNativeCaptureDiagnostics({
					backend: "windows-wgc",
					phase: "mux",
					outputPath: videoPath,
					systemAudioPath: diagnosticsSystemAudioPath,
					microphonePath: diagnosticsMicAudioPath,
					fileSizeBytes: await getFileSizeIfPresent(videoPath),
					error: String(error),
				});
				await writeWindowsRecordingDiagnostics(videoPath, {
					phase: "mux-error",
					expectedDurationMs,
					outputPath: videoPath,
					systemAudioPath: diagnosticsSystemAudioPath,
					microphonePath: diagnosticsMicAudioPath,
					error: String(error),
					details: {
						fileSizeBytes: await getFileSizeIfPresent(videoPath),
					},
				});
				setWindowsSystemAudioPath(null);
				setWindowsMicAudioPath(null);
				await cleanupWindowsOrphanedMicAudioPath(orphanedMicAudioPath);
				try {
					return await finalizeStoredVideo(videoPath);
				} catch {
					try {
						await validateRecordedVideo(videoPath);
						return {
							success: false,
							path: videoPath,
							message: uiText("failedToMuxNativeWindowsRecording"),
							error: String(error),
						};
					} catch {
						// The fallback path is not safely playable; surface the original mux error.
					}

					return {
						success: false,
						message: uiText("failedToMuxNativeWindowsRecording"),
						error: String(error),
					};
				}
			}
		} finally {
			console.log(
				`[PERF:MAIN] Handler: mux-native-windows-recording: COMPLETED in ${Date.now() - start}ms`,
			);
		}
	});

	handleTrustedIpc("start-ffmpeg-recording", async (_, source: SelectedSource) => {
		if (ffmpegCaptureProcess) {
			return { success: false, message: uiText("anFFmpegRecordingIsAlreadyActive") };
		}

		try {
			const recordingsDir = await getRecordingsDir();
			const ffmpegPath = getFfmpegBinaryPath();
			const outputPath = path.join(recordingsDir, `recording-${Date.now()}.mp4`);
			const args = await buildFfmpegCaptureArgs(source, outputPath);

			setFfmpegCaptureOutputBuffer("");
			setFfmpegCaptureTargetPath(outputPath);
			const ffProc = spawn(ffmpegPath, args, {
				cwd: recordingsDir,
				stdio: ["pipe", "pipe", "pipe"],
			});
			setFfmpegCaptureProcess(ffProc);

			ffProc.stdout.on("data", (chunk: Buffer) => {
				setFfmpegCaptureOutputBuffer(ffmpegCaptureOutputBuffer + chunk.toString());
			});
			ffProc.stderr.on("data", (chunk: Buffer) => {
				setFfmpegCaptureOutputBuffer(ffmpegCaptureOutputBuffer + chunk.toString());
			});

			await waitForFfmpegCaptureStart(ffProc);
			setFfmpegScreenRecordingActive(true);
			return { success: true };
		} catch (error) {
			console.error("Failed to start FFmpeg recording:", error);
			setFfmpegScreenRecordingActive(false);
			setFfmpegCaptureProcess(null);
			setFfmpegCaptureTargetPath(null);
			return {
				success: false,
				message: uiText("failedToStartFFmpegRecording"),
				error: String(error),
			};
		}
	});

	handleTrustedIpc("stop-ffmpeg-recording", async () => {
		if (!ffmpegScreenRecordingActive) {
			return { success: false, message: uiText("noFFmpegRecordingIsActive") };
		}

		try {
			if (!ffmpegCaptureProcess || !ffmpegCaptureTargetPath) {
				throw new Error("FFmpeg process is not running");
			}

			const process = ffmpegCaptureProcess;
			const outputPath = ffmpegCaptureTargetPath;
			process.stdin.write("q\n");
			const finalVideoPath = await waitForFfmpegCaptureStop(process, outputPath);

			setFfmpegCaptureProcess(null);
			setFfmpegCaptureTargetPath(null);
			setFfmpegScreenRecordingActive(false);

			return await finalizeStoredVideo(finalVideoPath);
		} catch (error) {
			console.error("Failed to stop FFmpeg recording:", error);
			try {
				ffmpegCaptureProcess?.kill();
			} catch {
				// ignore cleanup failures
			}
			setFfmpegCaptureProcess(null);
			setFfmpegCaptureTargetPath(null);
			setFfmpegScreenRecordingActive(false);
			return {
				success: false,
				message: uiText("failedToStopFFmpegRecording"),
				error: String(error),
			};
		}
	});

	handleTrustedIpc("prepare-microphone-stream", async ({ sender }, input: { startDelayMs: number; profile?: string }) => {
		const videoPath = windowsNativeCaptureActive ? windowsCaptureTargetPath : nativeCaptureTargetPath;
		if (!videoPath || !Number.isFinite(input?.startDelayMs) || input.startDelayMs < 0) {
			throw new Error("No active native capture for microphone recording.");
		}
		const startedAt = process.platform === "win32" ? activeRecoveryStartedAt : null;
		if (startedAt !== null) {
			await updateRecordingJournal(startedAt, {
				browserMicrophone: { startDelayMs: input.startDelayMs, profile: input.profile },
			});
		}
		if (!microphoneOwners.has(sender.id)) {
			const owner = sender.id;
			microphoneOwners.add(owner);
			sender.once("destroyed", () => {
				microphoneOwners.delete(owner);
				browserMicrophones.releaseOwner(owner);
			});
		}
		return browserMicrophones.create(sender.id, videoPath, startedAt);
	});
	handleTrustedIpc("write-microphone-chunk", ({ sender }, streamId: string, bytes: ArrayBuffer) =>
		browserMicrophones.append(sender.id, streamId, bytes));
	handleTrustedIpc("discard-microphone-stream", async ({ sender }, streamId: string) => {
		const stream = await browserMicrophones.finish(sender.id, streamId);
		if (stream.hasData) await fs.rm(stream.partial, { force: true });
	});

	handleTrustedIpc(
		"store-microphone-sidecar",
		async (
			{ sender },
			streamId: string,
			videoPath: string,
			options?: {
				startDelayMs?: number;
				browserMicrophoneProfile?: string;
				requestedBrowserMicrophoneProfile?: string | null;
				requestedConstraints?: unknown;
				mediaTrackSettings?: Record<string, boolean | number | string>;
				audioInputDevices?: unknown;
				mediaRecorder?: unknown;
				chunkEvents?: unknown;
				pauseIntervals?: unknown;
			},
		) => {
			const baseName = videoPath.replace(/\.[^.]+$/, "");
			const sidecarPath = `${baseName}.mic.wav`;
			const sourceWebmPath = `${baseName}.mic.source.webm`;

			try {
				const stream = await browserMicrophones.finish(sender.id, streamId, videoPath);
				if (!(await fs.stat(stream.partial).catch(() => null))) {
					if (stream.recordingId !== null && activeRecoveryStartedAt === stream.recordingId) {
						await clearCompletedWindowsRecording();
					}
					return { success: true };
				}
				const sourceBytes = (await fs.stat(stream.partial)).size;
				await convertBrowserMicrophone(stream.partial, sidecarPath, options?.browserMicrophoneProfile);
				if (shouldKeepRecordingAudioSidecars()) {
					await fs.rename(stream.partial, sourceWebmPath);
				} else {
					await fs.rm(stream.partial, { force: true });
				}
				const startDelayMs = options?.startDelayMs;
				const mediaTrackSettings = pickPrimitiveRecord(options?.mediaTrackSettings);
				const audioInputDevices = pickAudioInputDevices(options?.audioInputDevices);
				const mediaRecorder = isRecord(options?.mediaRecorder)
					? {
							...(typeof options.mediaRecorder.mimeType === "string"
								? { mimeType: options.mediaRecorder.mimeType }
								: {}),
							...(typeof options.mediaRecorder.audioBitsPerSecond === "number"
								? {
										audioBitsPerSecond: Math.round(
											options.mediaRecorder.audioBitsPerSecond,
										),
									}
								: {}),
							...(typeof options.mediaRecorder.timesliceMs === "number"
								? { timesliceMs: Math.round(options.mediaRecorder.timesliceMs) }
								: {}),
						}
					: null;
				const chunkEvents = pickMicrophoneChunkEvents(options?.chunkEvents);
				const pauseIntervals = pickMicrophonePauseIntervals(options?.pauseIntervals);
				const chunkTiming =
					chunkEvents || pauseIntervals
						? summarizeMicrophoneChunkTiming(
								chunkEvents,
								pauseIntervals,
								mediaRecorder?.timesliceMs,
							)
						: null;
				const metadata = {
					...(Number.isFinite(startDelayMs) && (startDelayMs ?? 0) >= 0
						? { startDelayMs: Math.round(startDelayMs ?? 0) }
						: {}),
					...(typeof options?.browserMicrophoneProfile === "string"
						? { browserMicrophoneProfile: options.browserMicrophoneProfile }
						: {}),
					...(typeof options?.requestedBrowserMicrophoneProfile === "string"
						? {
								requestedBrowserMicrophoneProfile:
									options.requestedBrowserMicrophoneProfile,
							}
						: {}),
					...(isRecord(options?.requestedConstraints)
						? { requestedConstraints: options.requestedConstraints }
						: {}),
					...(mediaTrackSettings ? { mediaTrackSettings } : {}),
					...(audioInputDevices ? { audioInputDevices } : {}),
					...(mediaRecorder && Object.keys(mediaRecorder).length > 0
						? { mediaRecorder }
						: {}),
					...(chunkEvents ? { chunkEvents } : {}),
					...(pauseIntervals ? { pauseIntervals } : {}),
					...(chunkTiming ? { chunkTiming } : {}),
				};
				if (Object.keys(metadata).length > 0) {
					try {
						await fs.writeFile(`${sidecarPath}.json`, JSON.stringify(metadata));
					} catch (metadataError) {
						console.warn(
							"Failed to store microphone sidecar timing metadata:",
							metadataError,
						);
					}
				}
				await writeRecordingDiagnosticsSnapshot(videoPath, {
					backend: "browser-store",
					phase: "mic-sidecar",
					outputPath: videoPath,
					microphonePath: sidecarPath,
					details: {
						sourceBytes,
						sourceWebmPath: shouldKeepRecordingAudioSidecars() ? sourceWebmPath : null,
						metadata,
					},
				}).catch((diagnosticsError) => {
					console.warn(
						"Failed to write microphone sidecar diagnostics:",
						diagnosticsError,
					);
				});
				if (stream.recordingId !== null && activeRecoveryStartedAt === stream.recordingId) {
					await clearCompletedWindowsRecording();
				}
				return { success: true, path: sidecarPath };
			} catch (error) {
				console.error("Failed to store microphone sidecar:", error);
				return { success: false, error: String(error) };
			}
		},
	);

	// Pin the directory at first write, including if preferences change during capture.
	const webcamFiles = new Map<string, string>();
	handleTrustedIpc("webcam-write", async ({ sender }, name: string, data: ArrayBuffer, first: boolean) => {
		if (!/^recording-\d+-webcam\.(mp4|webm)$/.test(name) || !data.byteLength || data.byteLength > 4 * 1024 * 1024) {
			throw new Error("Invalid webcam chunk");
		}
		const key = `${sender.id}:${name}`;
		if (first) {
			const file = resolveRecordedVideoStoragePath(await getRecordingsDir(), name);
			await fs.writeFile(file + ".partial", Buffer.from(data), { flag: "wx" });
			webcamFiles.set(key, file);
		} else {
			const file = webcamFiles.get(key);
			if (!file) throw new Error("Unknown webcam recording");
			await fs.appendFile(file + ".partial", Buffer.from(data));
		}
	});
	handleTrustedIpc("webcam-finish", async ({ sender }, name: string, discard: boolean) => {
		const key = `${sender.id}:${name}`;
		const file = webcamFiles.get(key);
		if (!file) throw new Error("Unknown webcam recording");
		webcamFiles.delete(key);
		const partial = file + ".partial";
		if (discard) {
			await fs.unlink(partial);
			return null;
		}
		return finalizeWebcamRecording(file);
	});

	const browserStreams = createBrowserRecordingStreamStore();
	const browserStreamOwners = new Set<number>();
	handleTrustedIpc("recording-write", ({ sender }, name: string, data: ArrayBuffer, first: boolean) => {
		if (!browserStreamOwners.has(sender.id)) {
			const owner = sender.id;
			browserStreamOwners.add(owner);
			sender.once("destroyed", () => {
				browserStreamOwners.delete(owner);
				browserStreams.releaseOwner(owner);
			});
		}
		return browserStreams.append(sender.id, name, data, first);
	});
	handleTrustedIpc("recording-finish", ({ sender }, name: string, discard: boolean) =>
		browserStreams.finish(sender.id, name, discard));
	handleTrustedIpc("recover-browser-recording", async () => {
		if (browserStreams.hasActiveStreams() || nativeScreenRecordingActive || windowsNativeCaptureActive || ffmpegScreenRecordingActive) return { success: false };
		const partial = await findBrowserRecordingPartial();
		return partial ? recoverBrowserRecordingPartial(partial) : { success: false };
	});

	handleTrustedIpc("store-recorded-video", async (_, videoData: ArrayBuffer, fileName: unknown) => {
		try {
			const recordingsDir = await getRecordingsDir();
			const videoPath = resolveRecordedVideoStoragePath(recordingsDir, fileName);
			await fs.writeFile(videoPath, Buffer.from(videoData));
			return await finalizeStoredVideo(videoPath);
		} catch (error) {
			console.error("Failed to store video:", error);
			return {
				success: false,
				message: uiText("failedToStoreVideo"),
				error: String(error),
			};
		}
	});

	handleTrustedIpc("get-recorded-video-path", async () => {
		try {
			const recordingsDir = await getRecordingsDir();
			const entries = await fs.readdir(recordingsDir, { withFileTypes: true });
			const candidates = await Promise.all(
				entries
					.filter(
						(entry) =>
							entry.isFile() && /^recording-\d+\.(webm|mov|mp4)$/i.test(entry.name),
					)
					.map(async (entry) => {
						const fullPath = path.join(recordingsDir, entry.name);
						const stat = await fs.stat(fullPath).catch(() => null);
						return stat ? { path: fullPath, mtimeMs: stat.mtimeMs } : null;
					}),
			);
			const sortedCandidates = candidates
				.filter(
					(candidate): candidate is { path: string; mtimeMs: number } =>
						candidate !== null,
				)
				.sort((left, right) => right.mtimeMs - left.mtimeMs);

			for (const candidate of sortedCandidates) {
				try {
					await validateRecordedVideo(candidate.path);
					return { success: true, path: candidate.path };
				} catch (error) {
					console.warn(
						"Skipping unusable recovered recording candidate:",
						candidate.path,
						error,
					);
				}
			}

			if (sortedCandidates.length === 0) {
				return { success: false, message: uiText("noRecordedVideoFound") };
			}

			return { success: false, message: uiText("noUsableRecordedVideoFound") };
		} catch (error) {
			console.error("Failed to get video path:", error);
			return { success: false, message: uiText("failedToGetVideoPath"), error: String(error) };
		}
	});

	handleTrustedIpc("set-recording-state", async (_, recording: boolean, discarded?: boolean) => {
		if (recording) {
			resetRecordingMarkers();
			startDiskChecks();
			stopCursorCapture();
			stopInteractionCapture();
			startWindowBoundsCapture();
			void startNativeCursorMonitor();
			setIsCursorCaptureActive(true);
			setActiveCursorSamples([]);
			setPendingCursorSamples([]);
			const captureStartedAt = Date.now();
			setCursorCaptureStartTimeMs(captureStartedAt);
			resetCursorCaptureClock();
			setLinuxCursorScreenPoint(null);
			setLastLeftClick(null);
			sampleCursorPoint();
			const cursorJournalPath = startCursorSampling();
			const keys = startKeystrokeCapture(captureStartedAt);
			const interactionAvailable = startInteractionCapture();
			if (keys && !interactionAvailable) {
				appLog("warn", "keystroke-capture", "Global interaction hook unavailable; recording without keystrokes");
				getHudOverlayWindow()?.webContents.send("recording-keystroke-capture-unavailable");
				void discardKeystrokes().catch(error => console.warn("Could not clear failed keystroke journal:", error));
			}
			if (activeRecoveryStartedAt !== null && windowsNativeCaptureActive) {
				await updateRecordingJournal(activeRecoveryStartedAt, {
					cursorJournalPath,
					keyJournalPath: interactionAvailable ? keys?.journalPath : undefined,
					keyCaptureMode: interactionAvailable ? keys?.mode : undefined,
				}).catch((error) => {
					console.warn("Could not link cursor recovery journal:", error);
				});
			}
		} else {
			stopDiskChecks();
			releaseHeldKeystrokes();
			setIsCursorCaptureActive(false);
			stopCursorCapture();
			stopInteractionCapture();
			stopWindowBoundsCapture();
			stopNativeCursorMonitor();
			setLinuxCursorScreenPoint(null);
			resetCursorCaptureClock();
			snapshotCursorTelemetryForPersistence();
			setActiveCursorSamples([]);
			if (discarded === true) {
				resetRecordingMarkers();
				await discardKeystrokes().catch(error => console.warn("Could not clear discarded keystroke journal:", error));
				setPendingCursorSamples([]);
				await finishCursorJournal().catch((error) => {
					console.warn("Could not clear discarded cursor journal:", error);
				});
			}
		}

		const source = selectedSource || { name: uiText("screen") };
		BrowserWindow.getAllWindows().forEach((window) => {
			if (!window.isDestroyed()) {
				window.webContents.send("recording-state-changed", {
					recording,
					sourceName: source.name,
				});
			}
		});

		if (onRecordingStateChange) {
			onRecordingStateChange(recording, source.name);
		}
	});

	handleTrustedIpc("get-recording-state", event => {
		if (getHudOverlayWindow()?.webContents !== event.sender) return null;
		const backend = windowsNativeCaptureActive ? "native-windows"
			: nativeScreenRecordingActive || ffmpegScreenRecordingActive ? "native-mac"
			: isCursorCaptureActive ? "browser"
			: null;
		return {
			recording: backend !== null,
			backend,
			elapsedMs: isCursorCaptureActive ? getCursorCaptureElapsedMs() : 0,
			paused: isCursorCapturePaused() || windowsCapturePaused || nativeCapturePaused,
			markerCount: getCurrentMarkerCount(),
		};
	});

	handleTrustedIpc("add-recording-marker", (event, kind: unknown) => {
		const hud = getHudOverlayWindow();
		if (!hud || event.sender !== hud.webContents || !isRecordingMarkerKind(kind)) {
			return { success: false };
		}
		return addRecordingMarkerAndNotify(kind, hud);
	});
	handleTrustedIpc("get-recording-markers", async (_event, videoPath?: string) => {
		try {
			const target = normalizeVideoSourcePath(videoPath ?? currentVideoPath);
			const approved = target ? await resolveApprovedLocalMediaPath(target) : null;
			return { success: true, markers: approved ? await readRecordingMarkers(approved) : [] };
		} catch (error) {
			console.warn("Could not read recording markers:", error instanceof SyntaxError ? "Invalid marker JSON." : error);
			return { success: false, markers: [] };
		}
	});

	handleTrustedIpc("pause-cursor-capture", (_, pausedAtMs?: unknown) => {
		pauseCursorCaptureAtBoundary(normalizeRendererTimestampMs(pausedAtMs));
		trimKeystrokesAfter(getCursorCaptureElapsedMs());
		return { success: true };
	});
	handleTrustedIpc("get-recording-keystrokes", async (_event, videoPath?: string) => {
		try {
			const target = normalizeVideoSourcePath(videoPath ?? currentVideoPath);
			const approved = target ? await resolveApprovedLocalMediaPath(target) : null;
			return { success: true, ...(approved ? await readKeystrokes(approved) : { events: [] }) };
		} catch (error) {
			console.warn("Could not read recording keystrokes:", error instanceof SyntaxError ? "Invalid keystroke JSON." : error);
			return { success: false, events: [] };
		}
	});

	handleTrustedIpc("resume-cursor-capture", (_, resumedAtMs?: unknown) => {
		resumeCursorCapture(normalizeRendererTimestampMs(resumedAtMs));
		sampleCursorPoint();
		return { success: true };
	});

	handleTrustedIpc("get-cursor-telemetry", async (_, videoPath?: string) => {
		const targetVideoPath = normalizeVideoSourcePath(videoPath ?? currentVideoPath);
		const approvedPath = targetVideoPath ? await resolveApprovedLocalMediaPath(targetVideoPath) : null;
		if (!approvedPath) {
			return { success: true, samples: [] };
		}

		const telemetryPath = getTelemetryPathForVideo(approvedPath);
		try {
			if (!(await fs.lstat(telemetryPath)).isFile()) return { success: true, samples: [] };
			const content = await fs.readFile(telemetryPath, "utf-8");
			const parsed = parseJsonWithByteOrderMark<unknown>(content);
			const samples = normalizeCursorTelemetrySamples(parsed);

			return { success: true, samples };
		} catch (error) {
			const nodeError = error as NodeJS.ErrnoException;
			if (nodeError.code === "ENOENT") {
				return { success: true, samples: [] };
			}
			console.error("Failed to load cursor telemetry:", error);
			return {
				success: false,
				message: uiText("failedToLoadCursorTelemetry"),
				error: String(error),
				samples: [],
			};
		}
	});

	handleTrustedIpc(
		"set-cursor-telemetry",
		async (_, videoPath: string | undefined, samples: CursorTelemetryPoint[]) => {
			const targetVideoPath = normalizeVideoSourcePath(videoPath ?? currentVideoPath);
			const approvedPath = targetVideoPath ? await resolveApprovedLocalMediaPath(targetVideoPath) : null;
			if (!approvedPath) {
				return {
					success: false,
					samples: [],
					message: uiText("noVideoPathAvailableForCursorTelemetry"),
					error: "Missing or unapproved video path",
				};
			}

			try {
				const telemetryPath = getTelemetryPathForVideo(approvedPath);
				const current = await fs.lstat(telemetryPath).catch(error => {
					if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
					return null;
				});
				if (current && !current.isFile()) throw new Error("Cursor telemetry must be a regular file");
				const normalizedSamples = await writeCursorTelemetry(approvedPath, samples);
				return { success: true, samples: normalizedSamples };
			} catch (error) {
				console.error("Failed to save cursor telemetry:", error);
				return {
					success: false,
					samples: [],
					message: uiText("failedToSaveCursorTelemetry"),
					error: String(error),
				};
			}
		},
	);
}
