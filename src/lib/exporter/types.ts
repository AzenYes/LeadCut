import { uiText } from "@/i18n/uiText";
import type { EncoderRoutePlan, ExportEncodeRoute, ExportRoutePlan, NativeStaticExportRoute } from "./backendPolicy";
export interface ExportConfig {
	width: number;
	height: number;
	frameRate: number;
	bitrate: number;
	codec?: string;
	encodingMode?: ExportEncodingMode;
	backendPreference?: ExportBackendPreference;
	preferredRenderBackend?: ExportRenderBackend;
	experimentalNativeExport?: boolean;
	experimentalNvidiaCudaExport?: boolean;
	maxEncodeQueue?: number;
	maxDecodeQueue?: number;
	maxPendingFrames?: number;
	maxInFlightNativeWrites?: number;
	sourceAudioFallbackStartDelayMsByPath?: Record<string, number>;
}

export type ExportRenderBackend = "webgpu" | "webgl";
export type ExportEncodeBackend = "ffmpeg" | "webcodecs";
export type ExportBackendPreference = "auto" | "webcodecs" | "breeze";
export type ExportPipelineModel = "modern" | "legacy";
export type ExportRouteChange = {
	reason: "native-encoder" | "audio-mux" | "media-reader" | "static-compositor";
	detail: string;
	restarted: boolean;
};

export interface ExportProgress {
	currentFrame: number;
	totalFrames: number;
	percentage: number;
	estimatedTimeRemaining: number; // in seconds
	renderFps?: number;
	renderBackend?: ExportRenderBackend;
	encodeBackend?: ExportEncodeBackend;
	encoderName?: string;
	exportRoute?: ExportEncodeRoute;
	nativeStaticLayoutSkipReason?: string;
	nativeStaticLayoutSkipReasons?: string[];
	phase?: "preparing" | "extracting" | "finalizing" | "saving"; // Phase of export
	renderProgress?: number; // 0-100, progress of GIF rendering phase
	audioProgress?: number; // 0-1, progress of real-time audio rendering (speed/audio regions)
}

export interface ExportFinalizationStageMetrics {
	encoderFlushMs?: number;
	queuedMuxingMs?: number;
	audioProcessingMs?: number;
	muxerFinalizeMs?: number;
	editedAudioRenderMs?: number;
	editedAudioEncodeMs?: number;
	editedAudioWaitMs?: number;
	ffmpegAudioMuxMs?: number;
	nativeExportFinalizeMs?: number;
	nativeEncoderFlushMs?: number;
	ffmpegAudioMuxBreakdown?: ExportFfmpegAudioMuxBreakdown;
}

export interface ExportFfmpegAudioMuxBreakdown {
	tempVideoWriteMs?: number;
	tempEditedAudioWriteMs?: number;
	ffmpegExecMs?: number;
	muxedVideoReadMs?: number;
	tempVideoBytes?: number;
	tempEditedAudioBytes?: number;
	inlineEditedAudioBytes?: number;
	ffmpegMuxOutputWriteBytes?: number;
	muxedVideoBytes?: number;
	chunkCount?: number;
	chunkDurationSec?: number;
	chunkExecMs?: number;
	concatExecMs?: number;
	staticAssetExecMs?: number;
	fallbackChunkCount?: number;
	videoOnlyBytes?: number;
	exportRoutePlan?: ExportRoutePlan<NativeStaticExportRoute>;
	exportRoute?: NativeStaticExportRoute;
	chunks?: Array<{
		index: number;
		startSec: number;
		durationSec: number;
		backend: string;
		elapsedMs: number;
		outputBytes: number;
		fallbackReason?: string;
		windowsGpuSummary?: {
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
			gpuStageTiming?: D3D11GpuStageTiming;
			mediaFoundationOutputTiming?: MediaFoundationOutputTiming;
			finalizeMs?: number;
			realtimeMultiplier?: number;
		};
	}>;
}

export interface D3D11GpuStageTiming {
	sampleCount: number;
	submittedSamples: number;
	sampleStride: number;
	renderMs: number;
	copyConvertMs: number;
	readbackMs: number;
}

export interface MediaFoundationOutputTiming {
	queries: number;
	successfulQueries: number;
	queryMs: number;
	submittedFrames: number;
	encodedFramesBeforeFinalize: number;
	encodedFrames: number;
	processedFrames: number;
	/** Compressed payload accepted by the media sink before container writes. */
	processedBytes: number;
	firstOutputObservedMs?: number;
	lastOutputObservedMs?: number;
	/** Submit to the first statistics query that observed this exact output timestamp. */
	observedOutputLatencyMs?: ExportFrameTimingDistribution;
}

export interface ExportFrameTimingDistribution {
	sampleCount: number;
	p50: number;
	p95: number;
}

export interface ExportMetrics {
	totalElapsedMs: number;
	metadataLoadMs?: number;
	rendererInitMs?: number;
	nativeSessionStartMs?: number;
	decodeLoopMs?: number;
	frameCallbackMs?: number;
	renderFrameMs?: number;
	/** Sampled render start to completion fence on WebGPU, including queued GPU work. */
	gpuRenderCompletionMs?: ExportFrameTimingDistribution;
	/** Sampled encode submission to matching WebCodecs output, including conversion and queueing. */
	frameEncodeLatencyMs?: ExportFrameTimingDistribution;
	encodeWaitMs?: number;
	framePreparationMs?: number;
	encodeWaitEvents?: number;
	peakEncodeQueueSize?: number;
	peakNativeWriteInFlight?: number;
	/** Canvas frame construction on the native streaming route, included in framePreparationMs. */
	nativeCaptureMs?: number;
	/** Wall time with at least one encoded-video IPC write awaiting acknowledgement. */
	nativeWriteMs?: number;
	finalizationMs?: number;
	frameCount?: number;
	renderBackend?: ExportRenderBackend;
	encodeBackend?: ExportEncodeBackend;
	encoderName?: string;
	exportRoute?: ExportEncodeRoute;
	exportRoutePlan?: EncoderRoutePlan;
	gpuReadbackRecovery?: "canvas-in-place" | "restart";
	backpressureProfile?: string;
	routeChanges?: ExportRouteChange[];
	nativeStaticLayoutSkipReason?: string;
	nativeStaticLayoutSkipReasons?: string[];
	averageFrameCallbackMs?: number;
	averageRenderFrameMs?: number;
	averageEncodeWaitMs?: number;
	averageNativeCaptureMs?: number;
	averageNativeWriteMs?: number;
	effectiveDurationSec?: number;
	finalizationStageMs?: ExportFinalizationStageMetrics;
}

export interface ExportResult {
	success: boolean;
	/**
	 * Absolute path to a main-process temp file containing the finished export.
	 * Preferred for MP4 output because it avoids loading multi-gigabyte files
	 * into the renderer's ArrayBuffer heap. The renderer should move the temp
	 * file to its final destination via `finalize-exported-video`.
	 */
	tempFilePath?: string;
	/**
	 * In-renderer Blob for exports that fit in memory (GIF, smoke tests, legacy
	 * fallback). Mutually exclusive with `tempFilePath` — consumers should
	 * prefer the temp path when both are set.
	 */
	blob?: Blob;
	filePath?: string;
	error?: string;
	metrics?: ExportMetrics;
}

export interface VideoFrameData {
	frame: VideoFrame;
	timestamp: number; // in microseconds
	duration: number; // in microseconds
}

export type ExportEncodingMode = "fast" | "balanced" | "quality";

export const MP4_RESOLUTION_TIERS = ["1080p", "1440p", "2160p", "source"] as const;
export type ExportQuality = (typeof MP4_RESOLUTION_TIERS)[number];

export type ExportMp4FrameRate = 24 | 30 | 60;

// GIF Export Types
export type ExportFormat = "mp4" | "gif";

export type GifFrameRate = 15 | 20 | 25 | 30;

export type GifSizePreset = "medium" | "large" | "original";

export interface GifExportConfig {
	frameRate: GifFrameRate;
	loop: boolean;
	sizePreset: GifSizePreset;
	width: number;
	height: number;
}

export interface ExportSettings {
	format: ExportFormat;
	includeCaptionSidecar?: boolean;
	// MP4 settings
	quality?: ExportQuality;
	bitrateMbps?: number | null;
	encodingMode?: ExportEncodingMode;
	mp4FrameRate?: ExportMp4FrameRate;
	backendPreference?: ExportBackendPreference;
	pipelineModel?: ExportPipelineModel;
	// GIF settings
	gifConfig?: GifExportConfig;
}

export const MP4_FRAME_RATES: readonly ExportMp4FrameRate[] = [24, 30, 60] as const;

export function isValidMp4FrameRate(rate: number): rate is ExportMp4FrameRate {
	return MP4_FRAME_RATES.includes(rate as ExportMp4FrameRate);
}

export const GIF_SIZE_PRESETS: Record<GifSizePreset, { maxHeight: number; label: string }> = {
	medium: { maxHeight: 720, get label() { return uiText("medium720p"); } },
	large: { maxHeight: 1080, get label() { return uiText("large1080p"); } },
	original: { maxHeight: Infinity, get label() { return uiText("original"); } },
};

export const GIF_FRAME_RATES: { value: GifFrameRate; label: string }[] = [
	{ value: 15, get label() { return uiText("15FPSBalanced"); } },
	{ value: 20, get label() { return uiText("20FPSSmooth"); } },
	{ value: 25, get label() { return uiText("25FPSVerySmooth"); } },
	{ value: 30, get label() { return uiText("30FPSMaximum"); } },
];

// Valid frame rates for validation
export const VALID_GIF_FRAME_RATES: readonly GifFrameRate[] = [15, 20, 25, 30] as const;

export function isValidGifFrameRate(rate: number): rate is GifFrameRate {
	return VALID_GIF_FRAME_RATES.includes(rate as GifFrameRate);
}
