import { AVSeekFlag, WebDemuxer } from "web-demuxer";
import { getEffectiveVideoStreamDurationSeconds } from "@/lib/mediaTiming";
import { createFallbackDemuxerSource, resolveMediaResourceUrl } from "./localMediaSource";
import { getDecodedFrameTimelineOffsetUs } from "./streamingDecoder";

const DEFAULT_MAX_DECODE_QUEUE = 12;
const DEFAULT_MAX_PENDING_FRAMES = 32;

export interface ForwardFrameSourceMetadata {
	width: number;
	height: number;
	duration: number;
	mediaStartTime?: number;
	streamStartTime?: number;
	streamDuration?: number;
	codec: string;
}

/**
 * Forward-only decoded frame source for monotonic timestamp access.
 *
 * This avoids per-frame HTMLVideoElement seeking during export and returns
 * the nearest decoded frame for increasing target timestamps.
 */
export class ForwardFrameSource {
	private demuxer: WebDemuxer | null = null;
	private decoder: VideoDecoder | null = null;
	private readonly controller = new AbortController();
	private readonly cancelFromParent = () => this.cancel();
	private metadata: ForwardFrameSourceMetadata | null = null;
	private pendingFrames: VideoFrame[] = [];
	private frameResolve: ((frame: VideoFrame | null) => void) | null = null;
	private decodeError: Error | null = null;
	private decodeDone = false;
	private feedPromise: Promise<void> | null = null;
	private reader: ReadableStreamDefaultReader<EncodedVideoChunk> | null = null;
	private readerCancellation: Promise<void> | null = null;
	private heldFrame: VideoFrame | null = null;
	private reusableFrames = new WeakMap<VideoFrame, VideoFrame>();
	private heldFrameSec = 0;
	private lastTargetTimeSec = 0;
	private lastFrameIntervalSec = 0;
	private resolvedDecodedDurationSec: number | null = null;
	private firstFrameTimestampUs: number | null = null;
	private frameTimelineOffsetUs = 0;
	private decodeCapacityWaiters = new Set<() => void>();

	constructor(private readonly parentSignal?: AbortSignal) {
		if (parentSignal?.aborted) this.cancel();
		else parentSignal?.addEventListener("abort", this.cancelFromParent, { once: true });
	}

	private get cancelled(): boolean {
		return this.controller.signal.aborted;
	}

	async initialize(videoUrl: string, options?: { startTimeSec?: number }): Promise<ForwardFrameSourceMetadata> {
		const { signal } = this.controller;
		let rejectOnAbort!: () => void;
		const aborted = new Promise<never>((_, reject) => {
			rejectOnAbort = () => reject(signal.reason);
		});
		signal.addEventListener("abort", rejectOnAbort, { once: true });
		try {
			signal.throwIfAborted();
			return await Promise.race([
				this.initializeSource(videoUrl, options?.startTimeSec ?? 0),
				aborted,
			]);
		} catch (error) {
			await this.destroy();
			throw error;
		} finally {
			signal.removeEventListener("abort", rejectOnAbort);
		}
	}

	private async initializeSource(videoUrl: string, startTimeSec: number): Promise<ForwardFrameSourceMetadata> {
		const { signal } = this.controller;
		const resourceUrl = await resolveMediaResourceUrl(videoUrl);
		signal.throwIfAborted();
		const wasmUrl = new URL("./wasm/web-demuxer.wasm", window.location.href).href;
		const loadMediaInfo = async (source: string | File) => {
			signal.throwIfAborted();
			const demuxer = new WebDemuxer({ wasmFilePath: wasmUrl });
			this.demuxer = demuxer;
			await demuxer.load(source);
			signal.throwIfAborted();
			return demuxer.getMediaInfo();
		};

		let mediaInfo;
		try {
			mediaInfo = await loadMediaInfo(resourceUrl);
		} catch (error) {
			signal.throwIfAborted();
			console.warn(
				"[ForwardFrameSource] Direct source load failed, retrying with a fresh media source:",
				error,
			);
			this.destroyDemuxer();
			mediaInfo = await loadMediaInfo(await createFallbackDemuxerSource(videoUrl, signal));
		}

		signal.throwIfAborted();
		const videoStream = mediaInfo.streams.find(
			(stream) => stream.codec_type_string === "video",
		);
		const mediaStartTime =
			typeof mediaInfo.start_time === "number" && Number.isFinite(mediaInfo.start_time)
				? mediaInfo.start_time
				: 0;
		const streamStartTime =
			typeof videoStream?.start_time === "number" && Number.isFinite(videoStream.start_time)
				? videoStream.start_time
				: mediaStartTime;

		this.metadata = {
			width: videoStream?.width || 0,
			height: videoStream?.height || 0,
			duration: mediaInfo.duration,
			mediaStartTime,
			streamStartTime,
			streamDuration:
				typeof videoStream?.duration === "number" && Number.isFinite(videoStream.duration)
					? videoStream.duration
					: undefined,
			codec: videoStream?.codec_string || "unknown",
		};

		await this.startDecoder(startTimeSec);
		signal.throwIfAborted();
		return this.metadata;
	}

	private async startDecoder(startTimeSec = 0): Promise<void> {
		if (this.cancelled) return;
		if (!this.demuxer || !this.metadata) {
			throw new Error("Must call initialize() before starting decoder");
		}

		const decoderConfig = await this.demuxer.getDecoderConfig("video");
		if (this.cancelled) return;
		const codec = this.metadata.codec.toLowerCase();
		const shouldPreferSoftwareDecode = codec.includes("av01") || codec.includes("av1");

		const decoder = new VideoDecoder({
			output: (frame: VideoFrame) => {
				if (this.cancelled) {
					frame.close();
					return;
				}
				if (this.frameResolve) {
					const resolve = this.frameResolve;
					this.frameResolve = null;
					resolve(frame);
				} else {
					this.pendingFrames.push(frame);
				}
				this.notifyDecoderCapacityAvailable();
			},
			error: (error: DOMException) => {
				if (this.cancelled) return;
				this.decodeError = new Error(`VideoDecoder error: ${error.message}`);
				if (this.frameResolve) {
					const resolve = this.frameResolve;
					this.frameResolve = null;
					resolve(null);
				}
				this.notifyDecoderCapacityAvailable();
			},
		});
		this.decoder = decoder;
		// A decoder can accept several input chunks before producing a frame.
		decoder.ondequeue = () => this.notifyDecoderCapacityAvailable();

		const preferredDecoderConfig = shouldPreferSoftwareDecode
			? {
					...decoderConfig,
					hardwareAcceleration: "prefer-software" as const,
				}
			: decoderConfig;

		try {
			decoder.configure(preferredDecoderConfig);
		} catch (error) {
			if (!shouldPreferSoftwareDecode) {
				throw error;
			}
			decoder.configure(decoderConfig);
		}

		const readEndSec =
			Math.max(
				this.metadata.duration + (this.metadata.mediaStartTime ?? 0),
				(this.metadata.streamDuration ?? this.metadata.duration) +
					(this.metadata.streamStartTime ?? this.metadata.mediaStartTime ?? 0),
			) + 0.5;
		const readStartSec = startTimeSec > 0 ? startTimeSec + (this.metadata.mediaStartTime ?? 0) : 0;
		const reader = this.demuxer.read("video", readStartSec, readEndSec, AVSeekFlag.AVSEEK_FLAG_BACKWARD).getReader();
		this.reader = reader;

		this.feedPromise = (async () => {
			try {
				while (!this.cancelled && !this.decodeError) {
					const { done, value: chunk } = await reader.read();
					if (done || !chunk) {
						break;
					}

					while (
						!this.cancelled &&
						!this.decodeError &&
						(decoder.decodeQueueSize > DEFAULT_MAX_DECODE_QUEUE ||
							this.pendingFrames.length > DEFAULT_MAX_PENDING_FRAMES)
					) {
						await this.waitForDecoderCapacity();
					}

					if (this.cancelled || this.decodeError) {
						break;
					}

					decoder.decode(chunk);
				}

				if (!this.cancelled && !this.decodeError && decoder.state === "configured") {
					await decoder.flush();
				}
			} catch (error) {
				if (!this.cancelled) {
					this.decodeError = error instanceof Error ? error : new Error(String(error));
				}
			} finally {
				this.decodeDone = true;
				this.notifyDecoderCapacityAvailable();
				if (this.frameResolve) {
					const resolve = this.frameResolve;
					this.frameResolve = null;
					resolve(null);
				}
			}
		})();
	}

	private getNextFrame(): Promise<VideoFrame | null> {
		if (this.decodeError) {
			throw this.decodeError;
		}

		if (this.pendingFrames.length > 0) {
			const frame = this.pendingFrames.shift()!;
			this.notifyDecoderCapacityAvailable();
			return Promise.resolve(frame);
		}

		if (this.decodeDone) {
			return Promise.resolve(null);
		}

		if (this.frameResolve) {
			throw new Error("Concurrent getFrameAtTime() calls are not supported");
		}

		return new Promise((resolve) => {
			this.frameResolve = resolve;
		});
	}

	private waitForDecoderCapacity(): Promise<void> {
		return new Promise((resolve) => {
			this.decodeCapacityWaiters.add(resolve);
		});
	}

	private notifyDecoderCapacityAvailable(): void {
		if (this.decodeCapacityWaiters.size === 0) {
			return;
		}

		const waiters = [...this.decodeCapacityWaiters];
		this.decodeCapacityWaiters.clear();
		for (const resolve of waiters) {
			resolve();
		}
	}

	private cloneFrame(frame: VideoFrame, reusableFrame?: VideoFrame | null): VideoFrame {
		if (reusableFrame?.displayWidth && this.reusableFrames.get(reusableFrame) === frame) {
			return reusableFrame;
		}

		const clone = new VideoFrame(frame, { timestamp: frame.timestamp });
		if (reusableFrame !== undefined) {
			this.reusableFrames.set(clone, frame);
		}
		return clone;
	}

	/** Pass null to begin reusing frames, then pass back the last caller-owned result. */
	async getFrameAtTime(
		targetTimeSec: number,
		reusableFrame?: VideoFrame | null,
	): Promise<VideoFrame | null> {
		if (!this.metadata) {
			throw new Error("Frame source not initialized");
		}

		const clampedTargetTime = Math.max(
			0,
			Math.min(
				targetTimeSec,
				getEffectiveVideoStreamDurationSeconds({
					duration: this.metadata.duration,
					streamDuration: this.metadata.streamDuration,
				}) || targetTimeSec,
			),
		);
		if (clampedTargetTime + 0.001 < this.lastTargetTimeSec) {
			throw new Error("ForwardFrameSource only supports increasing timestamps");
		}
		this.lastTargetTimeSec = clampedTargetTime;

		if (!this.heldFrame) {
			const firstFrame = await this.getNextFrame();
			if (this.cancelled) {
				firstFrame?.close();
				return null;
			}
			if (!firstFrame) {
				if (this.decodeError) throw this.decodeError;
				return null;
			}
			this.firstFrameTimestampUs = firstFrame.timestamp;
			this.frameTimelineOffsetUs = getDecodedFrameTimelineOffsetUs(
				firstFrame.timestamp,
				this.metadata,
			);
			this.heldFrame = firstFrame;
			this.heldFrameSec = Math.max(0, this.frameTimelineOffsetUs / 1_000_000);
		}

		while (!this.cancelled) {
			const nextFrame = await this.getNextFrame();
			if (this.cancelled) {
				nextFrame?.close();
				return null;
			}
			if (!nextFrame) {
				if (this.decodeError) throw this.decodeError;
				this.resolvedDecodedDurationSec = Math.max(
					this.heldFrameSec,
					this.heldFrameSec + Math.max(0, this.lastFrameIntervalSec),
				);
				return this.cloneFrame(this.heldFrame, reusableFrame);
			}

			const nextFrameSec = Math.max(
				this.heldFrameSec,
				Math.max(
					0,
					(nextFrame.timestamp -
						(this.firstFrameTimestampUs ?? nextFrame.timestamp) +
						this.frameTimelineOffsetUs) /
						1_000_000,
				),
			);
			const handoffBoundarySec = (this.heldFrameSec + nextFrameSec) / 2;
			if (clampedTargetTime <= handoffBoundarySec) {
				this.pendingFrames.unshift(nextFrame);
				return this.cloneFrame(this.heldFrame, reusableFrame);
			}

			this.lastFrameIntervalSec = Math.max(0, nextFrameSec - this.heldFrameSec);
			this.heldFrame.close();
			this.heldFrame = nextFrame;
			this.heldFrameSec = nextFrameSec;
		}

		return null;
	}

	getResolvedDurationSec(): number | null {
		return this.resolvedDecodedDurationSec;
	}

	hasReachedEndOfStream(): boolean {
		return this.decodeDone && this.pendingFrames.length === 0;
	}

	cancel(): void {
		if (this.cancelled) return;
		this.parentSignal?.removeEventListener("abort", this.cancelFromParent);
		this.controller.abort();
		this.notifyDecoderCapacityAvailable();
		if (this.frameResolve) {
			const resolve = this.frameResolve;
			this.frameResolve = null;
			resolve(null);
		}
		if (this.reader) {
			this.readerCancellation = this.reader.cancel().catch(() => {
				// Ignore cancellation errors during shutdown.
			});
		}
		try {
			if (this.decoder && this.decoder.state !== "closed") this.decoder.close();
		} catch {
			// Ignore decoder shutdown errors.
		}
	}

	private destroyDemuxer(): void {
		const demuxer = this.demuxer;
		this.demuxer = null;
		try {
			demuxer?.destroy();
		} catch {
			// Ignore demuxer shutdown errors.
		}
	}

	async destroy(): Promise<void> {
		this.cancel();
		await this.readerCancellation;
		this.reader = null;
		this.readerCancellation = null;

		if (this.feedPromise) {
			try {
				await this.feedPromise;
			} catch {
				// Decoder errors are already surfaced through getFrameAtTime.
			}
			this.feedPromise = null;
		}

		if (this.heldFrame) {
			this.heldFrame.close();
			this.heldFrame = null;
		}

		for (const frame of this.pendingFrames) {
			frame.close();
		}
		this.pendingFrames = [];

		this.decoder = null;

		this.destroyDemuxer();

		this.metadata = null;
		this.decodeDone = false;
		this.decodeError = null;
		this.lastTargetTimeSec = 0;
		this.lastFrameIntervalSec = 0;
		this.resolvedDecodedDurationSec = null;
		this.firstFrameTimestampUs = null;
		this.frameTimelineOffsetUs = 0;
		this.decodeCapacityWaiters.clear();
	}
}
