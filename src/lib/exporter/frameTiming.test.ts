import { expect, it } from "vitest";
import { ExportFrameTiming } from "./frameTiming";

it("pairs encoder outputs by timestamp and reports only completed samples", () => {
	const timing = new ExportFrameTiming(120);
	timing.startEncoding(0, 0, 5);
	timing.startEncoding(20, 20, 7);
	timing.startEncoding(30, 30, 10);
	timing.startEncoding(60, 60, 11);
	timing.finishEncoding(30, 13);
	timing.finishEncoding(20, 15);
	timing.finishEncoding(0, 23);
	timing.finishEncoding(30, 42);
	timing.finishGpuWork(9);
	timing.finishGpuWork(2);
	expect(timing.getMetrics()).toEqual({
		frameEncodeLatencyMs: { sampleCount: 2, p50: 3, p95: 18 },
		gpuRenderCompletionMs: { sampleCount: 2, p50: 2, p95: 9 },
	});
});
