import type { ExportFrameTimingDistribution, ExportMetrics } from "./types";

function summarize(samples: number[]): ExportFrameTimingDistribution | undefined {
	if (samples.length === 0) return undefined;
	const sorted = [...samples].sort((a, b) => a - b);
	return {
		sampleCount: sorted.length,
		p50: sorted[Math.ceil(sorted.length * 0.5) - 1],
		p95: sorted[Math.ceil(sorted.length * 0.95) - 1],
	};
}

export class ExportFrameTiming {
	private readonly interval: number;
	private readonly encodeStarts = new Map<number, number>();
	private readonly encodeSamples: number[] = [];
	private readonly gpuSamples: number[] = [];

	constructor(totalFrames: number) {
		// Keep the samples distributed over the export and bound storage for long projects.
		this.interval = Math.max(30, Math.ceil(totalFrames / 4096));
	}

	shouldSample(frameIndex: number): boolean {
		return frameIndex % this.interval === 0;
	}

	startEncoding(frameIndex: number, timestamp: number, nowMs: number): void {
		if (this.shouldSample(frameIndex)) this.encodeStarts.set(timestamp, nowMs);
	}

	finishEncoding(timestamp: number, nowMs: number): void {
		const start = this.encodeStarts.get(timestamp);
		if (start === undefined) return;
		this.encodeStarts.delete(timestamp);
		this.encodeSamples.push(nowMs - start);
	}

	finishGpuWork(elapsedMs: number): void {
		this.gpuSamples.push(elapsedMs);
	}

	getMetrics(): Pick<ExportMetrics, "gpuRenderCompletionMs" | "frameEncodeLatencyMs"> {
		return {
			gpuRenderCompletionMs: summarize(this.gpuSamples),
			frameEncodeLatencyMs: summarize(this.encodeSamples),
		};
	}
}
