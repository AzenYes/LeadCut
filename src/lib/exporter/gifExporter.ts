import { streamExportBlobToTempFile } from "@/components/video-editor/export/exportPersistence";
import type { AudioRegion, Padding, TrimRegion } from "@/components/video-editor/types";
import { buildExportFrameRendererConfig, type ExportSceneOptions } from "./exportFrameRendererConfig";
import { GifFrameSink } from "./gifFrameSink";
import type { FrameRenderer } from "./modernFrameRenderer";
import { renderExportFrames } from "./renderExportFrames";
import { getMinimumMediaTimelineDurationMs, StreamingVideoDecoder } from "./streamingDecoder";
import type {
	ExportProgress,
	ExportResult,
	ExportRouteChange,
	GIF_SIZE_PRESETS,
	GifFrameRate,
	GifSizePreset,
} from "./types";

export { getGifRepeat } from "./gifFrameSink";
export { getGifFrameDelayMs } from "./gifTiming";

const PROGRESS_SAMPLE_WINDOW_MS = 1_000;
const GIF_FRAME_BUDGET_BYTES = 1024 ** 3;

export function getGifFrameLimit(width: number, height: number): number {
	return Math.floor(GIF_FRAME_BUDGET_BYTES / (width * height * 4));
}

interface GifExporterConfig extends ExportSceneOptions {
	videoUrl: string;
	frameRate: GifFrameRate;
	loop: boolean;
	sizePreset: GifSizePreset;
	trimRegions?: TrimRegion[];
	videoPadding?: Padding | number;
	audioRegions?: AudioRegion[];
	maxDecodeQueue?: number;
	maxPendingFrames?: number;
	onProgress?: (progress: ExportProgress) => void;
	onRouteChange?: (notice: ExportRouteChange) => void;
}

/**
 * Calculate output dimensions based on size preset and source dimensions while preserving aspect ratio.
 * @param sourceWidth - Original video width
 * @param sourceHeight - Original video height
 * @param sizePreset - The size preset to use
 * @param sizePresets - The size presets configuration
 * @returns The calculated output dimensions
 */
export function calculateOutputDimensions(
	sourceWidth: number,
	sourceHeight: number,
	sizePreset: GifSizePreset,
	sizePresets: typeof GIF_SIZE_PRESETS,
): { width: number; height: number } {
	const preset = sizePresets[sizePreset];
	const maxHeight = preset.maxHeight;

	// If original is smaller than max height or preset is 'original', use source dimensions
	if (sourceHeight <= maxHeight || sizePreset === "original") {
		return { width: sourceWidth, height: sourceHeight };
	}

	// Calculate scaled dimensions preserving aspect ratio
	const aspectRatio = sourceWidth / sourceHeight;
	const newHeight = maxHeight;
	const newWidth = Math.round(newHeight * aspectRatio);

	// Ensure dimensions are even (required for some encoders)
	return {
		width: newWidth % 2 === 0 ? newWidth : newWidth + 1,
		height: newHeight % 2 === 0 ? newHeight : newHeight + 1,
	};
}

export class GifExporter {
	private videoExporter: { cancel(): void } | null = null;
	private gifConversionId: string | null = null;
	private config: GifExporterConfig;
	private streamingDecoder: StreamingVideoDecoder | null = null;
	private renderer: FrameRenderer | null = null;
	private frameSink: GifFrameSink | null = null;
	private cancelled = false;
	private exportStartTimeMs = 0;
	private progressSampleStartTimeMs = 0;
	private progressSampleStartFrame = 0;
	private lastRenderFps: number | undefined;

	constructor(config: GifExporterConfig) {
		this.config = config;
	}

	async export(): Promise<ExportResult> {
		try {
			this.cleanup();
			this.cancelled = false;
			if (typeof window !== "undefined" && window.electronAPI?.convertExportToGif) {
				return await this.exportGifOnDisk();
			}

			this.exportStartTimeMs = this.getNowMs();
			this.progressSampleStartTimeMs = this.exportStartTimeMs;
			this.progressSampleStartFrame = 0;
			this.lastRenderFps = undefined;

			// Initialize streaming decoder and load video metadata
			this.streamingDecoder = new StreamingVideoDecoder({
				minimumTimelineDurationMs: getMinimumMediaTimelineDurationMs(this.config.videoRegions, this.config.audioRegions),
				maxDecodeQueue: this.config.maxDecodeQueue,
				maxPendingFrames: this.config.maxPendingFrames,
			});
			const videoInfo = await this.streamingDecoder.loadMetadata(this.config.videoUrl);
			if (this.cancelled) return { success: false, error: "Export cancelled" };

			const effectiveDuration = this.streamingDecoder.getEffectiveDuration(
				this.config.trimRegions,
				this.config.speedRegions,
				this.config.clipRegions,
			);
			const totalFrames = Math.ceil(effectiveDuration * this.config.frameRate);
			const frameLimit = getGifFrameLimit(this.config.width, this.config.height);
			const assertFrameBudget = (frameCount: number) => {
				if (!Number.isFinite(frameCount) || frameCount > frameLimit) {
					throw new Error("This GIF is too large to export. Shorten it, or lower the resolution or frame rate.");
				}
			};
			assertFrameBudget(totalFrames);

			// Initialize frame renderer
			const { FrameRenderer } = await import("./modernFrameRenderer");
			if (this.cancelled) return { success: false, error: "Export cancelled" };
			this.renderer = new FrameRenderer({
				...buildExportFrameRendererConfig(this.config, videoInfo),
				// The in-memory encoder immediately reads each rendered frame back to the CPU.
				preferredRenderBackend: "webgl",
			});
			await this.renderer.initialize();
			if (this.cancelled) return { success: false, error: "Export cancelled" };

			const renderer = this.renderer;
			const sink = new GifFrameSink({
				width: this.config.width,
				height: this.config.height,
				frameRate: this.config.frameRate,
				loop: this.config.loop,
				getCanvas: () => renderer.getCanvas(),
				checkFrameBudget: assertFrameBudget,
				onFinalizing: renderProgress => this.config.onProgress?.({
					currentFrame: totalFrames,
					totalFrames,
					percentage: 100,
					estimatedTimeRemaining: 0,
					phase: "finalizing",
					renderFps: this.lastRenderFps,
					renderProgress,
				}),
			});
			this.frameSink = sink;

			console.log("[GifExporter] Original duration:", videoInfo.duration, "s");
			console.log("[GifExporter] Effective duration:", effectiveDuration, "s");
			console.log("[GifExporter] Total frames to export:", totalFrames);
			console.log("[GifExporter] Frame rate:", this.config.frameRate, "FPS");
			console.log("[GifExporter] Loop:", this.config.loop ? "infinite" : "once");
			console.log("[GifExporter] Using streaming decode (web-demuxer + VideoDecoder)");

			const blob = await renderExportFrames({
				decoder: this.streamingDecoder,
				renderer,
				sink,
				frameRate: this.config.frameRate,
				trimRegions: this.config.trimRegions,
				speedRegions: this.config.speedRegions,
				clipRegions: this.config.clipRegions,
				isCancelled: () => this.cancelled,
				onFrameWritten: framesWritten => this.reportProgress(framesWritten, totalFrames),
			});

			if (!blob) return { success: false, error: "Export cancelled" };
			return { success: true, blob };
		} catch (error) {
			console.error("GIF Export error:", error);
			return {
				success: false,
				error: error instanceof Error ? error.message : String(error),
			};
		} finally {
			this.cleanup();
		}
	}

	private async exportGifOnDisk(): Promise<ExportResult> {
		const bridge = window.electronAPI;
		const { ModernVideoExporter } = await import("./modernVideoExporter");
		if (this.cancelled) return { success: false, error: "Export cancelled" };
		const { width, height, frameRate, loop, onProgress } = this.config;
		const exporter = new ModernVideoExporter({
			...this.config,
			width: Math.ceil(width / 2) * 2,
			height: Math.ceil(height / 2) * 2,
			bitrate: Math.min(50_000_000, Math.max(1_000_000, Math.round(width * height * frameRate * 0.32))),
			encodingMode: "quality",
			omitAudio: true,
			// The intermediate encoder reads rendered canvas frames.
			preferredRenderBackend: "webgl",
		});
		this.videoExporter = exporter;
		let videoPath: string | null = null;
		try {
			const video = await exporter.export();
			if (video.tempFilePath) videoPath = video.tempFilePath;
			if (this.cancelled) return { success: false, error: "Export cancelled" };
			if (!video.success) return video;
			if (!videoPath && video.blob) videoPath = await streamExportBlobToTempFile(video.blob, "mp4");
			if (!videoPath) throw new Error("Could not prepare the temporary video for GIF export.");
			if (this.cancelled) return { success: false, error: "Export cancelled" };
			const totalFrames = video.metrics?.frameCount ?? 0;
			onProgress?.({ currentFrame: totalFrames, totalFrames, percentage: 100, estimatedTimeRemaining: 0, renderProgress: 0, phase: "finalizing" });
			if (this.cancelled) return { success: false, error: "Export cancelled" };
			const runId = crypto.randomUUID();
			this.gifConversionId = runId;
			const result = await bridge.convertExportToGif!({
				runId, videoPath, fps: frameRate, width, height, loop, frameCount: video.metrics?.frameCount,
			});
			if (this.cancelled) {
				if (result.tempPath) await bridge.discardExportedTemp(result.tempPath).catch(() => undefined);
				return { success: false, error: "Export cancelled" };
			}
			return { success: result.success, error: result.error, tempFilePath: result.tempPath };
		} finally {
			this.videoExporter = null;
			this.gifConversionId = null;
			if (videoPath) await bridge.discardExportedTemp(videoPath).catch(() => undefined);
		}
	}

	private reportProgress(currentFrame: number, totalFrames: number) {
		const nowMs = this.getNowMs();
		const elapsedSeconds = Math.max((nowMs - this.exportStartTimeMs) / 1000, 0.001);
		const averageRenderFps = currentFrame / elapsedSeconds;
		const sampleElapsedMs = Math.max(nowMs - this.progressSampleStartTimeMs, 1);
		const sampleFrameDelta = Math.max(currentFrame - this.progressSampleStartFrame, 0);
		const renderFps = (sampleFrameDelta * 1000) / sampleElapsedMs;
		const remainingFrames = Math.max(totalFrames - currentFrame, 0);
		const estimatedTimeRemaining =
			averageRenderFps > 0 ? remainingFrames / averageRenderFps : 0;
		this.lastRenderFps = renderFps;

		if (sampleElapsedMs >= PROGRESS_SAMPLE_WINDOW_MS) {
			this.progressSampleStartTimeMs = nowMs;
			this.progressSampleStartFrame = currentFrame;
		}

		if (this.config.onProgress) {
			this.config.onProgress({
				currentFrame,
				totalFrames,
				percentage: totalFrames > 0 ? (currentFrame / totalFrames) * 100 : 100,
				estimatedTimeRemaining,
				renderFps,
			});
		}
	}

	private getNowMs(): number {
		return typeof performance !== "undefined" ? performance.now() : Date.now();
	}

	cancel(): void {
		this.cancelled = true;
		this.renderer?.cancelPendingMedia();
		this.videoExporter?.cancel();
		if (this.gifConversionId) void window.electronAPI.cancelExportGif?.(this.gifConversionId).catch(() => undefined);
		if (this.streamingDecoder) {
			this.streamingDecoder.cancel();
		}
		this.frameSink?.abort();
	}

	private cleanup(): void {
		if (this.streamingDecoder) {
			try {
				this.streamingDecoder.destroy();
			} catch (e) {
				console.warn("Error destroying streaming decoder:", e);
			}
			this.streamingDecoder = null;
		}

		if (this.renderer) {
			try {
				this.renderer.destroy();
			} catch (e) {
				console.warn("Error destroying renderer:", e);
			}
			this.renderer = null;
		}

		this.frameSink?.abort();
		this.frameSink = null;
	}
}
