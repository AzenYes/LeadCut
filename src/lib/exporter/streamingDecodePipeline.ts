import { AVSeekFlag, type WebDemuxer } from "web-demuxer";
import type { SpeedRegion, TrimRegion } from "@/components/video-editor/types";
import { getEffectiveVideoStreamDurationSeconds } from "@/lib/mediaTiming";
import {
	buildVideoDecodeFailure,
	buildVideoDecodeRecoveryFailure,
	type DecodedVideoInfo,
	getDecodedFrameTimelineOffsetUs,
	preserveFirstVideoDecodeFailure,
	type VideoDecodeFailureContext,
} from "./streamingDecoderSupport";
import {
	computeVideoSegments,
	segmentFrameCount,
	segmentSourceTime,
	splitVideoSegmentsBySpeed,
	type VideoSegment,
} from "./videoTimelineSegments";

type OnFrameCallback = (
	frame: VideoFrame,
	exportTimestampUs: number,
	sourceTimestampMs: number,
	cursorTimestampMs: number,
) => Promise<void>;

interface StreamingDecodeContext {
	demuxer: WebDemuxer;
	readonly videoDecoderConfig?: VideoDecoderConfig;
	decoder: VideoDecoder | null;
	readonly cancelled: boolean;
	readonly signal: AbortSignal;
	readonly metadata: DecodedVideoInfo;
	pendingFrames: VideoFrame[];
	readonly maxDecodeQueue: number;
	readonly maxPendingFrames: number;
}

const STARTUP_STABILIZATION_SECONDS = 1.25;
const STARTUP_MAX_DECODE_QUEUE = 12;
const STARTUP_MAX_PENDING_FRAMES = 28;

export async function decodeVideoStream(
	context: StreamingDecodeContext,
	targetFrameRate: number,
	trimRegions: TrimRegion[] | undefined,
	speedRegions: SpeedRegion[] | undefined,
	onFrame: OnFrameCallback,
	segmentsOverride?: VideoSegment[],
): Promise<void> {
	let emittedFrames = 0;
	let renderFailed = false;
	const renderFrame: OnFrameCallback = async (...args) => {
		try {
			await onFrame(...args);
		} catch (error) {
			renderFailed = true;
			throw error;
		}
	};
	const startSec = segmentsOverride?.[0]?.startSec ?? 0;
	let readStartSec = startSec >= 4 ? startSec - 2 : 0;
	const decode = () => decodeVideoStreamAttempt(
		context,
		targetFrameRate,
		trimRegions,
		speedRegions,
		async (...args) => {
			await renderFrame(...args);
			emittedFrames++;
		},
		segmentsOverride,
		false,
		readStartSec,
	);
	try {
		try {
			await decode();
		} catch (error) {
			if (!readStartSec || emittedFrames || renderFailed || context.cancelled || context.decoder !== null) throw error;
			console.warn("[StreamingVideoDecoder] Keyframe seek failed; decoding from the source start", error);
			readStartSec = 0;
			await decode();
		}
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		const codec = context.metadata.codec.toLowerCase();
		// Only retry failures that completed the decode-error cleanup. Configuration
		// and renderer/encoder callback failures must propagate without replay.
		if (
			renderFailed ||
			context.cancelled ||
			context.decoder !== null ||
			codec.includes("av01") ||
			codec.includes("av1") ||
			!/^\[VIDEO_DECODE_ENCODING_ERROR\]|^\[VIDEO_DECODER_RESOURCE_EXHAUSTED\]/.test(message)
		) {
			throw error;
		}
		console.warn(
			"[StreamingVideoDecoder] Decoder failed; replaying with software decoding",
			error,
		);
		// Replay from a keyframe to rebuild decoder state. Output already handed to
		// the renderer/encoder must not be submitted again.
		let replayedFrames = 0;
		try {
			await decodeVideoStreamAttempt(
				context,
				targetFrameRate,
				trimRegions,
				speedRegions,
				async (...args) => {
					if (replayedFrames++ < emittedFrames) return;
					await renderFrame(...args);
				},
				segmentsOverride,
				true,
				readStartSec,
			);
		} catch (softwareError) {
			if (renderFailed) throw softwareError;
			const softwareMessage =
				softwareError instanceof Error ? softwareError.message : String(softwareError);
			if (!/^\[VIDEO_(?:DECODE|DECODER|CODEC)_/.test(softwareMessage)) throw softwareError;
			throw buildVideoDecodeRecoveryFailure(error, softwareError);
		}
	}
}

async function decodeVideoStreamAttempt(
	context: StreamingDecodeContext,

	targetFrameRate: number,
	trimRegions: TrimRegion[] | undefined,
	speedRegions: SpeedRegion[] | undefined,
	onFrame: OnFrameCallback,
	segmentsOverride?: VideoSegment[],
	forceSoftwareDecode = false,
	readStartSec = 0,
): Promise<void> {
	if (!context.demuxer || !context.metadata) {
		throw new Error("Must call loadMetadata() before decodeAll()");
	}
	if (context.cancelled) return;

	const decoderConfig = context.videoDecoderConfig ?? await context.demuxer.getDecoderConfig("video");
	if (context.cancelled) return;
	const codec = context.metadata.codec.toLowerCase();
	const shouldPreferSoftwareDecode =
		forceSoftwareDecode || codec.includes("av01") || codec.includes("av1");
	const effectiveVideoDuration = getEffectiveVideoStreamDurationSeconds({
		duration: context.metadata.duration,
		streamDuration: context.metadata.streamDuration,
	});
	const segments =
		segmentsOverride ??
		splitVideoSegmentsBySpeed(
			computeVideoSegments(effectiveVideoDuration, trimRegions),
			speedRegions,
		);
	const segmentOutputFrameCounts = segments.map((segment) =>
		segmentFrameCount(segment, targetFrameRate),
	);
	const expectedOutputFrames = segmentOutputFrameCounts.reduce((sum, count) => sum + count, 0);
	const frameDurationUs = 1_000_000 / targetFrameRate;
	const epsilonSec = 0.001;
	const startupStabilizationSeconds = STARTUP_STABILIZATION_SECONDS;
	const startupFrameBudget = Math.max(
		1,
		Math.round(targetFrameRate * startupStabilizationSeconds),
	);
	let exportFrameIndex = 0;
	let loggedSteadyStateBackpressure = false;
	const backpressureWaiters = new Set<() => void>();

	const notifyBackpressureProgress = () => {
		if (backpressureWaiters.size === 0) {
			return;
		}

		const waiters = [...backpressureWaiters];
		backpressureWaiters.clear();
		for (const resolve of waiters) {
			resolve();
		}
	};

	const waitForBackpressureProgress = () =>
		new Promise<void>((resolve) => {
			backpressureWaiters.add(resolve);
		});

	console.log(
		`[StreamingVideoDecoder] Startup-safe decode backpressure active for first ${startupStabilizationSeconds}s (${startupFrameBudget} frames)`,
	);

	// Async frame queue — decoder pushes, consumer pulls
	context.pendingFrames.length = 0;
	const pendingFrames = context.pendingFrames;
	let frameResolve: ((frame: VideoFrame | null) => void) | null = null;
	let decodeError: Error | null = null;
	let decodeDone = false;
	let firstDecodedFrameTimestampUs: number | null = null;
	let decodedFrameTimelineOffsetUs = 0;
	let submittedChunkCount = 0;
	let lastSubmittedChunk: EncodedVideoChunk | undefined;
	let lastSubmittedChunkIndex: number | undefined;
	const preferredDecoderConfig = shouldPreferSoftwareDecode
		? {
				...decoderConfig,
				hardwareAcceleration: "prefer-software" as const,
			}
		: decoderConfig;
	let activeDecoderConfig = preferredDecoderConfig;
	const getDecoderFailureContext = (): VideoDecodeFailureContext => ({
		decoderConfig: activeDecoderConfig,
		sourceMetadata: context.metadata ?? undefined,
		chunkIndex: lastSubmittedChunkIndex,
		chunk: lastSubmittedChunk,
		decoderState: context.decoder?.state,
		decodeQueueSize: context.decoder?.decodeQueueSize,
	});
	const recordFirstDecodeError = (error: unknown) => {
		decodeError = preserveFirstVideoDecodeFailure(
			decodeError,
			error,
			getDecoderFailureContext(),
		);
	};

	context.decoder = new VideoDecoder({
		output: (frame: VideoFrame) => {
			if (frameResolve) {
				const resolve = frameResolve;
				frameResolve = null;
				resolve(frame);
			} else {
				pendingFrames.push(frame);
			}
			notifyBackpressureProgress();
		},
		error: (e: DOMException) => {
			recordFirstDecodeError(e);
			if (frameResolve) {
				const resolve = frameResolve;
				frameResolve = null;
				resolve(null);
			}
			notifyBackpressureProgress();
		},
	});
	context.decoder.ondequeue = notifyBackpressureProgress;
	try {
		context.decoder.configure(preferredDecoderConfig);
	} catch (error) {
		if (!shouldPreferSoftwareDecode || forceSoftwareDecode) {
			throw buildVideoDecodeFailure(error, getDecoderFailureContext());
		}
		// Fall back to default decoder config if software preference is unsupported.
		activeDecoderConfig = decoderConfig;
		try {
			context.decoder.configure(decoderConfig);
		} catch (fallbackError) {
			throw buildVideoDecodeFailure(fallbackError, getDecoderFailureContext());
		}
	}

	const getNextFrame = (): Promise<VideoFrame | null> => {
		if (decodeError) return Promise.resolve(null);
		if (pendingFrames.length > 0) {
			const frame = pendingFrames.shift()!;
			notifyBackpressureProgress();
			return Promise.resolve(frame);
		}
		if (decodeDone) return Promise.resolve(null);
		return new Promise((resolve) => {
			frameResolve = resolve;
		});
	};

	// Read from a preceding keyframe for late source in-points.
	// Pass explicit range because some containers are truncated when no end is provided.
	const readEndSec =
		Math.max(
			context.metadata.duration + (context.metadata.mediaStartTime ?? 0),
			(context.metadata.streamDuration ?? context.metadata.duration) +
				(context.metadata.streamStartTime ?? context.metadata.mediaStartTime ?? 0),
		) + 0.5;
	const reader = (readStartSec > 0
		? context.demuxer.read("video", readStartSec + (context.metadata.mediaStartTime ?? 0), readEndSec, AVSeekFlag.AVSEEK_FLAG_BACKWARD)
		: context.demuxer.read("video", 0, readEndSec)).getReader();
	let stopFeeding = false;
	const stopDecode = () => {
		if (stopFeeding) return;
		stopFeeding = true;
		notifyBackpressureProgress();
		void reader.cancel().catch(() => undefined);
		frameResolve?.(null);
		frameResolve = null;
		// Closing also rejects any pending flush so the feeder can finish.
		if (context.decoder?.state === "configured") context.decoder.close();
	};
	context.signal.addEventListener("abort", stopDecode, { once: true });

	// Feed chunks to decoder in background with backpressure
	const feedPromise = (async () => {
		try {
			while (!stopFeeding && !context.cancelled && !decodeError) {
				const { done, value: chunk } = await reader.read();
				if (done || !chunk) break;

				if (!loggedSteadyStateBackpressure && exportFrameIndex >= startupFrameBudget) {
					loggedSteadyStateBackpressure = true;
					console.log(
						"[StreamingVideoDecoder] Switched to steady-state decode backpressure",
					);
				}

				const decodeQueueLimit =
					exportFrameIndex < startupFrameBudget
						? Math.min(context.maxDecodeQueue, STARTUP_MAX_DECODE_QUEUE)
						: context.maxDecodeQueue;
				const pendingFrameLimit =
					exportFrameIndex < startupFrameBudget
						? Math.min(context.maxPendingFrames, STARTUP_MAX_PENDING_FRAMES)
						: context.maxPendingFrames;

				// Backpressure on both decode queue and decoded frame backlog.
				while (
					!stopFeeding &&
					!decodeError &&
					context.decoder!.state === "configured" &&
					(context.decoder!.decodeQueueSize > decodeQueueLimit ||
						pendingFrames.length > pendingFrameLimit) &&
					!context.cancelled
				) {
					await waitForBackpressureProgress();
				}
				if (stopFeeding || context.cancelled || decodeError) break;
				if (context.decoder!.state !== "configured") {
					recordFirstDecodeError(
						new DOMException(
							"Decoder closed before the next video chunk was submitted.",
							"InvalidStateError",
						),
					);
					break;
				}

				lastSubmittedChunk = chunk;
				lastSubmittedChunkIndex = submittedChunkCount;
				context.decoder!.decode(chunk);
				submittedChunkCount++;
			}

			if (!stopFeeding && !context.cancelled && context.decoder!.state === "configured") {
				await context.decoder!.flush();
			}
		} catch (e) {
			if (!stopFeeding) recordFirstDecodeError(e);
		} finally {
			decodeDone = true;
			if (frameResolve) {
				const resolve = frameResolve;
				frameResolve = null;
				resolve(null);
			}
			notifyBackpressureProgress();
		}
	})();

	// Route decoded frames into segments by timestamp, then deliver with VFR→CFR resampling
	let segmentIdx = 0;
	let segmentFrameIndex = 0;
	let lastDecodedFrameSec: number | null = null;
	let heldFrame: VideoFrame | null = null;
	let heldFrameSec = 0;

	const emitHeldFrameForTarget = async (segment: VideoSegment) => {
		if (!heldFrame) return false;
		const segmentFrameCount = segmentOutputFrameCounts[segmentIdx];
		if (segmentFrameIndex >= segmentFrameCount) return false;

		const sourceTimeSec = segmentSourceTime(segment, segmentFrameIndex, targetFrameRate);

		const sourceTimestampMs = sourceTimeSec * 1000;
		await onFrame(
			heldFrame,
			(segment.outputStartSec === undefined
				? exportFrameIndex
				: Math.ceil(segment.outputStartSec * targetFrameRate) + segmentFrameIndex) *
				frameDurationUs,
			sourceTimestampMs,
			sourceTimestampMs,
		);
		segmentFrameIndex++;
		exportFrameIndex++;
		return true;
	};

	let unheldFrame: VideoFrame | null = null;
	try {
		while (!context.cancelled && segmentIdx < segments.length) {
			const frame = await getNextFrame();
			unheldFrame = frame;
			if (!frame || context.cancelled) break;

			if (firstDecodedFrameTimestampUs === null) {
				firstDecodedFrameTimestampUs = frame.timestamp;
				decodedFrameTimelineOffsetUs = getDecodedFrameTimelineOffsetUs(
					firstDecodedFrameTimestampUs,
					context.metadata,
				);
				if (readStartSec > 0 && decodedFrameTimelineOffsetUs / 1_000_000 > segments[0].startSec + epsilonSec) {
					recordFirstDecodeError(new Error("Keyframe seek did not reach the requested source in-point."));
					break;
				}
			}

			const normalizedFrameTimeSec = Math.max(
				0,
				(frame.timestamp - firstDecodedFrameTimestampUs + decodedFrameTimelineOffsetUs) /
					1_000_000,
			);
			const frameTimeSec: number =
				lastDecodedFrameSec === null
					? normalizedFrameTimeSec
					: Math.max(lastDecodedFrameSec, normalizedFrameTimeSec);
			lastDecodedFrameSec = frameTimeSec;

			// Finalize completed segments before handling this frame.
			while (
				segmentIdx < segments.length &&
				frameTimeSec >= segments[segmentIdx].endSec - epsilonSec
			) {
				const segment = segments[segmentIdx];
				while (!context.cancelled && (await emitHeldFrameForTarget(segment))) {
					// Keep emitting remaining output frames for this segment from the last known frame.
				}

				segmentIdx++;
				segmentFrameIndex = 0;
			}

			if (segmentIdx >= segments.length) break;

			const currentSegment = segments[segmentIdx];

			// Keep the nearest pre-roll frame for cuts between source frames.
			if (!heldFrame || frameTimeSec < currentSegment.startSec - epsilonSec) {
				heldFrame?.close();
				heldFrame = frame;
				unheldFrame = null;
				heldFrameSec = frameTimeSec;
				continue;
			}

			// Any target timestamp before this midpoint is closer to heldFrame than current frame.
			const handoffBoundarySec = (heldFrameSec + frameTimeSec) / 2;
			while (!context.cancelled) {
				const segmentFrameCount = segmentOutputFrameCounts[segmentIdx];
				if (segmentFrameIndex >= segmentFrameCount) {
					break;
				}

				const sourceTimeSec = segmentSourceTime(
					currentSegment,
					segmentFrameIndex,
					targetFrameRate,
				);
				if (sourceTimeSec > handoffBoundarySec) {
					break;
				}

				await emitHeldFrameForTarget(currentSegment);
			}

			heldFrame.close();
			heldFrame = frame;
			unheldFrame = null;
			heldFrameSec = frameTimeSec;
		}

		// Flush remaining output frames for the last decoded frame.
		if (!decodeError && heldFrame && segmentIdx < segments.length) {
			while (!context.cancelled && segmentIdx < segments.length) {
				const segment = segments[segmentIdx];
				if (heldFrameSec < segment.startSec - epsilonSec) {
					break;
				}

				while (!context.cancelled && (await emitHeldFrameForTarget(segment))) {
					// Keep emitting output frames for the active segment.
				}

				segmentIdx++;
				segmentFrameIndex = 0;
				if (
					segmentIdx < segments.length &&
					heldFrameSec < segments[segmentIdx].startSec - epsilonSec
				) {
					break;
				}
			}
		}
	} finally {
		context.signal.removeEventListener("abort", stopDecode);
		stopDecode();
		unheldFrame?.close();
		heldFrame?.close();
		await feedPromise;
		for (const frame of pendingFrames) frame.close();
		pendingFrames.length = 0;
		context.decoder = null;
	}

	if (decodeError) {
		throw decodeError;
	}
	if (readStartSec > 0 && !context.cancelled && firstDecodedFrameTimestampUs === null && expectedOutputFrames > 0) {
		throw buildVideoDecodeFailure(new Error("Keyframe seek returned no video frames."), getDecoderFailureContext());
	}

	const requiredEndSec = segments.length > 0 ? segments[segments.length - 1].endSec : 0;
	if (
		!context.cancelled &&
		lastDecodedFrameSec !== null &&
		requiredEndSec - lastDecodedFrameSec > 1 &&
		exportFrameIndex < expectedOutputFrames
	) {
		throw buildVideoDecodeFailure(
			new Error(
				`Video decode ended early at ${lastDecodedFrameSec.toFixed(3)}s (needed ${requiredEndSec.toFixed(3)}s; rendered ${exportFrameIndex}/${expectedOutputFrames} frames).`,
			),
			getDecoderFailureContext(),
		);
	}
}
