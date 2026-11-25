import { expect, it, vi } from "vitest";
import { type FrameSink, renderExportFrames } from "./renderExportFrames";
import type { StreamingVideoDecoder } from "./streamingDecoder";

type DecodeAll = StreamingVideoDecoder["decodeAll"];

function stubSink() {
	return {
		start: vi.fn<FrameSink<string>["start"]>(),
		writeFrame: vi.fn<FrameSink<string>["writeFrame"]>(),
		finish: vi.fn<FrameSink<string>["finish"]>().mockResolvedValue("complete"),
		abort: vi.fn<FrameSink<string>["abort"]>(),
	};
}

it("writes frames on one output clock while keeping each source and cursor time", async () => {
	const sourceFrame = { close: vi.fn() } as unknown as VideoFrame;
	const decodeAll = vi.fn<DecodeAll>(async (_rate, _trim, _speed, emit) => {
		await emit(sourceFrame, 90_000, 1350, 240);
		await emit(null, 123_333, 0, 0);
	});
	const renderFrame = vi.fn(async () => {});
	const sink = stubSink();
	const onFrameWritten = vi.fn();
	const clips = [{ id: "cut", startMs: 0, endMs: 30, sourceStartMs: 1350, speed: 1 }];

	const result = await renderExportFrames({
		decoder: { decodeAll }, renderer: { renderFrame }, frameRate: 30, clipRegions: clips,
		isCancelled: () => false, sink, onFrameWritten,
	});

	const duration = 1_000_000 / 30;
	expect(decodeAll).toHaveBeenCalledWith(30, undefined, undefined, expect.any(Function), clips);
	expect(renderFrame.mock.calls).toEqual([
		[sourceFrame, 1_350_000, 240_000, duration, 0],
		[null, 0, 0, duration, duration],
	]);
	expect(sink.start).toHaveBeenCalledBefore(decodeAll);
	expect(sink.writeFrame.mock.calls).toEqual([[0, 0, duration], [1, duration, duration]]);
	expect(sink.writeFrame).toHaveBeenCalledBefore(sink.finish);
	expect(sink.abort).not.toHaveBeenCalled();
	expect(result).toBe("complete");
	expect(onFrameWritten.mock.calls).toEqual([[1], [2]]);
	expect(sourceFrame.close).not.toHaveBeenCalled();
});

it("does not submit an unfinished render when cancellation occurs", async () => {
	let cancelled = false;
	const decodeAll: DecodeAll = async (_rate, _trim, _speed, emit) => {
		await emit(null, 0, 0, 0);
		await emit(null, 40_000, 0, 0);
	};
	const renderFrame = vi.fn(async () => { cancelled = true; });
	const sink = stubSink();
	const onFrameWritten = vi.fn();

	await renderExportFrames({
		decoder: { decodeAll }, renderer: { renderFrame }, frameRate: 25,
		isCancelled: () => cancelled, sink, onFrameWritten,
	});

	expect(renderFrame).toHaveBeenCalledOnce();
	expect(sink.writeFrame).not.toHaveBeenCalled();
	expect(sink.finish).not.toHaveBeenCalled();
	expect(sink.abort).toHaveBeenCalledOnce();
	expect(onFrameWritten).not.toHaveBeenCalled();
});

it("waits for a frame write and propagates its failure before reporting progress", async () => {
	const error = new Error("The output is full");
	const decodeAll: DecodeAll = async (_rate, _trim, _speed, emit) => {
		await emit(null, 0, 0, 0);
		await emit(null, 40_000, 0, 0);
	};
	const renderFrame = vi.fn(async () => {});
	const sink = stubSink();
	sink.writeFrame.mockRejectedValue(error);
	const onFrameWritten = vi.fn();

	await expect(renderExportFrames({
		decoder: { decodeAll }, renderer: { renderFrame }, frameRate: 25,
		isCancelled: () => false, sink, onFrameWritten,
	})).rejects.toBe(error);

	expect(renderFrame).toHaveBeenCalledOnce();
	expect(sink.writeFrame).toHaveBeenCalledOnce();
	expect(sink.finish).not.toHaveBeenCalled();
	expect(sink.abort).toHaveBeenCalledOnce();
	expect(onFrameWritten).not.toHaveBeenCalled();
});

it.each(["start", "finish"] as const)("aborts when the sink cannot %s", async phase => {
	const failed = new Error("Media output failed");
	const sink = stubSink();
	sink[phase].mockRejectedValue(failed);
	const decodeAll = vi.fn<DecodeAll>(async () => {});

	await expect(renderExportFrames({
		decoder: { decodeAll }, renderer: { renderFrame: vi.fn() }, frameRate: 30,
		isCancelled: () => false, sink, onFrameWritten: vi.fn(),
	})).rejects.toBe(failed);

	expect(sink.abort).toHaveBeenCalledOnce();
	expect(decodeAll).toHaveBeenCalledTimes(phase === "start" ? 0 : 1);
});
