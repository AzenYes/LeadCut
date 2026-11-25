import type { ClipRegion, SpeedRegion, TrimRegion } from "@/components/video-editor/types";
import type { FrameRenderer } from "./modernFrameRenderer";
import type { StreamingVideoDecoder } from "./streamingDecoder";

export interface FrameSink<Result = void> {
	start(): Promise<void> | void;
	writeFrame(frameIndex: number, timestampUs: number, durationUs: number): Promise<void> | void;
	finish(): Promise<Result> | Result;
	abort(): void;
}

interface RenderExportFramesOptions<Result> {
	decoder: Pick<StreamingVideoDecoder, "decodeAll">;
	renderer: Pick<FrameRenderer, "renderFrame">;
	frameRate: number;
	trimRegions?: TrimRegion[];
	speedRegions?: SpeedRegion[];
	clipRegions?: ClipRegion[];
	isCancelled: () => boolean;
	sink: FrameSink<Result>;
	onFrameWritten: (framesWritten: number) => void;
	onRenderStart?: () => void;
	onRenderFinished?: (frameIndex: number) => void;
	onFramesRendered?: () => Promise<void> | void;
}

export async function renderExportFrames<Result>({
	decoder, renderer, frameRate, trimRegions, speedRegions, clipRegions,
	isCancelled, sink, onFrameWritten, onRenderStart, onRenderFinished, onFramesRendered,
}: RenderExportFramesOptions<Result>): Promise<Result | undefined> {
	const durationUs = 1_000_000 / frameRate;
	let frameIndex = 0;
	let finished = false;

	try {
		if (isCancelled()) return;
		await sink.start();
		if (isCancelled()) return;

		await decoder.decodeAll(frameRate, trimRegions, speedRegions, async (
			frame, _decodedOutputTimeUs, sourceTimeMs, cursorTimeMs,
		) => {
			if (isCancelled()) return;

			// Keep the output clock contiguous across cuts, speed changes and gap frames.
			const timestampUs = frameIndex * durationUs;
			onRenderStart?.();
			await renderer.renderFrame(frame, sourceTimeMs * 1000, cursorTimeMs * 1000, durationUs, timestampUs);
			onRenderFinished?.(frameIndex);

			if (isCancelled()) return;
			const writing = sink.writeFrame(frameIndex, timestampUs, durationUs);
			if (writing) await writing;
			if (isCancelled()) return;
			frameIndex += 1;
			onFrameWritten(frameIndex);
		}, clipRegions);

		await onFramesRendered?.();
		if (isCancelled()) return;
		const result = await sink.finish();
		if (isCancelled()) return;
		finished = true;
		return result;
	} finally {
		if (!finished) sink.abort();
	}
}
