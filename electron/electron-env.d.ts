/// <reference types="vite-plugin-electron/electron-env" />

declare namespace NodeJS {
	interface ProcessEnv {
		/**
		 * The built directory structure
		 *
		 * ```tree
		 * ├─┬─┬ dist
		 * │ │ └── index.html
		 * │ │
		 * │ ├─┬ dist-electron
		 * │ │ ├── main.js
		 * │ │ └── preload.js
		 * │
		 * ```
		 */
		APP_ROOT: string;
		/** /dist/ or /public/ */
		VITE_PUBLIC: string;
	}
}

interface ProjectLoadResult {
	startupOpen?: boolean;
	success: boolean;
	path?: string;
	revision?: string;
	project?: unknown;
	agentReviewHistory?: unknown[];
	convertedFrom?: string;
	conversionFailed?: boolean;
	message?: string;
	canceled?: boolean;
	error?: string;
	code?: "media-missing";
	missing?: import("../src/components/video-editor/projectRelink").ProjectMediaReference[];
}

// Used in Renderer process, expose in `preload.ts`
interface NativeCaptureDiagnostics {
	backend: "windows-wgc" | "mac-screencapturekit" | "browser-store" | "ffmpeg";
	phase: "availability" | "start" | "stop" | "mux";
	timestamp: string;
	sourceId?: string | null;
	sourceType?: "screen" | "window" | "unknown";
	displayId?: number | null;
	displayBounds?: { x: number; y: number; width: number; height: number } | null;
	windowHandle?: number | null;
	helperPath?: string | null;
	outputPath?: string | null;
	systemAudioPath?: string | null;
	microphonePath?: string | null;
	osRelease?: string;
	supported?: boolean;
	helperExists?: boolean;
	fileSizeBytes?: number | null;
	processOutput?: string;
	error?: string;
}

interface UpdateToastState {
	version: string;
	detail: string;
	phase: "available" | "downloading" | "ready" | "error";
	delayMs: number;
	isPreview?: boolean;
	isExperimental?: boolean;
	progressPercent?: number;
	transferredBytes?: number;
	totalBytes?: number;
	remainingBytes?: number;
	bytesPerSecond?: number;
	primaryAction?: "install-and-restart" | "retry-check";
}

interface UpdateStatusSummary {
	status: "idle" | "checking" | "up-to-date" | "available" | "downloading" | "ready" | "error";
	currentVersion: string;
	availableVersion: string | null;
	detail?: string;
}

type RendererRecordingSessionData = import("./ipc/types").RecordingSessionData;

interface RendererFfmpegAudioMuxMetrics {
	inlineEditedAudioBytes?: number;
	ffmpegMuxOutputWriteBytes?: number;
	tempVideoWriteMs?: number;
	tempEditedAudioWriteMs?: number;
	ffmpegExecMs?: number;
	muxedVideoReadMs?: number;
	tempVideoBytes?: number;
	tempEditedAudioBytes?: number;
	muxedVideoBytes?: number;
}

interface RendererWindowsGpuExportSummary {
	success?: boolean;
	width?: number;
	height?: number;
	fps?: number;
	seconds?: number;
	mediaMs?: number;
	frames?: number;
	gpuDecodeSurface?: boolean;
	webcamOverlay?: boolean;
	cursorOverlay?: boolean;
	zoomOverlay?: boolean;
	surfacePoolSize?: number;
	surfacePoolLimit?: number;
	adapterIndex?: number;
	adapterVendorId?: number;
	adapterDeviceId?: number;
	adapterDedicatedVideoMemoryMB?: number;
	encoderBackend?: string;
	encoderTuningApplied?: boolean;
	nvencOutputBytes?: number;
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
	surfaceWaitMs?: number;
	surfaceWaitMaxMs?: number;
	surfaceWaitOver1ms?: number;
	gpuStageTiming?: import("../src/lib/exporter/types").D3D11GpuStageTiming;
	mediaFoundationOutputTiming?: import("../src/lib/exporter/types").MediaFoundationOutputTiming;
	finalizeMs?: number;
	realtimeMultiplier?: number;
}

interface RendererNativeStaticLayoutChunkMetric {
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
	windowsGpuSummary?: RendererWindowsGpuExportSummary;
}

interface RendererNativeStaticLayoutMetrics extends RendererFfmpegAudioMuxMetrics {
	chunkCount: number;
	chunkDurationSec: number;
	chunkExecMs: number;
	concatExecMs?: number;
	staticAssetExecMs?: number;
	fallbackChunkCount: number;
	videoOnlyBytes?: number;
	exportRoutePlan?: import("../src/lib/exporter/backendPolicy").ExportRoutePlan<import("../src/lib/exporter/backendPolicy").NativeStaticExportRoute>;
	exportRoute?: import("../src/lib/exporter/backendPolicy").NativeStaticExportRoute;
	chunks: RendererNativeStaticLayoutChunkMetric[];
}

interface RendererNativeStaticLayoutProgress {
	sessionId?: string;
	backend?: RendererNativeStaticLayoutChunkMetric["backend"];
	stage?: "preparing" | "finalizing";
	elapsedMs?: number;
	averageFps?: number;
	instantFps?: number;
	intervalMs?: number;
	intervalFrames?: number;
	intervalDecodeWallMs?: number;
	intervalEncodeMs?: number;
	intervalPipelineWaitMs?: number;
	intervalCompositeMs?: number;
	intervalNvencMs?: number;
	intervalPacketWriteMs?: number;
	intervalWebcamDecodeMs?: number;
	intervalWebcamCopyMs?: number;
	intervalRoiCompositeFrames?: number;
	intervalMonolithicCompositeFrames?: number;
	intervalCopyCompositeFrames?: number;
	currentFrame: number;
	totalFrames: number;
	percentage: number;
}

interface RendererNativeVideoMetadataProbe {
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
}

interface RendererNativeExportCapabilities {
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
}

interface RendererExportHardwareInfo {
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
}

interface Window {
	electronAPI: {
		hudOverlaySetIgnoreMouse: (ignore: boolean) => void;
		getHudOverlayPlacement: () => Promise<import("./hudOverlayBounds").HudOverlayPlacementSnapshot | null>;
		hudOverlaySetPlacement: (kind: "bar" | "webcam", placement: import("./hudOverlayBounds").HudSavedPlacement) => Promise<boolean>;
		hudOverlayFollowCursorDisplay: () => void;
		onHudOverlayDisplayChanged: (callback: (payload: import("./hudOverlayBounds").HudDisplayChange) => void) => () => void;
		hudOverlaySetSourceSelectionActive: (active: boolean) => void;
		hudOverlayDrag: (phase: "start" | "move" | "end", screenX: number, screenY: number) => void;
		hudOverlayHide: () => void;
		hudOverlayClose: () => void;
		hudOverlayQuitApp: () => void;
		getEditorMode: () => Promise<boolean>;
		onEditorModeChanged: (callback: (inEditor: boolean) => void) => () => void;
		hudOverlayRendererReady: () => void;
		hudOverlaySetWebcamPreviewVisible: (visible: boolean) => void;
		getHudOverlayCaptureProtection: () => Promise<{ success: boolean; enabled: boolean }>;
		getHudOverlayMousePassthroughSupported: () => Promise<{
			success: boolean;
			supported: boolean;
		}>;
		setHudOverlayCaptureProtection: (
			enabled: boolean,
		) => Promise<{ success: boolean; enabled: boolean }>;
		getAssetBasePath: () => Promise<string | null>;
		resolveNativeBundledImagePath: (asset: string) => Promise<string | null>;
		listLocalFontFamilies: (refresh?: boolean) => Promise<string[]>;
		getSources: (opts: Electron.SourcesOptions) => Promise<ProcessedDesktopSource[]>;
		onCaptureSourceListFailed: (callback: () => void) => () => void;
		showProjectDashboard: () => Promise<void>;
		switchToEditor: () => Promise<void>;
		openSourceSelector: () => Promise<void>;
		selectSource: (source: ProcessedDesktopSource) => Promise<ProcessedDesktopSource>;
		showSourceHighlight: (source: ProcessedDesktopSource) => Promise<{ success: boolean }>;
		getSelectedSource: () => Promise<ProcessedDesktopSource | null>;
		onSelectedSourceChanged: (
			callback: (source: ProcessedDesktopSource | null) => void,
		) => () => void;
		startNativeScreenRecording: (
			source: ProcessedDesktopSource,
			options?: {
				capturesSystemAudio?: boolean;
				capturesMicrophone?: boolean;
				microphoneDeviceId?: string;
				microphoneLabel?: string;
			},
		) => Promise<{
			success: boolean;
			path?: string;
			message?: string;
			error?: string;
			userNotified?: boolean;
			microphoneFallbackRequired?: boolean;
		}>;
		stopNativeScreenRecording: (discard?: boolean) => Promise<{
			success: boolean;
			path?: string;
			message?: string;
			error?: string;
		}>;
		recoverNativeScreenRecording: () => Promise<{
			success: boolean;
			path?: string;
			message?: string;
			error?: string;
		}>;
		getLastNativeCaptureDiagnostics: () => Promise<{
			success: boolean;
			diagnostics?: NativeCaptureDiagnostics | null;
		}>;
		pauseNativeScreenRecording: () => Promise<{
			success: boolean;
			message?: string;
			error?: string;
		}>;
		resumeNativeScreenRecording: () => Promise<{
			success: boolean;
			message?: string;
			error?: string;
		}>;
		pauseCursorCapture: (pausedAtMs?: number) => Promise<{
			success: boolean;
			message?: string;
			error?: string;
		}>;
		resumeCursorCapture: (resumedAtMs?: number) => Promise<{
			success: boolean;
			message?: string;
			error?: string;
		}>;
		startFfmpegRecording: (
			source: ProcessedDesktopSource,
		) => Promise<{ success: boolean; path?: string; message?: string; error?: string }>;
		stopFfmpegRecording: () => Promise<{
			success: boolean;
			path?: string;
			message?: string;
			error?: string;
		}>;
		writeWebcamChunk: (name: string, data: ArrayBuffer, first: boolean) => Promise<void>;
		finishWebcamFile: (name: string, discard: boolean) => Promise<string | null>;
		writeRecordingChunk: (name: string, data: ArrayBuffer, first: boolean) => Promise<void>;
		finishRecordingChunks: (name: string, discard: boolean) => Promise<{
			success: boolean; path?: string; message?: string; error?: string; partialPath?: string;
		} | null>;
		recoverBrowserRecording?: () => Promise<{ success: boolean; path?: string; webcamPath?: string }>;
		storeRecordedVideo: (
			videoData: ArrayBuffer,
			fileName: string,
		) => Promise<{ success: boolean; path?: string; message?: string }>;
		prepareMicrophoneStream: (input: { startDelayMs: number; profile?: string }) => Promise<string>;
		writeMicrophoneChunk: (streamId: string, bytes: ArrayBuffer) => Promise<void>;
		discardMicrophoneStream: (streamId: string) => Promise<void>;
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
					recordedElapsedMs?: number;
					recordedDeltaMs?: number | null;
				}>;
				pauseIntervals?: Array<{
					startElapsedMs: number;
					endElapsedMs?: number;
					durationMs?: number;
				}>;
			},
		) => Promise<{ success: boolean; path?: string; error?: string }>;
		getRecordedVideoPath: () => Promise<{ success: boolean; path?: string; message?: string }>;
		listAssetDirectory: (relativeDir: string) => Promise<{
			success: boolean;
			files?: string[];
			error?: string;
		}>;
		readLocalFile: (
			filePath: string,
		) => Promise<{ success: boolean; data?: Uint8Array; error?: string }>;
		generateWallpaperThumbnail: (
			filePath: string,
		) => Promise<{ success: boolean; data?: Uint8Array; error?: string }>;
		probeNativeVideoMetadata: (filePath: string) => Promise<{
			success: boolean;
			metadata?: RendererNativeVideoMetadataProbe;
			error?: string;
		}>;
		getNativeExportCapabilities: () => Promise<{
			success: boolean;
			capabilities?: RendererNativeExportCapabilities;
			error?: string;
		}>;
		getExportHardwareInfo: () => Promise<{
			success: boolean;
			hardware?: RendererExportHardwareInfo;
			error?: string;
		}>;
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
		}) => Promise<{
			success: boolean;
			tempPath?: string;
			encoderName?: string;
			error?: string;
			metrics?: RendererNativeStaticLayoutMetrics;
		}>;
		nativeStaticLayoutExportCancel: (sessionId: string) => Promise<{
			success: boolean;
		}>;
		onNativeStaticLayoutExportProgress: (
			callback: (progress: RendererNativeStaticLayoutProgress) => void,
		) => () => void;
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
		}) => Promise<{
			success: boolean;
			sessionId?: string;
			encoderName?: string;
			mixedAudio?: boolean;
			error?: string;
		}>;
		nativeVideoExportWriteWav?: (
			sessionId: string,
			chunk: Uint8Array | null,
		) => Promise<{ success: boolean; error?: string }>;
		nativeVideoExportEndVideoInput?: (sessionId: string) => Promise<{ success: boolean; error?: string }>;
		nativeVideoExportWriteFrame: (
			sessionId: string,
			frameData: Uint8Array,
		) => Promise<{ success: boolean; error?: string }>;
		nativeVideoExportWriteFrames: (
			sessionId: string,
			frameDataList: Uint8Array[],
		) => Promise<{ success: boolean; error?: string }>;
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
		) => Promise<{
			success: boolean;
			tempPath?: string;
			encoderName?: string;
			error?: string;
			metrics?: RendererFfmpegAudioMuxMetrics;
		}>;
		nativeVideoExportCancel: (
			sessionId: string,
		) => Promise<{ success: boolean; error?: string }>;
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
		) => Promise<{
			success: boolean;
			tempPath?: string;
			error?: string;
			metrics?: RendererFfmpegAudioMuxMetrics;
		}>;
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
		) => Promise<{
			success: boolean;
			tempPath?: string;
			error?: string;
			metrics?: RendererFfmpegAudioMuxMetrics;
		}>;
		openExportStream: (options?: { extension?: string; destinationPath?: string }) => Promise<{
			success: boolean;
			streamId?: string;
			tempPath?: string;
			error?: string;
		}>;
		openExportAacStream?: () => Promise<{
			success: boolean;
			streamId?: string;
			tempPath?: string;
			error?: string;
		}>;
		startExportAudioAppend?: (videoPath: string, durationSec: number) => Promise<{ success: boolean; runId?: string; error?: string }>;
		writeExportAudioAppend?: (runId: string, chunk: Uint8Array) => Promise<{ success: boolean; error?: string }>;
		finishExportAudioAppend?: (
			runId: string,
			disposition: import("./ipc/nativeVideoExport").ExportAudioAppendDisposition,
		) => Promise<import("./ipc/nativeVideoExport").ExportAudioAppendResult>;
		writeExportStreamChunk: (
			streamId: string,
			position: number,
			chunk: Uint8Array,
		) => Promise<{ success: boolean; error?: string }>;
		closeExportStream: (
			streamId: string,
			options?: { abort?: boolean },
		) => Promise<{
			success: boolean;
			tempPath?: string;
			bytesWritten?: number;
			error?: string;
		}>;
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
		}) => Promise<{
			success: boolean;
			path?: string;
			canceled?: boolean;
			message?: string;
			error?: string;
		}>;
		discardExportedTemp: (tempPath: string) => Promise<{ success: boolean; error?: string }>;
		getVideoAudioFallbackPaths: (videoPath: string) => Promise<{
			success: boolean;
			paths: string[];
			sidecarPaths?: string[];
			startDelayMsByPath?: Record<string, number>;
			error?: string;
		}>;
		setRecordingState: (recording: boolean, discarded?: boolean) => Promise<void>;
		generateWaveformPeaks: (filePath: string, requestId: number) => Promise<import("./ipc/waveform/peaks").WaveformPeaksResponse>;
		onWaveformPeaksProgress: (callback: (data: { requestId: number; ratio: number }) => void) => () => void;
		getRecordingDiskStatus: () => Promise<import("./ipc/recording/diskEstimate").RecordingDiskStatus | null>;
		getRecordingState: () => Promise<{
			recording: boolean;
			backend: "native-windows" | "native-mac" | "browser" | null;
			elapsedMs: number;
			paused: boolean;
			markerCount?: number;
		} | null>;
		setRecordingPaused: (paused: boolean) => void;
		onRecordingShortcut: (callback: (action: import("../src/lib/recordingShortcuts").RecordingShortcutAction) => void) => () => void;
		onRecordingDiskLow: (callback: (status: import("./ipc/recording/diskEstimate").RecordingDiskStatus) => void) => () => void;
		onRecordingFinalization: (callback: (status: import("./ipc/types").NativeRecordingFinalization) => void) => () => void;
		addRecordingMarker: (kind: import("./ipc/types").RecordingMarkerKind) =>
			Promise<import("./ipc/types").RecordingMarkerAdded | { success: false }>;
		getRecordingMarkers: (videoPath?: string) =>
			Promise<{ success: boolean; markers: import("./ipc/types").RecordingMarker[] }>;
		onRecordingMarkerAdded: (callback: (marker: import("./ipc/types").RecordingMarkerAdded) => void) => () => void;
		getRecordingKeystrokes: (videoPath?: string) => Promise<{ success: boolean } & import("../services/leadcut-mcp/src/keystrokeSidecar").KeystrokeSidecar>;
		getLiveAnnotationState: () => Promise<import("../src/components/live-annotation/liveAnnotationModel").LiveAnnotationStatus>;
		toggleLiveAnnotation: () => Promise<import("../src/components/live-annotation/liveAnnotationModel").LiveAnnotationStatus>;
		setLiveAnnotationTool: (options: import("../src/components/live-annotation/liveAnnotationModel").LiveAnnotationOptions) => Promise<boolean>;
		sendLiveAnnotationCommand: (command: import("../src/components/live-annotation/liveAnnotationModel").LiveAnnotationCommand) => Promise<boolean>;
		setLiveAnnotationTextFocus: (focused: boolean) => Promise<boolean>;
		liveAnnotationCanvasReady: () => void;
		onLiveAnnotationStateChanged: (callback: (state: import("../src/components/live-annotation/liveAnnotationModel").LiveAnnotationStatus) => void) => () => void;
		onLiveAnnotationOptions: (callback: (options: import("../src/components/live-annotation/liveAnnotationModel").LiveAnnotationOptions) => void) => () => void;
		onLiveAnnotationCommand: (callback: (command: import("../src/components/live-annotation/liveAnnotationModel").LiveAnnotationCommand) => void) => () => void;
		onRecordingKeystrokeCaptureChanged: (callback: (paused: boolean) => void) => () => void;
		onRecordingKeystrokeCaptureUnavailable: (callback: () => void) => () => void;
		getInterruptedRecording: () => Promise<{ startedAt: number; videoPath: string } | null>;
		recoverInterruptedRecording: (startedAt: number) => Promise<{ success: boolean; path?: string; error?: string }>;
		discardInterruptedRecording: (startedAt: number) => Promise<{ success: boolean; path?: string; error?: string }>;
		getCursorTelemetry: (videoPath?: string) => Promise<{
			success: boolean;
			samples: CursorTelemetryPoint[];
			message?: string;
			error?: string;
		}>;
		setCursorTelemetry: (
			videoPath: string | undefined,
			samples: CursorTelemetryPoint[],
		) => Promise<{
			success: boolean;
			samples: CursorTelemetryPoint[];
			message?: string;
			error?: string;
		}>;
		getSystemCursorAssets: () => Promise<{
			success: boolean;
			cursors: Record<string, SystemCursorAsset>;
			error?: string;
		}>;
		onStopRecordingFromTray: (callback: () => void) => () => void;
		onRecordingStateChanged: (
			callback: (state: { recording: boolean; sourceName: string }) => void,
		) => () => void;
		onRecordingSessionChanged: (
			callback: (session: RendererRecordingSessionData | null, background?: "camera" | "audio") => void,
		) => () => void;
		onRecordingAudioLost?: (callback: (track: "mic" | "system") => void) => () => void;
		onRecordingInterrupted: (
			callback: (state: { reason: string; message: string }) => void,
		) => () => void;
		onCursorStateChanged: (
			callback: (state: { cursorType: CursorTelemetryPoint["cursorType"] }) => void,
		) => () => void;
		openExternalUrl: (url: string) => Promise<{ success: boolean; error?: string }>;
		getAccessibilityPermissionStatus: () => Promise<{
			success: boolean;
			trusted: boolean;
			prompted: boolean;
			error?: string;
		}>;
		requestAccessibilityPermission: () => Promise<{
			success: boolean;
			trusted: boolean;
			prompted: boolean;
			error?: string;
		}>;
		getScreenRecordingPermissionStatus: () => Promise<{
			success: boolean;
			status: string;
			error?: string;
		}>;
		openScreenRecordingPreferences: () => Promise<{ success: boolean; error?: string }>;
		openAccessibilityPreferences: () => Promise<{ success: boolean; error?: string }>;
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
		) => Promise<{ success: boolean; path?: string; message?: string; canceled?: boolean; error?: string }>;
		chooseExportPath: (fileName: string) => Promise<{ success: boolean; path?: string; canceled?: boolean; error?: string }>;
		captureExportPreview: (rect: { x: number; y: number; width: number; height: number }) => Promise<string | null>;
		getExportDiskSpace: (outputPath: string) => Promise<{ targetFreeBytes: number | null; tempFreeBytes: number | null }>;
		prepareExportAudioSource: (filePath: string) => Promise<string | null>;
		prepareExportAudioPcm?: (filePath: string, window?: { startSec: number; endSec: number }, useMemoryWindows?: boolean) =>
			Promise<({
				frames: number; channels: number; sampleRate: number;
				firstFrame?: number; sourceDurationSec?: number;
			} & ({ path: string; url: string } | { pcm: Uint8Array } | { memoryWindows: true })) | null>;
		openExportAudioPcmReader?: () => Promise<string>;
		closeExportAudioPcmReader?: (readerId: string) => Promise<void>;
		readExportAudioPcmWindow?: (
			filePath: string, window: { firstFrame: number; endFrame: number; channels: number; sampleRate: number },
			readerId?: string,
		) => Promise<Uint8Array>;
		cancelExportAudioPcm?: () => Promise<void>;
		encodeExportAudioAac?: (filePath: string) => Promise<string | null>;
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
		) => Promise<{
			success: boolean;
			path?: string;
			message?: string;
			error?: string;
			canceled?: boolean;
		}>;
		openVideoFilePicker: (options?: { includeProjects?: boolean }) => Promise<ProjectLoadResult & {
			kind?: "media" | "project";
			extension?: string;
		}>;
		openAudioFilePicker: () => Promise<{ success: boolean; path?: string; canceled?: boolean }>;
		openWhisperExecutablePicker: () => Promise<{
			success: boolean;
			path?: string;
			canceled?: boolean;
			error?: string;
		}>;
		openWhisperModelPicker: () => Promise<{
			success: boolean;
			path?: string;
			canceled?: boolean;
			error?: string;
		}>;
		getWhisperSmallModelStatus: () => Promise<{
			success: boolean;
			exists: boolean;
			path?: string | null;
			error?: string;
		}>;
		cancelWhisperModelDownload?: () => Promise<void>;
		downloadWhisperSmallModel: () => Promise<{
			success: boolean;
			canceled?: boolean;
			path?: string;
			alreadyDownloaded?: boolean;
			error?: string;
		}>;
		deleteWhisperSmallModel: () => Promise<{ success: boolean; error?: string }>;
		onWhisperSmallModelDownloadProgress: (
			callback: (state: {
				status: "idle" | "downloading" | "downloaded" | "error";
				progress: number;
				path?: string | null;
				error?: string;
			}) => void,
		) => () => void;
		importSrtCaptions: (options?: { title?: string }) => Promise<{
			success: boolean;
			canceled?: boolean;
			path?: string;
			cues?: AutoCaptionCue[];
			errorCode?: string;
		}>;
		importTranscriptFile: () => Promise<{
			success: boolean;
			canceled?: boolean;
			path?: string;
			transcript?: import("../src/components/video-editor/transcript").ProjectTranscript;
			errorCode?: string;
		}>;
		rebuildCaptionsFromTranscript: (transcript: import("../src/components/video-editor/transcript").ProjectTranscript) => Promise<{
			success: boolean;
			cues?: AutoCaptionCue[];
			errorCode?: string;
		}>;
		cancelAutoCaptions?: () => Promise<void>;
		onAutoCaptionProgress?: (onProgress: (percentage: number) => void) => () => void;
		generateAutoCaptions: (options: {
			videoPath: string;
			whisperExecutablePath?: string;
			whisperModelPath: string;
			language?: string;
		}) => Promise<{
			success: boolean;
			canceled?: boolean;
			cues?: AutoCaptionCue[];
			transcript?: import("../src/components/video-editor/transcript").ProjectTranscript | null;
			message?: string;
			error?: string;
		}>;
		setCurrentVideoPath: (
			path: string,
			options?: {
				preserveProjectPath?: boolean;
				hideOverlayCursorByDefault?: boolean;
			},
		) => Promise<{ success: boolean; webcamPath: string | null }>;
		setCurrentRecordingSession: (
			session: {
				videoPath: string;
				webcamPath?: string | null;
				timeOffsetMs?: number;
				hideOverlayCursorByDefault?: boolean;
			},
			options?: { preserveProjectPath?: boolean; background?: "camera" | "audio" },
		) => Promise<{ success: boolean }>;
		getCurrentRecordingSession: () => Promise<{
			success: boolean;
			session?: {
				videoPath: string;
				webcamPath?: string | null;
				timeOffsetMs?: number;
				hideOverlayCursorByDefault?: boolean;
			};
		}>;
		getCurrentVideoPath: () => Promise<{ success: boolean; path?: string }>;
		clearCurrentVideoPath: () => Promise<{ success: boolean }>;
		getRecordingThumbnail: (
			filePath: string,
		) => Promise<import("../src/types/recordingLibrary").LibraryResult<string>>;
		finishRecordingImport: (
			keepPath: string,
			commit?: boolean,
		) => Promise<{ success: boolean; error?: string }>;
		cancelRecordingImport: () => Promise<{ success: boolean }>;
		getProjectPreview: (
			projectPath: string,
		) => Promise<
			import("../src/types/recordingLibrary").LibraryResult<
				import("../src/types/projectPreview").ProjectPreviewData
			>
		>;
		listRecordings: (
			includeSources?: boolean,
		) => Promise<
			import("../src/types/recordingLibrary").LibraryResult<
				import("../src/types/recordingLibrary").RecordingLibraryEntry[]
			>
		>;
		setRecordingsRemoved: (
			paths: string[],
			removed: boolean,
		) => Promise<import("../src/types/recordingLibrary").LibraryResult<null>>;
		importRecording: (
			currentPath: string,
			recordingPath: string,
			webcam?: import("../src/types/recordingLibrary").RecordingWebcamSource,
		) => Promise<
			import("../src/types/recordingLibrary").LibraryResult<
				import("../src/types/recordingLibrary").RecordingImportResult
			>
		>;
		deleteRecordingFile: (filePath: string) => Promise<{ success: boolean; error?: string }>;
		getLocalMediaUrl: (
			filePath: string,
		) => Promise<{ success: true; url: string } | { success: false }>;
		saveProjectFile: (
			projectData: unknown,
			suggestedName?: string,
			existingProjectPath?: string,
			thumbnailDataUrl?: string | null,
			expectedRevision?: string,
		) => Promise<{
			success: boolean;
			path?: string;
			projectId?: string;
			revision?: string;
			conflict?: boolean;
			diskRevision?: string | null;
			message?: string;
			canceled?: boolean;
			error?: string;
		}>;
		saveProjectFileNamed: (
			projectData: unknown,
			projectName: string,
			thumbnailDataUrl?: string | null,
			mode?: "rename" | "copy",
			expectedRevision?: string,
		) => Promise<{
			success: boolean;
			path?: string;
			projectId?: string;
			revision?: string;
			conflict?: boolean;
			diskRevision?: string | null;
			conversion?: { from: string; path: string; revision: string };
			message?: string;
			canceled?: boolean;
			error?: string;
		}>;
		loadProjectFile: () => Promise<ProjectLoadResult>;
		saveCutReviewHandoff: (markdown: string, projectName: string) => Promise<{ success: boolean; canceled?: boolean }>;
		loadCurrentProjectFile: () => Promise<ProjectLoadResult>;
		pickRelinkMedia: (kind: import("../src/components/video-editor/projectRelink").ProjectMediaKind) => Promise<{
			success: boolean; path?: string; canceled?: boolean; message?: string;
		}>;
		pickRelinkMediaFolder: () => Promise<{ success: boolean; path?: string; canceled?: boolean; message?: string }>;
		matchMediaInFolder: (folder: string, basenames: string[]) => Promise<{
			success: boolean; matches?: Record<string, string>; ambiguous?: string[]; withoutSidecars?: string[]; message?: string;
		}>;
		relinkProjectMedia: (projectPath: string, revision: string, mapping: import("../src/components/video-editor/projectRelink").MediaRelinkMapping) => Promise<ProjectLoadResult>;
		listProjectVersions: () => Promise<{ success: boolean; versions?: import("../src/types/projectVersion").ProjectVersionEntry[]; message?: string }>;
		readProjectVersion: (versionPath: string) => Promise<ProjectLoadResult>;
		restoreProjectVersion: (versionPath: string, expectedRevision?: string) => Promise<ProjectLoadResult>;
		deleteProjectVersion: (versionPath: string) => Promise<{ success: boolean; message?: string }>;
		pruneProjectVersions: () => Promise<{ success: boolean; deleted?: number; message?: string }>;
		releaseCurrentProject: () => Promise<{ success: boolean; path: string | null }>;
		setProjectAgentHandoff: (projectPath: string, handedOff: boolean) => Promise<{ success: boolean; message?: string }>;
		getProjectsDirectory: () => Promise<{
			success: boolean;
			path?: string;
			error?: string;
		}>;
		showRecordingHud: () => Promise<void>;
		createProjectFile: (
			data: unknown,
			thumbnail?: string | null,
		) => Promise<{
			success: boolean;
			path?: string;
			projectId?: string;
			revision?: string;
			message?: string;
			canceled?: boolean;
		}>;
		renameLibraryProject: (
			path: string,
			name: string,
		) => Promise<{ success: boolean; path?: string; error?: string }>;
		convertLegacyProjectFiles: () => Promise<{
			converted: Array<{ from: string; to: string }>;
			errors: Array<{ path: string; message: string }>;
		}>;
		trashProjectFiles: (
			paths: string[],
		) => Promise<{ success: boolean; deleted: string[]; errors: string[] }>;
		onProjectThumbnailReady: (
			callback: (ready: { path: string; thumbnailPath: string; updatedAt: number }) => void,
		) => () => void;
		listProjectFiles: () => Promise<{
			success: boolean;
			projectsDir?: string | null;
			entries: Array<{
				path: string;
				name: string;
				createdAt?: number;
				updatedAt: number;
				thumbnailPath: string | null;
				isCurrent: boolean;
				isInProjectsDirectory: boolean;
				isLegacyFormat?: boolean;
			}>;
			error?: string;
		}>;
		openProjectFileAtPath: (filePath: string, includeAgentHistory?: boolean) => Promise<ProjectLoadResult>;
		openProjectsDirectory: () => Promise<{
			success: boolean;
			path?: string;
			message?: string;
			error?: string;
		}>;
		installDownloadedUpdate: () => Promise<{ success: boolean }>;
		downloadAvailableUpdate: (
			installAfterDownload?: boolean,
		) => Promise<{ success: boolean; message?: string }>;
		deferDownloadedUpdate: (delayMs?: number) => Promise<{
			success: boolean;
			message?: string;
		}>;
		dismissUpdateToast: () => Promise<{ success: boolean }>;
		skipUpdateVersion: () => Promise<{ success: boolean; message?: string }>;
		getCurrentUpdateToastPayload: () => Promise<UpdateToastState | null>;
		getUpdateStatusSummary: () => Promise<UpdateStatusSummary>;
		getExperimentalUpdatesEnabled: () => Promise<boolean>;
		setExperimentalUpdatesEnabled: (enabled: boolean) => Promise<{
			success: boolean;
			enabled: boolean;
			error?: string;
		}>;
		previewUpdateToast: () => Promise<{ success: boolean }>;
		checkForAppUpdates: () => Promise<{ success: boolean; logPath: string }>;
		onUpdateToastStateChanged: (
			callback: (payload: UpdateToastState | null) => void,
		) => () => void;
		onUpdateReadyToast: (
			callback: (payload: {
				version: string;
				detail: string;
				delayMs: number;
				isPreview?: boolean;
			}) => void,
		) => () => void;
		onMenuLoadProject: (callback: () => void) => () => void;
		onMenuSaveProject: (callback: () => void) => () => void;
		onMenuSaveProjectAs: (callback: () => void) => () => void;
		getWindowChrome: () => Promise<{ trafficLightsVisible: boolean }>;
		onWindowChromeChanged: (
			callback: (chrome: { trafficLightsVisible: boolean }) => void,
		) => () => void;
		getPlatform: () => Promise<string>;
		isWindowFullscreen: () => Promise<boolean>;
		onWindowFullscreenChanged: (callback: (isFullscreen: boolean) => void) => () => void;
		getLinuxWindowSystem: () => Promise<"wayland" | "x11" | null>;
		revealInFolder: (
			filePath: string,
		) => Promise<{ success: boolean; error?: string; message?: string }>;
		openRecordingsFolder: () => Promise<{ success: boolean; error?: string; message?: string }>;
		getRecordingsDirectory: () => Promise<{
			success: boolean;
			path: string;
			isDefault: boolean;
			error?: string;
		}>;
		chooseRecordingsDirectory: () => Promise<{
			success: boolean;
			canceled?: boolean;
			path?: string;
			isDefault?: boolean;
			message?: string;
			error?: string;
		}>;
		getShortcuts: () => Promise<Record<string, unknown> | null>;
		saveShortcuts: (shortcuts: unknown) => Promise<{ success: boolean; error?: string }>;
		getAppSetting: (key: string) => unknown;
		patchEditorPreferences?: (changes: Record<string, unknown>, flush?: boolean) => Promise<boolean>;
		getPreviewDisplayBounds: () => import("../src/components/video-editor/layout/previewWindowPlacement").PreviewWindowBounds[];
		writeAppLog: (level: "info" | "warn" | "error", scope: string, message: string, detail?: string) => void;
		exportDiagnosticsBundle: () => Promise<{ success: boolean; path?: string; canceled?: boolean; message?: string }>;
	getRecordingShortcuts: () => Promise<import("../src/lib/recordingShortcuts").RecordingShortcutStatus>;
	setRecordingShortcuts: (config: import("../src/lib/recordingShortcuts").RecordingShortcutsConfig) => Promise<import("../src/lib/recordingShortcuts").RecordingShortcutSaveResult>;
	setRecordingShortcutCapture: (active: boolean) => void;
	onRendererRecovered: (callback: () => void) => () => void;
		setDetachedPreviewFullscreen: (fullscreen: boolean) => Promise<boolean>;
		onDetachedPreviewFullscreenChanged: (callback: (fullscreen: boolean) => void) => () => void;
		setAppSetting: (key: string, value: unknown) => boolean;
		setAppSettingAsync?: (key: string, value: unknown) => Promise<boolean>;
		onAppLocaleChanged: (callback: (locale: string) => void) => () => void;
		setHasUnsavedChanges: (hasChanges: boolean) => void;
		onExternalProjectOpen: (callback: (filePath: string) => Promise<unknown>) => () => void;
		onProjectFileChanged: (callback: (change: { path: string; diskRevision: string | null }) => void) => () => void;
		onRequestSaveBeforeClose: (callback: () => Promise<boolean>) => () => void;
		isNativeWindowsCaptureAvailable: () => Promise<{ available: boolean }>;
		muxNativeWindowsRecording: (expectedDurationMs?: number) => Promise<{
			success: boolean;
			path?: string;
			message?: string;
			error?: string;
		}>;
		/** Returns the app version from package.json */
		getAppVersion: () => Promise<string>;
		convertExportToGif?: (input: import("./ipc/export/gif").GifConversionRequest) =>
			Promise<{ success: boolean; tempPath?: string; error?: string }>;
		cancelExportGif?: (runId: string) => Promise<void>;
		configureLeadCutAgent: (agent: "codex" | "claude") => Promise<{ success: boolean; error?: string }>;
		/** Returns the configured remote announcement feed, or null when unavailable. */
		/** Recording preferences (mic, system audio, webcam) */
		getRecordingPreferences: () => Promise<{
			success: boolean;
			microphoneEnabled: boolean;
			microphoneDeviceId?: string;
			microphoneDeviceLabel?: string;
			systemAudioEnabled: boolean;
			webcamEnabled: boolean;
			webcamDeviceId?: string;
			webcamDeviceLabel?: string;
		}>;
		getRecordingAudioLabConfig: () => Promise<{
			browserMicrophoneProfile: string;
			requestedBrowserMicrophoneProfile: string | null;
		}>;
		setRecordingPreferences: (prefs: {
			microphoneEnabled?: boolean;
			microphoneDeviceId?: string;
			microphoneDeviceLabel?: string;
			systemAudioEnabled?: boolean;
			webcamEnabled?: boolean;
			webcamDeviceId?: string;
			webcamDeviceLabel?: string;
		}) => Promise<{ success: boolean; error?: string }>;
		/** Countdown timer before recording */
		getCountdownDelay: () => Promise<{ success: boolean; delay: number }>;
		setCountdownDelay: (delay: number) => Promise<{ success: boolean; error?: string }>;
		finishRecordingStartup: () => Promise<void>;
		startCountdown: (seconds: number) => Promise<{ success: boolean; cancelled?: boolean }>;
		cancelCountdown: () => Promise<{ success: boolean }>;
		getActiveCountdown: () => Promise<{ success: boolean; seconds: number | null }>;
		onCountdownTick: (callback: (seconds: number) => void) => () => void;
	};
}

interface ProcessedDesktopSource {
	id: string;
	name: string;
	display_id: string;
	thumbnail: string | null;
	appIcon: string | null;
	originalName?: string;
	sourceType?: "screen" | "window";
	appName?: string;
	windowTitle?: string;
}

interface CursorTelemetryPoint {
	timeMs: number;
	cx: number;
	cy: number;
	pressure?: number;
	interactionType?:
		| "move"
		| "click"
		| "double-click"
		| "right-click"
		| "middle-click"
		| "mouseup";
	cursorType?:
		| "arrow"
		| "text"
		| "pointer"
		| "crosshair"
		| "open-hand"
		| "closed-hand"
		| "resize-ew"
		| "resize-ns"
		| "not-allowed";
}

interface SystemCursorAsset {
	dataUrl: string;
	hotspotX: number;
	hotspotY: number;
	width: number;
	height: number;
}

interface AutoCaptionCue {
	timeBasis?: "timeline";
	id: string;
	startMs: number;
	endMs: number;
	text: string;
	words?: Array<{
		text: string;
		startMs: number;
		endMs: number;
		leadingSpace?: boolean;
		timingUnreliable?: boolean;
	}>;
}
