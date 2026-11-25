import { contextBridge, ipcRenderer } from "electron";
import type { ExportRoutePlan, NativeStaticExportRoute } from "../src/lib/exporter/backendPolicy";
import type { GifConversionRequest } from "./ipc/export/gif";
import type { RecordingSessionData } from "./ipc/types";
import type { ExportAudioAppendDisposition, ExportAudioAppendResult } from "./ipc/nativeVideoExport";
import type { RendererSettingUpdate, RendererSettingsSnapshot } from "./ipc/register/settings";
import type { RecordingShortcutAction, RecordingShortcutsConfig } from "../src/lib/recordingShortcuts";

let rendererSettings: Map<string, { value: unknown; revision: number }> | undefined;

function applyRendererSettingUpdate({ key, value, revision }: RendererSettingUpdate) {
	const current = rendererSettings?.get(key);
	// A queued update from another window can arrive after a newer synchronous write in this one.
	if (current && current.revision < revision) rendererSettings?.set(key, { value, revision });
}

ipcRenderer.on("app-settings:changed", (_event, update: RendererSettingUpdate) => applyRendererSettingUpdate(update));

function acceptRendererSettingWrite(result: { success?: boolean; update?: RendererSettingUpdate } | null) {
	if (result?.update) applyRendererSettingUpdate(result.update);
	return result?.success === true;
}

let rendererRecoveredPending = false;
let rendererRecoveredListener: (() => void) | null = null;
ipcRenderer.on("renderer-recovered", () => {
	if (rendererRecoveredListener) rendererRecoveredListener();
	else rendererRecoveredPending = true;
});
const pendingRecordingShortcuts: RecordingShortcutAction[] = [];
let recordingShortcutListener: ((action: RecordingShortcutAction) => void) | null = null;
ipcRenderer.on("recording-shortcut", (_event, action: RecordingShortcutAction) => {
	if (recordingShortcutListener) recordingShortcutListener(action);
	else if (pendingRecordingShortcuts.length < 8) pendingRecordingShortcuts.push(action);
});

type NativeVideoExportWriteResult = { success: boolean; error?: string };
type NativeVideoAudioMuxMetrics = {
	tempVideoWriteMs?: number;
	tempEditedAudioWriteMs?: number;
	ffmpegExecMs?: number;
	muxedVideoReadMs?: number;
	tempVideoBytes?: number;
	tempEditedAudioBytes?: number;
	muxedVideoBytes?: number;
};
type WindowsGpuExportSummary = {
	success?: boolean;
	width?: number;
	height?: number;
	fps?: number;
	seconds?: number;
	mediaMs?: number;
	frames?: number;
	cursorOverlay?: boolean;
	zoomOverlay?: boolean;
	adapterVendorId?: number;
	adapterDeviceId?: number;
	adapterDedicatedVideoMemoryMB?: number;
	initializeMs?: number;
	initCoInitializeMs?: number;
	initMfStartupMs?: number;
	initD3DDeviceMs?: number;
	initSourceReaderMs?: number;
	initWebcamReaderMs?: number;
	initVideoProcessorMs?: number;
	initTexturesMs?: number;
	initShaderPipelineMs?: number;
	initSinkWriterMs?: number;
	totalMs?: number;
	readMs?: number;
	clearMs?: number;
	videoProcessMs?: number;
	writeSampleMs?: number;
	finalizeMs?: number;
	realtimeMultiplier?: number;
};
type NativeStaticLayoutChunkMetric = {
	index: number;
	startSec: number;
	durationSec: number;
	backend:
		| "cuda-overlay"
		| "cuda-scale-cpu-pad"
		| "cuda-static-composite"
		| "nvidia-cuda-compositor"
		| "windows-d3d11-compositor";
	elapsedMs: number;
	outputBytes: number;
	fallbackReason?: string;
	windowsGpuSummary?: WindowsGpuExportSummary;
};
type NativeStaticLayoutMetrics = NativeVideoAudioMuxMetrics & {
	chunkCount: number;
	chunkDurationSec: number;
	chunkExecMs: number;
	concatExecMs?: number;
	staticAssetExecMs?: number;
	fallbackChunkCount: number;
	videoOnlyBytes?: number;
	exportRoutePlan?: ExportRoutePlan<NativeStaticExportRoute>;
	exportRoute?: NativeStaticExportRoute;
	chunks: NativeStaticLayoutChunkMetric[];
};
type NativeStaticLayoutProgress = {
	sessionId?: string;
	backend?: NativeStaticLayoutChunkMetric["backend"];
	stage?: "preparing" | "finalizing";
	elapsedMs?: number;
	averageFps?: number;
	currentFrame: number;
	totalFrames: number;
	percentage: number;
};
type NativeVideoMetadataProbe = {
	width: number;
	height: number;
	duration: number;
	mediaStartTime?: number;
	streamStartTime?: number;
	streamDuration?: number;
	frameRate: number;
	codec: string;
	hasAudio: boolean;
	audioCodec?: string;
	audioSampleRate?: number;
};
type NativeExportCapabilities = {
	platform: NodeJS.Platform;
	nvidiaCuda: {
		available: boolean;
		skipReason: string | null;
		hasNvidiaGpu: boolean | null;
		hasWrapper: boolean;
		explicitEnabled: boolean;
		explicitDisabled: boolean;
		userOptInRequired: boolean;
	};
};
type ExportHardwareInfo = {
	platform: NodeJS.Platform;
	release: string;
	arch: string;
	cpuModel: string | null;
	logicalProcessors: number;
	totalMemoryGb: number;
	machineModel: string | null;
	gpus: Array<{
		name: string;
		vendor: string | null;
		active: boolean | null;
	}>;
	gpuFeatures: {
		videoDecode: string | null;
		videoEncode: string | null;
		webgl: string | null;
		webgpu: string | null;
	};
};

const nativeVideoExportWriteRequests = new Map<
	number,
	{
		sessionId: string;
		resolve: (result: NativeVideoExportWriteResult) => void;
	}
>();

let nextNativeVideoExportWriteRequestId = 1;
let nativeVideoExportWriteResultListenerAttached = false;

function ensureNativeVideoExportWriteResultListener() {
	if (nativeVideoExportWriteResultListenerAttached) {
		return;
	}

	nativeVideoExportWriteResultListenerAttached = true;
	ipcRenderer.on(
		"native-video-export-write-frame-result",
		(
			_event,
			payload: {
				sessionId?: string;
				requestId?: number;
				success?: boolean;
				error?: string;
			},
		) => {
			if (typeof payload?.requestId !== "number") {
				return;
			}

			const pendingRequest = nativeVideoExportWriteRequests.get(payload.requestId);
			if (!pendingRequest) {
				return;
			}

			nativeVideoExportWriteRequests.delete(payload.requestId);
			pendingRequest.resolve({
				success: payload.success === true,
				error: payload.error,
			});
		},
	);
}

function settleNativeVideoExportPendingRequests(
	sessionId: string,
	result: NativeVideoExportWriteResult,
) {
	for (const [requestId, pendingRequest] of nativeVideoExportWriteRequests.entries()) {
		if (pendingRequest.sessionId !== sessionId) {
			continue;
		}

		nativeVideoExportWriteRequests.delete(requestId);
		pendingRequest.resolve(result);
	}
}

contextBridge.exposeInMainWorld("electronAPI", {
	hudOverlaySetIgnoreMouse: (ignore: boolean) => {
		ipcRenderer.send("hud-overlay-set-ignore-mouse", ignore);
	},
	getHudOverlayPlacement: () => ipcRenderer.invoke("get-hud-overlay-placement"),
	hudOverlaySetPlacement: (kind: "bar" | "webcam", placement: import("./hudOverlayBounds").HudSavedPlacement) =>
		ipcRenderer.invoke("hud-overlay-set-placement", kind, placement),
	hudOverlayFollowCursorDisplay: () => ipcRenderer.send("hud-overlay-follow-cursor-display"),
	onHudOverlayDisplayChanged: (callback: (payload: import("./hudOverlayBounds").HudDisplayChange) => void) => {
		const listener = (_event: Electron.IpcRendererEvent, payload: import("./hudOverlayBounds").HudDisplayChange) => callback(payload);
		ipcRenderer.on("hud-overlay-display-changed", listener);
		return () => ipcRenderer.removeListener("hud-overlay-display-changed", listener);
	},
	hudOverlaySetSourceSelectionActive: (active: boolean) => {
		ipcRenderer.send("hud-overlay-set-source-selection-active", active);
	},
	hudOverlayDrag: (phase: "start" | "move" | "end", screenX: number, screenY: number) => {
		ipcRenderer.send("hud-overlay-drag", phase, screenX, screenY);
	},
	hudOverlayHide: () => {
		ipcRenderer.send("hud-overlay-hide");
	},
	hudOverlayClose: () => {
		ipcRenderer.send("hud-overlay-close");
	},
	hudOverlayQuitApp: () => {
		ipcRenderer.send("hud-overlay-quit-app");
	},
	getEditorMode: () => ipcRenderer.invoke("get-editor-mode"),
	onEditorModeChanged: (callback: (inEditor: boolean) => void) => {
		const listener = (_event: Electron.IpcRendererEvent, inEditor: boolean) =>
			callback(inEditor);
		ipcRenderer.on("editor-mode-changed", listener);
		return () => ipcRenderer.removeListener("editor-mode-changed", listener);
	},
	hudOverlayRendererReady: () => {
		ipcRenderer.send("hud-overlay-renderer-ready");
	},
	hudOverlaySetWebcamPreviewVisible: (visible: boolean) => {
		ipcRenderer.send("hud-overlay-set-webcam-preview-visible", visible);
	},
	getHudOverlayCaptureProtection: () => {
		return ipcRenderer.invoke("get-hud-overlay-capture-protection");
	},
	getHudOverlayMousePassthroughSupported: () => {
		return ipcRenderer.invoke("get-hud-overlay-mouse-passthrough-supported");
	},
	setHudOverlayCaptureProtection: (enabled: boolean) => {
		return ipcRenderer.invoke("set-hud-overlay-capture-protection", enabled);
	},
	getAssetBasePath: async () => {
		return await ipcRenderer.invoke("get-asset-base-path");
	},
	resolveNativeBundledImagePath: (asset: string): Promise<string | null> =>
		ipcRenderer.invoke("resolve-native-bundled-image-path", asset),
	listLocalFontFamilies: (refresh?: boolean): Promise<string[]> =>
		ipcRenderer.invoke("list-local-font-families", refresh),
	listAssetDirectory: (relativeDir: string) => {
		return ipcRenderer.invoke("list-asset-directory", relativeDir);
	},
	readLocalFile: (filePath: string) => {
		return ipcRenderer.invoke("read-local-file", filePath);
	},
	generateWallpaperThumbnail: (filePath: string) => {
		return ipcRenderer.invoke("generate-wallpaper-thumbnail", filePath);
	},
	probeNativeVideoMetadata: (filePath: string) => {
		return ipcRenderer.invoke("probe-native-video-metadata", filePath) as Promise<{
			success: boolean;
			metadata?: NativeVideoMetadataProbe;
			error?: string;
		}>;
	},
	getNativeExportCapabilities: () => {
		return ipcRenderer.invoke("get-native-export-capabilities") as Promise<{
			success: boolean;
			capabilities?: NativeExportCapabilities;
			error?: string;
		}>;
	},
	getExportHardwareInfo: () => {
		return ipcRenderer.invoke("get-export-hardware-info") as Promise<{
			success: boolean;
			hardware?: ExportHardwareInfo;
			error?: string;
		}>;
	},
	nativeStaticLayoutExport: (options: {
		sessionId?: string;
		inputPath: string;
		width: number;
		height: number;
		frameRate: number;
		bitrate: number;
		encodingMode: "fast" | "balanced" | "quality";
		durationSec: number;
		contentWidth: number;
		contentHeight: number;
		offsetX: number;
		offsetY: number;
		sourceCropX?: number;
		sourceCropY?: number;
		sourceCropWidth?: number;
		sourceCropHeight?: number;
		backgroundColor: string;
		backgroundImagePath?: string | null;
		backgroundBlurPx?: number;
		borderRadius?: number;
		shadowIntensity?: number;
		webcamInputPath?: string | null;
		webcamLeft?: number;
		webcamTop?: number;
		webcamSize?: number;
		webcamRadius?: number;
		webcamShadowIntensity?: number;
		webcamMirror?: boolean;
		webcamTimeOffsetMs?: number;
		cursorTelemetry?: Array<{
			timeMs: number;
			cx: number;
			cy: number;
			cursorTypeIndex?: number;
			bounceScale?: number;
			visible?: boolean;
		}>;
		cursorSize?: number;
		cursorAtlasPngDataUrl?: string | null;
		cursorAtlasEntries?: Array<{
			index: number;
			x: number;
			y: number;
			width: number;
			height: number;
			anchorX: number;
			anchorY: number;
			aspectRatio: number;
		}>;
		zoomTelemetry?: Array<{ timeMs: number; scale: number; x: number; y: number }>;
		timelineSegments?: Array<{
			sourceStartMs: number;
			sourceEndMs: number;
			outputStartMs: number;
			outputEndMs: number;
			speed: number;
		}>;
		chunkDurationSec?: number;
		experimentalWindowsGpuCompositor?: boolean;
		measureGpuStages?: boolean;
		experimentalNvidiaCudaExport?: boolean;
		audioOptions?: {
			audioMode?: "none" | "copy-source" | "trim-source" | "edited-track";
			audioSourcePath?: string | null;
			audioSourceCodec?: string | null;
			audioSourceSampleRate?: number;
			outputDurationSec?: number;
			trimSegments?: Array<{ startMs: number; endMs: number }>;
			editedTrackStrategy?: "filtergraph-fast-path" | "offline-render-fallback";
			editedTrackSegments?: Array<{ startMs: number; endMs: number; speed: number }>;
			editedAudioData?: ArrayBuffer;
			editedAudioMimeType?: string | null;
		};
	}) => {
		return ipcRenderer.invoke("native-static-layout-export", options) as Promise<{
			success: boolean;
			tempPath?: string;
			encoderName?: string;
			error?: string;
			metrics?: NativeStaticLayoutMetrics;
		}>;
	},
	nativeStaticLayoutExportCancel: (sessionId: string) => {
		return ipcRenderer.invoke("native-static-layout-export-cancel", sessionId) as Promise<{
			success: boolean;
		}>;
	},
	onNativeStaticLayoutExportProgress: (
		callback: (progress: NativeStaticLayoutProgress) => void,
	) => {
		const listener = (_event: Electron.IpcRendererEvent, payload: NativeStaticLayoutProgress) =>
			callback(payload);
		ipcRenderer.on("native-static-layout-export-progress", listener);
		return () => ipcRenderer.removeListener("native-static-layout-export-progress", listener);
	},
	nativeVideoExportStart: (options: {
		width: number;
		height: number;
		frameRate: number;
		bitrate: number;
		encodingMode: "fast" | "balanced" | "quality";
	inputMode?: "rawvideo" | "h264-stream" | "mp4-stream";
		videoOnlyIntermediate?: boolean;
		mixedAudio?: { durationSec: number; videoFrameCount: number };
		sourceAudio?: import("./ipc/nativeVideoExport").NativeH264StreamSourceAudioOptions;
		destinationPath?: string;
	}) => {
		return ipcRenderer.invoke("native-video-export-start", options);
	},
	nativeVideoExportWriteWav: (sessionId: string, chunk: Uint8Array | null): Promise<NativeVideoExportWriteResult> =>
		ipcRenderer.invoke("native-video-export-write-wav", sessionId, chunk),
	nativeVideoExportEndVideoInput: (sessionId: string): Promise<NativeVideoExportWriteResult> =>
		ipcRenderer.invoke("native-video-export-end-video-input", sessionId),
	nativeVideoExportWriteFrame: (sessionId: string, frameData: Uint8Array) => {
		ensureNativeVideoExportWriteResultListener();

		return new Promise<NativeVideoExportWriteResult>((resolve) => {
			const requestId = nextNativeVideoExportWriteRequestId++;
			nativeVideoExportWriteRequests.set(requestId, {
				sessionId,
				resolve,
			});

			ipcRenderer.send("native-video-export-write-frame-async", {
				sessionId,
				requestId,
				frameData,
			});
		});
	},
	nativeVideoExportWriteFrames: (sessionId: string, frameDataList: Uint8Array[]) => {
		ensureNativeVideoExportWriteResultListener();

		return new Promise<NativeVideoExportWriteResult>((resolve) => {
			const requestId = nextNativeVideoExportWriteRequestId++;
			nativeVideoExportWriteRequests.set(requestId, {
				sessionId,
				resolve,
			});

			ipcRenderer.send("native-video-export-write-frames-async", {
				sessionId,
				requestId,
				frameDataList,
			});
		});
	},
	nativeVideoExportFinish: (
		sessionId: string,
		options?: {
			audioMode?: "none" | "copy-source" | "trim-source" | "edited-track";
			audioSourcePath?: string | null;
			audioSourceCodec?: string | null;
			audioSourceSampleRate?: number;
			outputDurationSec?: number;
			outputVideoFrameCount?: number;
			trimSegments?: Array<{ startMs: number; endMs: number }>;
			editedTrackStrategy?: "filtergraph-fast-path" | "offline-render-fallback";
			editedTrackSegments?: Array<{ startMs: number; endMs: number; speed: number }>;
			editedAudioData?: ArrayBuffer;
			editedAudioMimeType?: string | null;
		},
	) => {
		return ipcRenderer
			.invoke("native-video-export-finish", sessionId, options)
			.then((result) => {
				settleNativeVideoExportPendingRequests(
					sessionId,
					result?.success
						? { success: true }
						: {
								success: false,
								error:
									typeof result?.error === "string"
										? result.error
										: "Native video export session finished before all frame writes settled.",
							},
				);

				return result;
			}) as Promise<{
			success: boolean;
			data?: Uint8Array;
			encoderName?: string;
			error?: string;
			metrics?: NativeVideoAudioMuxMetrics;
		}>;
	},
	nativeVideoExportCancel: (sessionId: string) => {
		return ipcRenderer.invoke("native-video-export-cancel", sessionId).finally(() => {
			settleNativeVideoExportPendingRequests(sessionId, {
				success: false,
				error: "Native video export session was cancelled",
			});
		});
	},
	muxExportedVideoAudio: (
		videoData: ArrayBuffer,
		options?: {
			audioMode?: "none" | "copy-source" | "trim-source" | "edited-track";
			audioSourcePath?: string | null;
			audioSourceCodec?: string | null;
			audioSourceSampleRate?: number;
			outputDurationSec?: number;
			outputVideoFrameCount?: number;
			trimSegments?: Array<{ startMs: number; endMs: number }>;
			editedTrackStrategy?: "filtergraph-fast-path" | "offline-render-fallback";
			editedTrackSegments?: Array<{ startMs: number; endMs: number; speed: number }>;
			editedAudioData?: ArrayBuffer;
			editedAudioMimeType?: string | null;
		},
	) => {
		return ipcRenderer.invoke("mux-exported-video-audio", videoData, options) as Promise<{
			success: boolean;
			tempPath?: string;
			error?: string;
			metrics?: NativeVideoAudioMuxMetrics;
		}>;
	},
	muxExportedVideoAudioFromPath: (
		videoPath: string,
		options?: {
			audioMode?: "none" | "copy-source" | "trim-source" | "edited-track";
			audioSourcePath?: string | null;
			audioSourceCodec?: string | null;
			audioSourceSampleRate?: number;
			outputDurationSec?: number;
			outputVideoFrameCount?: number;
			reuseVideoMp4?: boolean;
			trimSegments?: Array<{ startMs: number; endMs: number }>;
			editedTrackStrategy?: "filtergraph-fast-path" | "offline-render-fallback";
			editedTrackSegments?: Array<{ startMs: number; endMs: number; speed: number }>;
			editedAudioData?: ArrayBuffer;
			editedAudioMimeType?: string | null;
		},
	) => {
		return ipcRenderer.invoke("mux-exported-video-audio-from-path", videoPath, options);
	},
	openExportStream: (options?: { extension?: string; destinationPath?: string }) => {
		return ipcRenderer.invoke("export-stream-open", options);
	},
	startExportAudioAppend: (videoPath: string, durationSec: number): Promise<NativeVideoExportWriteResult & { runId?: string }> =>
		ipcRenderer.invoke("start-export-audio-append", videoPath, durationSec),
	writeExportAudioAppend: (runId: string, chunk: Uint8Array): Promise<NativeVideoExportWriteResult> =>
		ipcRenderer.invoke("write-export-audio-append", runId, chunk),
	finishExportAudioAppend: (runId: string, disposition: ExportAudioAppendDisposition): Promise<ExportAudioAppendResult> =>
		ipcRenderer.invoke("finish-export-audio-append", runId, disposition),
	openExportAacStream: () => ipcRenderer.invoke("export-stream-open", { mode: "aac-from-wav" }),
	writeExportStreamChunk: (streamId: string, position: number, chunk: Uint8Array) => {
		return ipcRenderer.invoke("export-stream-write", streamId, position, chunk);
	},
	closeExportStream: (streamId: string, options?: { abort?: boolean }) => {
		return ipcRenderer.invoke("export-stream-close", streamId, options);
	},
	finalizeExportedVideo: (payload: {
		tempPath: string;
		fileName: string;
		outputPath?: string | null;
		captionSidecar?: {
			format: "srt" | "vtt" | "both";
			cues: Array<{
				startMs: number;
				endMs: number;
				text: string;
			}>;
		};
	}) => {
		return ipcRenderer.invoke("finalize-exported-video", payload);
	},
	discardExportedTemp: (tempPath: string) => {
		return ipcRenderer.invoke("discard-exported-temp", tempPath);
	},
	getVideoAudioFallbackPaths: (videoPath: string) => {
		return ipcRenderer.invoke("get-video-audio-fallback-paths", videoPath);
	},
	getSources: async (opts: Electron.SourcesOptions) => {
		return await ipcRenderer.invoke("get-sources", opts);
	},
	onCaptureSourceListFailed: (callback: () => void) => {
		const channel = "capture-source-list-failed";
		const listener = () => callback();
		ipcRenderer.on(channel, listener);
		return () => { ipcRenderer.removeListener(channel, listener); };
	},
	showRecordingHud: () => ipcRenderer.invoke("show-recording-hud"),
	createProjectFile: (data: unknown, thumbnail?: string | null) =>
		ipcRenderer.invoke("create-project-file", data, thumbnail),
	renameLibraryProject: (path: string, name: string) =>
		ipcRenderer.invoke("rename-library-project", path, name),
	convertLegacyProjectFiles: (): Promise<{
		converted: Array<{ from: string; to: string }>;
		errors: Array<{ path: string; message: string }>;
	}> => ipcRenderer.invoke("convert-legacy-project-files"),
	trashProjectFiles: (paths: string[]) => ipcRenderer.invoke("trash-project-files", paths),
	showProjectDashboard: () => ipcRenderer.invoke("show-project-dashboard"),
	switchToEditor: () => {
		return ipcRenderer.invoke("switch-to-editor");
	},
	generateWaveformPeaks: (filePath: string, requestId: number) =>
		ipcRenderer.invoke("generate-waveform-peaks", filePath, requestId),
	onWaveformPeaksProgress: (callback: (data: { requestId: number; ratio: number }) => void) => {
		const listener = (_event: Electron.IpcRendererEvent, data: { requestId: number; ratio: number }) => callback(data);
		ipcRenderer.on("waveform-peaks-progress", listener);
		return () => ipcRenderer.removeListener("waveform-peaks-progress", listener);
	},
	openSourceSelector: () => {
		return ipcRenderer.invoke("open-source-selector");
	},
	selectSource: (source: ProcessedDesktopSource) => {
		return ipcRenderer.invoke("select-source", source);
	},
	showSourceHighlight: (source: ProcessedDesktopSource) => {
		return ipcRenderer.invoke("show-source-highlight", source);
	},
	getSelectedSource: () => {
		return ipcRenderer.invoke("get-selected-source");
	},
	onSelectedSourceChanged: (callback: (source: ProcessedDesktopSource | null) => void) => {
		const listener = (
			_event: Electron.IpcRendererEvent,
			payload: ProcessedDesktopSource | null,
		) => callback(payload);
		ipcRenderer.on("selected-source-changed", listener);
		return () => ipcRenderer.removeListener("selected-source-changed", listener);
	},
	startNativeScreenRecording: (
		source: ProcessedDesktopSource,
		options?: {
			capturesSystemAudio?: boolean;
			capturesMicrophone?: boolean;
			microphoneDeviceId?: string;
			microphoneLabel?: string;
		},
	) => {
		return ipcRenderer.invoke("start-native-screen-recording", source, options);
	},
	stopNativeScreenRecording: (discard?: boolean) => {
		return ipcRenderer.invoke("stop-native-screen-recording", discard);
	},
	recoverNativeScreenRecording: () => {
		return ipcRenderer.invoke("recover-native-screen-recording");
	},
	getLastNativeCaptureDiagnostics: () => {
		return ipcRenderer.invoke("get-last-native-capture-diagnostics");
	},
	pauseNativeScreenRecording: () => {
		return ipcRenderer.invoke("pause-native-screen-recording");
	},
	resumeNativeScreenRecording: () => {
		return ipcRenderer.invoke("resume-native-screen-recording");
	},
	pauseCursorCapture: (pausedAtMs?: number) => {
		return ipcRenderer.invoke("pause-cursor-capture", pausedAtMs);
	},
	resumeCursorCapture: (resumedAtMs?: number) => {
		return ipcRenderer.invoke("resume-cursor-capture", resumedAtMs);
	},
	startFfmpegRecording: (source: ProcessedDesktopSource) => {
		return ipcRenderer.invoke("start-ffmpeg-recording", source);
	},
	stopFfmpegRecording: () => {
		return ipcRenderer.invoke("stop-ffmpeg-recording");
	},
	writeWebcamChunk: (name: string, data: ArrayBuffer, first: boolean) =>
		ipcRenderer.invoke("webcam-write", name, data, first),
	finishWebcamFile: (name: string, discard: boolean) =>
		ipcRenderer.invoke("webcam-finish", name, discard),
	writeRecordingChunk: (name: string, data: ArrayBuffer, first: boolean) => ipcRenderer.invoke("recording-write", name, data, first),
	finishRecordingChunks: (name: string, discard: boolean) => ipcRenderer.invoke("recording-finish", name, discard),
	recoverBrowserRecording: () => ipcRenderer.invoke("recover-browser-recording"),
	storeRecordedVideo: (videoData: ArrayBuffer, fileName: string) => {
		return ipcRenderer.invoke("store-recorded-video", videoData, fileName);
	},
	prepareMicrophoneStream: (input: { startDelayMs: number; profile?: string }) =>
		ipcRenderer.invoke("prepare-microphone-stream", input),
	writeMicrophoneChunk: (streamId: string, bytes: ArrayBuffer) =>
		ipcRenderer.invoke("write-microphone-chunk", streamId, bytes),
	discardMicrophoneStream: (streamId: string) =>
		ipcRenderer.invoke("discard-microphone-stream", streamId),
	storeMicrophoneSidecar: (
		streamId: string,
		videoPath: string,
		options?: {
			startDelayMs?: number;
			browserMicrophoneProfile?: string;
			requestedBrowserMicrophoneProfile?: string | null;
			requestedConstraints?: unknown;
			mediaTrackSettings?: Record<string, boolean | number | string>;
			audioInputDevices?: Array<{
				deviceId: string;
				groupId?: string;
				label: string;
			}>;
			mediaRecorder?: {
				mimeType?: string;
				audioBitsPerSecond?: number;
				timesliceMs?: number;
			};
			chunkEvents?: Array<{
				index: number;
				size: number;
				elapsedMs: number;
				deltaMs: number | null;
			}>;
		},
	) => {
		return ipcRenderer.invoke("store-microphone-sidecar", streamId, videoPath, options);
	},
	getRecordedVideoPath: () => {
		return ipcRenderer.invoke("get-recorded-video-path");
	},
	getInterruptedRecording: () => ipcRenderer.invoke("get-interrupted-recording"),
	recoverInterruptedRecording: (startedAt: number) => ipcRenderer.invoke("recover-interrupted-recording", startedAt),
	discardInterruptedRecording: (startedAt: number) => ipcRenderer.invoke("discard-interrupted-recording", startedAt),
	setRecordingState: (recording: boolean, discarded?: boolean) => {
		return ipcRenderer.invoke("set-recording-state", recording, discarded);
	},
	getRecordingDiskStatus: () => ipcRenderer.invoke("get-recording-disk-status"),
	getRecordingState: () => ipcRenderer.invoke("get-recording-state"),
	getLiveAnnotationState: () => ipcRenderer.invoke("get-live-annotation-state"),
	toggleLiveAnnotation: () => ipcRenderer.invoke("toggle-live-annotation"),
	setLiveAnnotationTool: (options: import("../src/components/live-annotation/liveAnnotationModel").LiveAnnotationOptions) =>
		ipcRenderer.invoke("live-annotation-set-tool", options),
	sendLiveAnnotationCommand: (command: import("../src/components/live-annotation/liveAnnotationModel").LiveAnnotationCommand) =>
		ipcRenderer.invoke("live-annotation-command", command),
	setLiveAnnotationTextFocus: (focused: boolean) => ipcRenderer.invoke("live-annotation-text-focus", focused),
	liveAnnotationCanvasReady: () => ipcRenderer.send("live-annotation-canvas-ready"),
	onLiveAnnotationStateChanged: (callback: (state: import("../src/components/live-annotation/liveAnnotationModel").LiveAnnotationStatus) => void) => {
		const listener = (_event: Electron.IpcRendererEvent, state: Parameters<typeof callback>[0]) => callback(state);
		ipcRenderer.on("live-annotation-state-changed", listener);
		return () => ipcRenderer.removeListener("live-annotation-state-changed", listener);
	},
	onLiveAnnotationOptions: (callback: (options: import("../src/components/live-annotation/liveAnnotationModel").LiveAnnotationOptions) => void) => {
		const listener = (_event: Electron.IpcRendererEvent, options: Parameters<typeof callback>[0]) => callback(options);
		ipcRenderer.on("live-annotation-options", listener);
		return () => ipcRenderer.removeListener("live-annotation-options", listener);
	},
	onLiveAnnotationCommand: (callback: (command: import("../src/components/live-annotation/liveAnnotationModel").LiveAnnotationCommand) => void) => {
		const listener = (_event: Electron.IpcRendererEvent, command: Parameters<typeof callback>[0]) => callback(command);
		ipcRenderer.on("live-annotation-command", listener);
		return () => ipcRenderer.removeListener("live-annotation-command", listener);
	},
	addRecordingMarker: (kind: import("./ipc/types").RecordingMarkerKind) =>
		ipcRenderer.invoke("add-recording-marker", kind),
	getRecordingMarkers: (videoPath?: string) => ipcRenderer.invoke("get-recording-markers", videoPath),
	getRecordingKeystrokes: (videoPath?: string) => ipcRenderer.invoke("get-recording-keystrokes", videoPath),
	onRecordingKeystrokeCaptureUnavailable: (callback: () => void) => {
		const channel = "recording-keystroke-capture-unavailable";
		const listener = () => callback();
		ipcRenderer.on(channel, listener);
		return () => ipcRenderer.removeListener(channel, listener);
	},
	onRecordingKeystrokeCaptureChanged: (callback: (paused: boolean) => void) => {
		const listener = (_event: Electron.IpcRendererEvent, paused: boolean) => callback(paused);
		ipcRenderer.on("recording-keystroke-capture-changed", listener);
		return () => ipcRenderer.removeListener("recording-keystroke-capture-changed", listener);
	},
	onRecordingMarkerAdded: (callback: (marker: import("./ipc/types").RecordingMarkerAdded) => void) => {
		const listener = (_event: Electron.IpcRendererEvent, marker: import("./ipc/types").RecordingMarkerAdded) => callback(marker);
		ipcRenderer.on("recording-marker-added", listener);
		return () => ipcRenderer.removeListener("recording-marker-added", listener);
	},
	setRecordingPaused: (paused: boolean) => ipcRenderer.send("recording-paused-changed", paused),
	onRecordingShortcut: (callback: (action: RecordingShortcutAction) => void) => {
		recordingShortcutListener = callback;
		for (const action of pendingRecordingShortcuts.splice(0)) callback(action);
		return () => { if (recordingShortcutListener === callback) recordingShortcutListener = null; };
	},
	onRecordingDiskLow: (callback: (status: import("./ipc/recording/diskEstimate").RecordingDiskStatus) => void) => {
		const listener = (_event: Electron.IpcRendererEvent, status: import("./ipc/recording/diskEstimate").RecordingDiskStatus) => callback(status);
		ipcRenderer.on("recording-disk-low", listener);
		return () => ipcRenderer.removeListener("recording-disk-low", listener);
	},
	onRecordingFinalization: (callback: (status: import("./ipc/types").NativeRecordingFinalization) => void) => {
		const channel = "recording-finalization";
		const listener = (_event: Electron.IpcRendererEvent, status: Parameters<typeof callback>[0]) => callback(status);
		ipcRenderer.on(channel, listener);
		return () => ipcRenderer.removeListener(channel, listener);
	},
	setCursorScale: (scale: number) => {
		return ipcRenderer.invoke("set-cursor-scale", scale);
	},
	getCursorTelemetry: (videoPath?: string) => {
		return ipcRenderer.invoke("get-cursor-telemetry", videoPath);
	},
	setCursorTelemetry: (videoPath: string | undefined, samples: CursorTelemetryPoint[]) => {
		return ipcRenderer.invoke("set-cursor-telemetry", videoPath, samples);
	},
	getSystemCursorAssets: () => {
		return ipcRenderer.invoke("get-system-cursor-assets");
	},
	onStopRecordingFromTray: (callback: () => void) => {
		const listener = () => callback();
		ipcRenderer.on("stop-recording-from-tray", listener);
		return () => ipcRenderer.removeListener("stop-recording-from-tray", listener);
	},
	onRecordingStateChanged: (
		callback: (state: { recording: boolean; sourceName: string }) => void,
	) => {
		const listener = (
			_event: Electron.IpcRendererEvent,
			payload: { recording: boolean; sourceName: string },
		) => callback(payload);
		ipcRenderer.on("recording-state-changed", listener);
		return () => ipcRenderer.removeListener("recording-state-changed", listener);
	},
	onRecordingAudioLost: (callback: (track: "mic" | "system") => void) => {
		const listener = (_event: unknown, track: "mic" | "system") => callback(track);
		ipcRenderer.on("recording-audio-lost", listener);
		return () => ipcRenderer.removeListener("recording-audio-lost", listener);
	},
	onRecordingInterrupted: (callback: (state: { reason: string; message: string }) => void) => {
		const listener = (
			_event: Electron.IpcRendererEvent,
			payload: { reason: string; message: string },
		) => callback(payload);
		ipcRenderer.on("recording-interrupted", listener);
		return () => ipcRenderer.removeListener("recording-interrupted", listener);
	},
	onCursorStateChanged: (
		callback: (state: { cursorType: CursorTelemetryPoint["cursorType"] }) => void,
	) => {
		const listener = (
			_event: Electron.IpcRendererEvent,
			payload: { cursorType: CursorTelemetryPoint["cursorType"] },
		) => callback(payload);
		ipcRenderer.on("cursor-state-changed", listener);
		return () => ipcRenderer.removeListener("cursor-state-changed", listener);
	},
	openExternalUrl: (url: string) => {
		return ipcRenderer.invoke("open-external-url", url);
	},
	getAccessibilityPermissionStatus: () => {
		return ipcRenderer.invoke("get-accessibility-permission-status");
	},
	requestAccessibilityPermission: () => {
		return ipcRenderer.invoke("request-accessibility-permission");
	},
	getScreenRecordingPermissionStatus: () => {
		return ipcRenderer.invoke("get-screen-recording-permission-status");
	},
	openScreenRecordingPreferences: () => {
		return ipcRenderer.invoke("open-screen-recording-preferences");
	},
	openAccessibilityPreferences: () => {
		return ipcRenderer.invoke("open-accessibility-preferences");
	},
	saveExportedVideo: (
		videoData: ArrayBuffer,
		fileName: string,
		captionSidecar?: {
			format: "srt" | "vtt" | "both";
			cues: Array<{
				startMs: number;
				endMs: number;
				text: string;
			}>;
		},
	) => {
		return ipcRenderer.invoke("save-exported-video", videoData, fileName, captionSidecar);
	},
	chooseExportPath: (fileName: string) => ipcRenderer.invoke("choose-export-path", fileName),
	captureExportPreview: (rect: { x: number; y: number; width: number; height: number }) =>
		ipcRenderer.invoke("capture-export-preview", rect),
	getExportDiskSpace: (outputPath: string) => ipcRenderer.invoke("get-export-disk-space", outputPath),
	prepareExportAudioSource: (filePath: string) =>
		ipcRenderer.invoke("prepare-export-audio-source", filePath),
	prepareExportAudioPcm: (filePath: string, window?: { startSec: number; endSec: number }, useMemoryWindows?: boolean) =>
		ipcRenderer.invoke("prepare-export-audio-pcm", filePath, window, useMemoryWindows),
	openExportAudioPcmReader: () => ipcRenderer.invoke("open-export-audio-pcm-reader"),
	closeExportAudioPcmReader: (readerId: string) => ipcRenderer.invoke("close-export-audio-pcm-reader", readerId),
	readExportAudioPcmWindow: (filePath: string, window: { firstFrame: number; endFrame: number; channels: number; sampleRate: number }, readerId?: string) =>
		ipcRenderer.invoke("read-export-audio-pcm-window", filePath, window, readerId),
	cancelExportAudioPcm: () => ipcRenderer.invoke("cancel-export-audio-pcm"),
	encodeExportAudioAac: (filePath: string): Promise<string | null> => ipcRenderer.invoke("encode-export-audio-aac", filePath),
	writeExportedVideoToPath: (
		videoData: ArrayBuffer,
		outputPath: string,
		captionSidecar?: {
			format: "srt" | "vtt" | "both";
			cues: Array<{
				startMs: number;
				endMs: number;
				text: string;
			}>;
		},
	) => {
		return ipcRenderer.invoke(
			"write-exported-video-to-path",
			videoData,
			outputPath,
			captionSidecar,
		);
	},
	openVideoFilePicker: (options?: { includeProjects?: boolean }) => {
		return ipcRenderer.invoke("open-video-file-picker", options);
	},
	openAudioFilePicker: () => {
		return ipcRenderer.invoke("open-audio-file-picker");
	},
	openWhisperExecutablePicker: () => {
		return ipcRenderer.invoke("open-whisper-executable-picker");
	},
	openWhisperModelPicker: () => {
		return ipcRenderer.invoke("open-whisper-model-picker");
	},
	getWhisperSmallModelStatus: () => {
		return ipcRenderer.invoke("get-whisper-small-model-status");
	},
	downloadWhisperSmallModel: () => {
		return ipcRenderer.invoke("download-whisper-small-model");
	},
	cancelWhisperModelDownload: () => ipcRenderer.invoke("cancel-whisper-model-download"),
	deleteWhisperSmallModel: () => {
		return ipcRenderer.invoke("delete-whisper-small-model");
	},
	onWhisperSmallModelDownloadProgress: (
		callback: (state: {
			status: "idle" | "downloading" | "downloaded" | "error";
			progress: number;
			path?: string | null;
			error?: string;
		}) => void,
	) => {
		const listener = (
			_event: Electron.IpcRendererEvent,
			payload: {
				status: "idle" | "downloading" | "downloaded" | "error";
				progress: number;
				path?: string | null;
				error?: string;
			},
		) => callback(payload);
		ipcRenderer.on("whisper-small-model-download-progress", listener);
		return () => ipcRenderer.removeListener("whisper-small-model-download-progress", listener);
	},
	importSrtCaptions: (options?: { title?: string }) => ipcRenderer.invoke("import-srt-captions", options),
	importTranscriptFile: () => ipcRenderer.invoke("import-transcript-file"),
	rebuildCaptionsFromTranscript: (transcript: import("../src/components/video-editor/transcript").ProjectTranscript) =>
		ipcRenderer.invoke("rebuild-captions-from-transcript", transcript),
	generateAutoCaptions: (options: {
		videoPath: string;
		whisperExecutablePath?: string;
		whisperModelPath: string;
		language?: string;
	}) => {
		return ipcRenderer.invoke("generate-auto-captions", options);
	},
	cancelAutoCaptions: () => ipcRenderer.invoke("cancel-auto-captions"),
	onAutoCaptionProgress: (callback: (progress: number) => void) => {
		const listener = (_event: unknown, progress: number) => callback(progress);
		ipcRenderer.on("auto-caption-progress", listener);
		return () => ipcRenderer.removeListener("auto-caption-progress", listener);
	},
	setCurrentVideoPath: (
		path: string,
		options?: {
			preserveProjectPath?: boolean;
			hideOverlayCursorByDefault?: boolean;
		},
	) => {
		return ipcRenderer.invoke("set-current-video-path", path, options);
	},
	setCurrentRecordingSession: (
		session: {
			videoPath: string;
			webcamPath?: string | null;
			timeOffsetMs?: number;
			hideOverlayCursorByDefault?: boolean;
		},
		options?: { preserveProjectPath?: boolean; background?: "camera" | "audio" },
	) => {
		return ipcRenderer.invoke("set-current-recording-session", session, options);
	},
	onRecordingSessionChanged: (callback: (session: RecordingSessionData | null, background?: "camera" | "audio") => void) => {
		const listener = (
			_event: Electron.IpcRendererEvent,
			payload: RecordingSessionData | null,
			background?: "camera" | "audio",
		) => callback(payload, background);
		ipcRenderer.on("recording-session-changed", listener);
		return () => ipcRenderer.removeListener("recording-session-changed", listener);
	},
	getCurrentRecordingSession: () => {
		return ipcRenderer.invoke("get-current-recording-session");
	},
	getCurrentVideoPath: () => {
		return ipcRenderer.invoke("get-current-video-path");
	},
	clearCurrentVideoPath: () => {
		return ipcRenderer.invoke("clear-current-video-path");
	},
	getRecordingThumbnail: (filePath: string) =>
		ipcRenderer.invoke("get-recording-thumbnail", filePath),
	finishRecordingImport: (keepPath: string, commit?: boolean) =>
		ipcRenderer.invoke("finish-recording-import", keepPath, commit),
	cancelRecordingImport: () => ipcRenderer.invoke("cancel-recording-import"),
	getProjectPreview: (projectPath: string) =>
		ipcRenderer.invoke("get-project-preview", projectPath),
	listRecordings: (includeSources?: boolean) =>
		ipcRenderer.invoke("list-recordings", includeSources),
	setRecordingsRemoved: (paths: string[], removed: boolean) =>
		ipcRenderer.invoke("set-recordings-removed", paths, removed),
	importRecording: (
		currentPath: string,
		recordingPath: string,
		webcam?: import("../src/types/recordingLibrary").RecordingWebcamSource,
	) => ipcRenderer.invoke("import-recording", currentPath, recordingPath, webcam),
	deleteRecordingFile: (filePath: string) => {
		return ipcRenderer.invoke("delete-recording-file", filePath);
	},
	getLocalMediaUrl: (filePath: string) => {
		return ipcRenderer.invoke("get-local-media-url", filePath) as Promise<
			{ success: true; url: string } | { success: false }
		>;
	},
	saveProjectFile: (
		projectData: unknown,
		suggestedName?: string,
		existingProjectPath?: string,
		thumbnailDataUrl?: string | null,
		expectedRevision?: string,
	) => {
		return ipcRenderer.invoke(
			"save-project-file",
			projectData,
			suggestedName,
			existingProjectPath,
			thumbnailDataUrl,
			expectedRevision,
		);
	},
	saveProjectFileNamed: (
		projectData: unknown,
		projectName: string,
		thumbnailDataUrl?: string | null,
		mode?: "rename" | "copy",
		expectedRevision?: string,
	) => {
		return ipcRenderer.invoke(
			"save-project-file-named",
			projectData,
			projectName,
			thumbnailDataUrl,
			mode,
			expectedRevision,
		);
	},
	loadProjectFile: () => {
		return ipcRenderer.invoke("load-project-file");
	},
	saveCutReviewHandoff: (markdown: string, projectName: string) =>
		ipcRenderer.invoke("save-cut-review-handoff", markdown, projectName),
	loadCurrentProjectFile: () => {
		return ipcRenderer.invoke("load-current-project-file");
	},
	pickRelinkMedia: (kind: import("../src/components/video-editor/projectRelink").ProjectMediaKind) =>
		ipcRenderer.invoke("pick-relink-media", kind),
	pickRelinkMediaFolder: () => ipcRenderer.invoke("pick-relink-media-folder"),
	matchMediaInFolder: (folder: string, basenames: string[]) =>
		ipcRenderer.invoke("match-media-in-folder", folder, basenames),
	relinkProjectMedia: (projectPath: string, revision: string, mapping: import("../src/components/video-editor/projectRelink").MediaRelinkMapping) =>
		ipcRenderer.invoke("relink-project-media", projectPath, revision, mapping),
	releaseCurrentProject: () => ipcRenderer.invoke("release-current-project"),
	setProjectAgentHandoff: (projectPath: string, handedOff: boolean) =>
		ipcRenderer.invoke("set-project-agent-handoff", projectPath, handedOff),
	listProjectVersions: () => ipcRenderer.invoke("list-project-versions"),
	readProjectVersion: (versionPath: string) => ipcRenderer.invoke("read-project-version", versionPath),
	restoreProjectVersion: (versionPath: string, expectedRevision?: string) =>
		ipcRenderer.invoke("restore-project-version", versionPath, expectedRevision),
	deleteProjectVersion: (versionPath: string) => ipcRenderer.invoke("delete-project-version", versionPath),
	pruneProjectVersions: () => ipcRenderer.invoke("prune-project-versions"),
	getProjectsDirectory: () => {
		return ipcRenderer.invoke("get-projects-directory");
	},
	onProjectThumbnailReady: (
		callback: (ready: { path: string; thumbnailPath: string; updatedAt: number }) => void,
	) => {
		const listener = (
			_event: Electron.IpcRendererEvent,
			ready: { path: string; thumbnailPath: string; updatedAt: number },
		) => callback(ready);
		ipcRenderer.on("project-library-thumbnail-ready", listener);
		return () => ipcRenderer.removeListener("project-library-thumbnail-ready", listener);
	},
	listProjectFiles: () => {
		return ipcRenderer.invoke("list-project-files");
	},
	openProjectFileAtPath: (filePath: string, includeAgentHistory?: boolean) => {
		return ipcRenderer.invoke("open-project-file-at-path", filePath, includeAgentHistory);
	},
	openProjectsDirectory: () => {
		return ipcRenderer.invoke("open-projects-directory");
	},
	installDownloadedUpdate: () => {
		return ipcRenderer.invoke("install-downloaded-update");
	},
	downloadAvailableUpdate: (installAfterDownload?: boolean) => {
		return ipcRenderer.invoke("download-available-update", installAfterDownload);
	},
	deferDownloadedUpdate: (delayMs?: number) => {
		return ipcRenderer.invoke("defer-downloaded-update", delayMs);
	},
	dismissUpdateToast: () => {
		return ipcRenderer.invoke("dismiss-update-toast");
	},
	skipUpdateVersion: () => {
		return ipcRenderer.invoke("skip-update-version");
	},
	getCurrentUpdateToastPayload: () => {
		return ipcRenderer.invoke("get-current-update-toast-payload");
	},
	getUpdateStatusSummary: () => {
		return ipcRenderer.invoke("get-update-status-summary");
	},
	getExperimentalUpdatesEnabled: () => {
		return ipcRenderer.invoke("get-experimental-updates-enabled");
	},
	setExperimentalUpdatesEnabled: (enabled: boolean) => {
		return ipcRenderer.invoke("set-experimental-updates-enabled", enabled);
	},
	previewUpdateToast: () => {
		return ipcRenderer.invoke("preview-update-toast");
	},
	checkForAppUpdates: () => {
		return ipcRenderer.invoke("check-for-app-updates");
	},
	onUpdateToastStateChanged: (
		callback: (
			payload: {
				version: string;
				detail: string;
				phase: "available" | "downloading" | "ready" | "error";
				delayMs: number;
				isPreview?: boolean;
				progressPercent?: number;
				transferredBytes?: number;
				totalBytes?: number;
				remainingBytes?: number;
				bytesPerSecond?: number;
				primaryAction?: "install-and-restart" | "retry-check";
			} | null,
		) => void,
	) => {
		const listener = (
			_event: Electron.IpcRendererEvent,
			payload: {
				version: string;
				detail: string;
				phase: "available" | "downloading" | "ready" | "error";
				delayMs: number;
				isPreview?: boolean;
				progressPercent?: number;
				transferredBytes?: number;
				totalBytes?: number;
				remainingBytes?: number;
				bytesPerSecond?: number;
				primaryAction?: "install-and-restart" | "retry-check";
			} | null,
		) => callback(payload);
		ipcRenderer.on("update-toast-state", listener);
		return () => ipcRenderer.removeListener("update-toast-state", listener);
	},
	onUpdateReadyToast: (
		callback: (payload: {
			version: string;
			detail: string;
			delayMs: number;
			isPreview?: boolean;
		}) => void,
	) => {
		const listener = (
			_event: Electron.IpcRendererEvent,
			payload: { version: string; detail: string; delayMs: number; isPreview?: boolean },
		) => callback(payload);
		ipcRenderer.on("update-ready-toast", listener);
		return () => ipcRenderer.removeListener("update-ready-toast", listener);
	},
	onMenuLoadProject: (callback: () => void) => {
		const listener = () => callback();
		ipcRenderer.on("menu-load-project", listener);
		return () => ipcRenderer.removeListener("menu-load-project", listener);
	},
	onMenuSaveProject: (callback: () => void) => {
		const listener = () => callback();
		ipcRenderer.on("menu-save-project", listener);
		return () => ipcRenderer.removeListener("menu-save-project", listener);
	},
	onMenuSaveProjectAs: (callback: () => void) => {
		const listener = () => callback();
		ipcRenderer.on("menu-save-project-as", listener);
		return () => ipcRenderer.removeListener("menu-save-project-as", listener);
	},
	getWindowChrome: () => ipcRenderer.invoke("get-window-chrome"),
	onWindowChromeChanged: (callback: (chrome: { trafficLightsVisible: boolean }) => void) => {
		const listener = (
			_event: Electron.IpcRendererEvent,
			chrome: { trafficLightsVisible: boolean },
		) => callback(chrome);
		ipcRenderer.on("window-chrome-changed", listener);
		return () => ipcRenderer.removeListener("window-chrome-changed", listener);
	},
	getPlatform: () => {
		return ipcRenderer.invoke("get-platform");
	},
	isWindowFullscreen: () => {
		return ipcRenderer.invoke("get-window-fullscreen");
	},
	onWindowFullscreenChanged: (callback: (isFullscreen: boolean) => void) => {
		const listener = (_event: Electron.IpcRendererEvent, isFullscreen: boolean) =>
			callback(isFullscreen);
		ipcRenderer.on("window-fullscreen-changed", listener);
		return () => ipcRenderer.removeListener("window-fullscreen-changed", listener);
	},
	getLinuxWindowSystem: () => {
		return ipcRenderer.invoke("get-linux-window-system");
	},
	revealInFolder: (filePath: string) => {
		return ipcRenderer.invoke("reveal-in-folder", filePath);
	},
	openRecordingsFolder: () => {
		return ipcRenderer.invoke("open-recordings-folder");
	},
	getRecordingsDirectory: () => {
		return ipcRenderer.invoke("get-recordings-directory");
	},
	chooseRecordingsDirectory: () => {
		return ipcRenderer.invoke("choose-recordings-directory");
	},
	getShortcuts: () => {
		return ipcRenderer.invoke("get-shortcuts");
	},
	saveShortcuts: (shortcuts: unknown) => {
		return ipcRenderer.invoke("save-shortcuts", shortcuts);
	},
	getAppSetting: (key: string) => {
		if (!rendererSettings) {
			const snapshot = ipcRenderer.sendSync("app-settings:snapshot") as RendererSettingsSnapshot | null;
			if (snapshot) {
				const { entries, revision } = snapshot;
				rendererSettings = new Map(entries.map(([key, value]) => [key, { value, revision }]));
			}
		}
		const cached = rendererSettings?.get(key);
		if (cached) return cached.value ?? null;
		const result = ipcRenderer.sendSync("app-settings:get", key) as {
			success?: boolean;
			value?: unknown;
		};
		return result?.success ? (result.value ?? null) : null;
	},
	patchEditorPreferences: async (changes: Record<string, unknown>, flush?: boolean) =>
		acceptRendererSettingWrite(await ipcRenderer.invoke("patch-editor-preferences", changes, flush)),
	getPreviewDisplayBounds: () => ipcRenderer.sendSync("get-preview-display-bounds"),
	writeAppLog: (level: "info" | "warn" | "error", scope: string, message: string, detail?: string) =>
		ipcRenderer.send("app-log:write", level, scope, message, detail),
	exportDiagnosticsBundle: () => ipcRenderer.invoke("export-diagnostics-bundle"),
	getRecordingShortcuts: () => ipcRenderer.invoke("get-recording-shortcuts"),
	setRecordingShortcuts: (config: RecordingShortcutsConfig) => ipcRenderer.invoke("set-recording-shortcuts", config),
	setRecordingShortcutCapture: (active: boolean) => ipcRenderer.send("set-recording-shortcut-capture", active),
	onRendererRecovered: (callback: () => void) => {
		rendererRecoveredListener = callback;
		if (rendererRecoveredPending) {
			rendererRecoveredPending = false;
			callback();
		}
		return () => { if (rendererRecoveredListener === callback) rendererRecoveredListener = null; };
	},
	setDetachedPreviewFullscreen: (fullscreen: boolean) => ipcRenderer.invoke("set-detached-preview-fullscreen", fullscreen),
	onDetachedPreviewFullscreenChanged: (callback: (fullscreen: boolean) => void) => {
		const listener = (_event: Electron.IpcRendererEvent, fullscreen: boolean) => callback(fullscreen);
		ipcRenderer.on("detached-preview-fullscreen-changed", listener);
		return () => ipcRenderer.removeListener("detached-preview-fullscreen-changed", listener);
	},
	setAppSetting: (key: string, value: unknown) =>
		acceptRendererSettingWrite(ipcRenderer.sendSync("app-settings:set", key, value)),
	setAppSettingAsync: async (key: string, value: unknown) =>
		acceptRendererSettingWrite(await ipcRenderer.invoke("app-settings:set-async", key, value)),
	onAppLocaleChanged: (callback: (locale: string) => void) => {
		const listener = (_event: Electron.IpcRendererEvent, locale: string) => callback(locale);
		ipcRenderer.on("app-locale-changed", listener);
		return () => ipcRenderer.removeListener("app-locale-changed", listener);
	},
	setHasUnsavedChanges: (hasChanges: boolean) => {
		ipcRenderer.send("set-has-unsaved-changes", hasChanges);
	},
	onExternalProjectOpen: (callback: (filePath: string) => Promise<unknown>) => {
		const listener = async (_event: Electron.IpcRendererEvent, request: { id: number; path: string }) => {
			try {
				await callback(request.path);
			} finally {
				ipcRenderer.send("external-project-open-done", request.id);
			}
		};
		ipcRenderer.on("external-project-open", listener);
		ipcRenderer.send("external-project-open-ready");
		return () => ipcRenderer.removeListener("external-project-open", listener);
	},
	onProjectFileChanged: (callback: (change: { path: string; diskRevision: string | null }) => void) => {
		const listener = (_event: Electron.IpcRendererEvent, change: { path: string; diskRevision: string | null }) => callback(change);
		ipcRenderer.on("project-file-changed", listener);
		return () => ipcRenderer.removeListener("project-file-changed", listener);
	},
	onRequestSaveBeforeClose: (callback: () => Promise<boolean>) => {
		const listener = async (_event: Electron.IpcRendererEvent, requestId: unknown) => {
			let saved = false;
			try {
				saved = await callback();
			} catch {
				saved = false;
			}
			ipcRenderer.send("save-before-close-done", saved, requestId);
		};
		ipcRenderer.on("request-save-before-close", listener);
		return () => ipcRenderer.removeListener("request-save-before-close", listener);
	},
	isNativeWindowsCaptureAvailable: () =>
		ipcRenderer.invoke("is-native-windows-capture-available"),
	muxNativeWindowsRecording: (expectedDurationMs?: number) =>
		ipcRenderer.invoke("mux-native-windows-recording", expectedDurationMs),
	getAppVersion: () => ipcRenderer.invoke("app:getVersion"),
	convertExportToGif: (input: GifConversionRequest) =>
		ipcRenderer.invoke("convert-export-to-gif", input),
	cancelExportGif: (runId: string) => ipcRenderer.invoke("cancel-export-gif", runId),
	configureLeadCutAgent: (agent: "codex" | "claude"): Promise<{ success: boolean; error?: string }> =>
		ipcRenderer.invoke("configure-leadcut-agent", agent),
	getRecordingPreferences: () => ipcRenderer.invoke("get-recording-preferences"),
	getRecordingAudioLabConfig: () => ipcRenderer.invoke("get-recording-audio-lab-config"),
	setRecordingPreferences: (prefs: {
		microphoneEnabled?: boolean;
		microphoneDeviceId?: string;
		systemAudioEnabled?: boolean;
		webcamEnabled?: boolean;
		webcamDeviceId?: string;
	}) => ipcRenderer.invoke("set-recording-preferences", prefs),
	getCountdownDelay: () => ipcRenderer.invoke("get-countdown-delay"),
	setCountdownDelay: (delay: number) => ipcRenderer.invoke("set-countdown-delay", delay),
	finishRecordingStartup: () => ipcRenderer.invoke("finish-recording-startup"),
	startCountdown: (seconds: number) => ipcRenderer.invoke("start-countdown", seconds),
	cancelCountdown: () => ipcRenderer.invoke("cancel-countdown"),
	getActiveCountdown: () => ipcRenderer.invoke("get-active-countdown"),
	onCountdownTick: (callback: (seconds: number) => void) => {
		const listener = (_event: Electron.IpcRendererEvent, seconds: number) => callback(seconds);
		ipcRenderer.on("countdown-tick", listener);
		return () => ipcRenderer.removeListener("countdown-tick", listener);
	},
});
