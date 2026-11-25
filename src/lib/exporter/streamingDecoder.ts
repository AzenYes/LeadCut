import { WebDemuxer } from "web-demuxer";
import {
	type ClipRegion,
	type SpeedRegion,
	type TrimRegion,
	getTimelineDurationMs,
	findClipAtTimelineTime,
} from "@/components/video-editor/types";
import { getEffectiveVideoStreamDurationSeconds } from "@/lib/mediaTiming";
import { createFallbackDemuxerSource, resolveMediaResourceUrl } from "./localMediaSource";
import { decodeVideoStream } from "./streamingDecodePipeline";
import {
	buildClipDecodeRuns,
	computeVideoSegments,
	splitVideoSegmentsBySpeed,
} from "./videoTimelineSegments";

const DEFAULT_MAX_DECODE_QUEUE = 12;
const DEFAULT_MAX_PENDING_FRAMES = 32;

import type { DecodedVideoInfo } from "./streamingDecoderSupport";
export {
	buildVideoDecodeFailure,
	getDecodedFrameStartupOffsetUs,
	getDecodedFrameTimelineOffsetUs,
	getVideoDecodeFailureCode,
	preserveFirstVideoDecodeFailure,
	type DecodedVideoInfo,
	type VideoDecodeFailureContext,
} from "./streamingDecoderSupport";

interface StreamingVideoDecoderLoadOptions {
	useFallbackMediaSource?: boolean;
}

/** Decoder retains ownership of the VideoFrame and closes it after use. */
type OnFrameCallback = (
	frame: VideoFrame | null,
	exportTimestampUs: number,
	sourceTimestampMs: number,
	cursorTimestampMs: number,
) => Promise<void>;

export function getMinimumMediaTimelineDurationMs(
	...tracks: (readonly { endMs: number }[] | undefined)[]
): number {
	let endMs = 0;
	for (const track of tracks) {
		for (const region of track ?? []) endMs = Math.max(endMs, region.endMs);
	}
	return endMs;
}

/**
 * Decodes video with web-demuxer and VideoDecoder, from a preceding keyframe
 * when the timeline starts late or skips a long stretch of source footage.
 * Kept frames are resampled to the target frame rate in streaming passes.
 */
export class StreamingVideoDecoder {
	private demuxer: WebDemuxer | null = null;
	private decoder: VideoDecoder | null = null;
	private readonly decodeAbort = new AbortController();
	private metadata: DecodedVideoInfo | null = null;
	private videoDecoderConfig: VideoDecoderConfig | undefined;
	private pendingFrames: VideoFrame[] = [];
	private readonly maxDecodeQueue: number;
	private readonly maxPendingFrames: number;
	private readonly minimumTimelineDurationMs: number;

	private get cancelled() {
		return this.decodeAbort.signal.aborted;
	}

	constructor(options?: {
		minimumTimelineDurationMs?: number;
		maxDecodeQueue?: number;
		maxPendingFrames?: number;
	}) {
		this.minimumTimelineDurationMs = Math.max(0, options?.minimumTimelineDurationMs ?? 0);
		this.maxDecodeQueue = Math.max(
			1,
			Math.floor(options?.maxDecodeQueue ?? DEFAULT_MAX_DECODE_QUEUE),
		);
		this.maxPendingFrames = Math.max(
			1,
			Math.floor(options?.maxPendingFrames ?? DEFAULT_MAX_PENDING_FRAMES),
		);
	}

	async loadMetadata(
		videoUrl: string,
		options: StreamingVideoDecoderLoadOptions = {},
	): Promise<DecodedVideoInfo> {
		this.videoDecoderConfig = undefined;
		if (this.decoder) {
			try {
				if (this.decoder.state === "configured") {
					this.decoder.close();
				}
			} catch {
				// Ignore cleanup errors while reloading metadata.
			}
			this.decoder = null;
		}

		if (this.demuxer) {
			try {
				this.demuxer.destroy();
			} catch {
				// Ignore cleanup errors while reloading metadata.
			}
			this.demuxer = null;
		}

		const resourceUrl = await resolveMediaResourceUrl(videoUrl);

		// Relative URL so it resolves correctly in both dev (http) and packaged (file://) builds
		const wasmUrl = new URL("./wasm/web-demuxer.wasm", window.location.href).href;
		const loadMediaInfo = async (source: string | File) => {
			this.demuxer = new WebDemuxer({ wasmFilePath: wasmUrl });
			await this.demuxer.load(source);
			return this.demuxer.getMediaInfo();
		};

		let mediaInfo;
		if (options.useFallbackMediaSource) {
			mediaInfo = await loadMediaInfo(await createFallbackDemuxerSource(videoUrl));
		} else {
			try {
				mediaInfo = await loadMediaInfo(resourceUrl);
			} catch (error) {
				console.warn(
					"[StreamingVideoDecoder] Direct source load failed, retrying with a fresh media source:",
					error,
				);
				const currentDemuxer = this.demuxer;
				if (currentDemuxer) {
					try {
						(currentDemuxer as unknown as { destroy: () => void }).destroy();
					} catch {
						// Ignore cleanup errors before fallback re-init.
					}
				}
				mediaInfo = await loadMediaInfo(await createFallbackDemuxerSource(videoUrl));
			}
		}

		const videoStreams = mediaInfo.streams.filter((stream) => stream.codec_type_string === "video");
		const [videoStream] = videoStreams;
		// With multiple video tracks, let WebDemuxer choose the preferred stream.
		if (videoStreams.length === 1 && videoStream.codec_string && videoStream.width && videoStream.height) {
			this.videoDecoderConfig = this.getDemuxer()?.genDecoderConfig("video", videoStream);
		}
		const audioStream = mediaInfo.streams.find((s) => s.codec_type_string === "audio");
		const mediaStartTime =
			typeof mediaInfo.start_time === "number" && Number.isFinite(mediaInfo.start_time)
				? mediaInfo.start_time
				: 0;
		const streamStartTime =
			typeof videoStream?.start_time === "number" && Number.isFinite(videoStream.start_time)
				? videoStream.start_time
				: mediaStartTime;

		let frameRate = 60;
		if (videoStream?.avg_frame_rate) {
			const parts = videoStream.avg_frame_rate.split("/");
			if (parts.length === 2) {
				const num = parseInt(parts[0], 10);
				const den = parseInt(parts[1], 10);
				if (den > 0 && num > 0) frameRate = num / den;
			}
		}

		this.metadata = {
			width: videoStream?.width || 1920,
			height: videoStream?.height || 1080,
			duration: mediaInfo.duration,
			mediaStartTime,
			streamStartTime,
			streamDuration:
				typeof videoStream?.duration === "number" && Number.isFinite(videoStream.duration)
					? videoStream.duration
					: undefined,
			frameRate,
			codec: videoStream?.codec_string || "unknown",
			hasAudio: !!audioStream,
			audioCodec: audioStream?.codec_string,
			audioSampleRate:
				typeof audioStream?.sample_rate === "string"
					? Number.parseInt(audioStream.sample_rate, 10)
					: undefined,
		};

		return this.metadata;
	}

	async decodeAll(
		targetFrameRate: number,
		trimRegions: TrimRegion[] | undefined,
		speedRegions: SpeedRegion[] | undefined,
		onFrame: OnFrameCallback,
		clipRegions?: ClipRegion[],
	): Promise<void> {
		if (!this.demuxer || !this.metadata) {
			throw new Error("Must call loadMetadata() before decodeAll()");
		}

		const owner = this;
		const context = {
			demuxer: this.demuxer,
			videoDecoderConfig: this.videoDecoderConfig,
			metadata: this.metadata,
			pendingFrames: this.pendingFrames,
			maxDecodeQueue: this.maxDecodeQueue,
			maxPendingFrames: this.maxPendingFrames,
			signal: this.decodeAbort.signal,
			get cancelled() {
				return owner.cancelled;
			},
			get decoder() {
				return owner.decoder;
			},
			set decoder(value) {
				owner.decoder = value;
			},
		};
		if (!clipRegions) {
			await decodeVideoStream(context, targetFrameRate, trimRegions, speedRegions, onFrame);
			return;
		}
		let nextFrame = 0;
		const emitGapsUntil = async (endFrame: number) => {
			while (!this.cancelled && nextFrame < endFrame) {
				if (findClipAtTimelineTime((nextFrame * 1000) / targetFrameRate, clipRegions)) {
					throw new Error(`Missing decoded clip frame at output frame ${nextFrame}`);
				}
				await onFrame(null, (nextFrame * 1_000_000) / targetFrameRate, 0, 0);
				nextFrame++;
			}
		};
		for (const run of buildClipDecodeRuns(clipRegions)) {
			if (this.cancelled) break;
			await decodeVideoStream(
				context,
				targetFrameRate,
				undefined,
				undefined,
				async (frame, timestamp, source, cursor) => {
					await emitGapsUntil(Math.round((timestamp * targetFrameRate) / 1_000_000));
					if (this.cancelled) return;
					await onFrame(frame, timestamp, source, cursor);
					nextFrame++;
				},
				run,
			);
		}
		await emitGapsUntil(
			Math.ceil(
				this.getEffectiveDuration(undefined, undefined, clipRegions) * targetFrameRate,
			),
		);
	}

	getEffectiveDuration(
		trimRegions?: TrimRegion[],
		speedRegions?: SpeedRegion[],
		clipRegions?: ClipRegion[],
	): number {
		if (!this.metadata) throw new Error("Must call loadMetadata() first");
		if (clipRegions)
			return Math.max(this.minimumTimelineDurationMs, getTimelineDurationMs(clipRegions, this.metadata.duration * 1000)) / 1000;
		const trimSegments = computeVideoSegments(
			getEffectiveVideoStreamDurationSeconds({
				duration: this.metadata.duration,
				streamDuration: this.metadata.streamDuration,
			}),
			trimRegions,
		);
		const speedSegments = splitVideoSegmentsBySpeed(trimSegments, speedRegions);
		return speedSegments.reduce((sum, seg) => sum + (seg.endSec - seg.startSec) / seg.speed, 0);
	}

	cancel(): void {
		this.decodeAbort.abort();
	}

	getDemuxer() {
		return this.demuxer;
	}

	destroy(): void {
		this.cancel();

		if (this.decoder) {
			try {
				if (this.decoder.state === "configured") this.decoder.close();
			} catch {
				/* ignore */
			}
			this.decoder = null;
		}

		if (this.demuxer) {
			try {
				this.demuxer.destroy();
			} catch {
				/* ignore */
			}
			this.demuxer = null;
		}

		for (const frame of this.pendingFrames) {
			try {
				frame.close();
			} catch {
				/* ignore */
			}
		}
		this.pendingFrames.length = 0;
	}
}
