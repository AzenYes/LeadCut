import { describe, expect, it, vi } from "vitest";

import { AudioProcessor, softLimitOfflineMixPeaksInPlace } from "./audioEncoder";

type OfflineRenderTestHarness = AudioProcessor & {
	decodeAudioFromUrl(url: string): Promise<AudioBuffer | null>;
	getMediaDurationSec(url: string): Promise<number>;
	loadAudioFileDemuxer(audioPath: string): Promise<unknown>;
	prepareOfflineRender(
		videoUrl: string,
		trimRegions: never[],
		speedRegions: never[],
		audioRegions: never[],
		sourceAudioFallbackPaths: string[],
		sourceAudioFallbackStartDelayMsByPath?: Record<string, number>,
	): Promise<{
		mainBufferEntry: { buffer: AudioBuffer; gain: number } | null;
		companionEntries: Array<{ buffer: AudioBuffer; startDelaySec: number; gain: number }>;
	}>;
	renderAndMuxOfflineAudio(
		videoUrl: string,
		trimRegions: never[],
		speedRegions: never[],
		audioRegions: never[],
		sourceAudioFallbackPaths: string[],
		sourceAudioFallbackStartDelayMsByPath: Record<string, number> | undefined,
		muxer: unknown,
	): Promise<void>;
	renderChunked(
		prepared: {
			mainBufferEntry: null;
			companionEntries: [];
			regionEntries: [];
			mutedSourceOutputRangesSec: [];
			slices: [];
			outputDurationMs: number;
			numChannels: number;
		},
		totalOutputSec: number,
		onChunk: (
			rendered: AudioBuffer,
			outputOffsetSec: number,
			chunkIndex: number,
		) => Promise<void>,
	): Promise<void>;
};

function fakeAudioBuffer(channels: Float32Array[]): AudioBuffer {
	return {
		numberOfChannels: channels.length,
		getChannelData: (channel: number) => channels[channel],
	} as AudioBuffer;
}

describe("AudioProcessor offline render preparation", () => {
	it.each([true, false])("requests exact source frames and accepts a short decoded tail with a shared reader set to %s", async sharedReader => {
		const processor = new AudioProcessor(true) as unknown as {
			loadOfflineAudioInput(url: string): Promise<import("./audioProcessorShared").OfflineAudioInput>;
			releaseOfflineAudioSources(): Promise<void>;
		};
		const stage = vi.fn().mockResolvedValue({
			memoryWindows: true, frames: 313, channels: 1, sampleRate: 10, sourceDurationSec: 31.3,
		});
		const read = vi.fn().mockResolvedValue(Uint8Array.of(0, 64, 0, 128));
		const fetchRange = vi.fn();
		const open = vi.fn().mockResolvedValue("shared-reader");
		const close = vi.fn().mockResolvedValue(undefined);
		vi.stubGlobal("window", { electronAPI: {
			prepareExportAudioPcm: stage, readExportAudioPcmWindow: read,
			...(sharedReader ? { openExportAudioPcmReader: open, closeExportAudioPcmReader: close } : {}),
		} });
		vi.stubGlobal("fetch", fetchRange);
		try {
			const input = await processor.loadOfflineAudioInput("file:///tmp/source.mp4");
			if (!("readWindow" in input)) throw new Error("Expected an audio window reader");
			const data = new Float32Array(2);
			const buffer = { getChannelData: () => data } as unknown as AudioBuffer;
			const context = { createBuffer: vi.fn().mockReturnValue(buffer) } as unknown as BaseAudioContext;
			const tail = await input.readWindow(context, 31.25, 0.15, 0.1);
			expect(stage.mock.calls[0].slice(1)).toEqual([undefined, true]);
			expect(read.mock.calls[0][1]).toEqual({ firstFrame: 311, endFrame: 315, channels: 1, sampleRate: 10 });
			expect(read.mock.calls[0][2]).toBe(sharedReader ? "shared-reader" : undefined);
			expect(fetchRange).not.toHaveBeenCalled();
			expect(tail.offsetSec).toBeCloseTo(0.15);
			expect([...data]).toEqual([0.5, -1]);
		} finally {
			await processor.releaseOfflineAudioSources();
			vi.unstubAllGlobals();
		}
		if (sharedReader) {
			expect(open).toHaveBeenCalledTimes(1);
			expect(close).toHaveBeenCalledExactlyOnceWith("shared-reader");
		}
	});

	it.each(["file", "memory"])("reads compact PCM from %s while retaining absolute source timing", async location => {
		const processor = new AudioProcessor() as unknown as {
			loadOfflineAudioInput(url: string): Promise<import("./audioProcessorShared").OfflineAudioInput>;
		};
		const samples = new ArrayBuffer(4);
		new DataView(samples).setInt16(0, 16_384, true);
		const pcm = new Uint8Array(200);
		pcm.set(new Uint8Array(samples), 24);
		const stage = vi.fn().mockResolvedValue({
			...(location === "file" ? { path: "audio.pcm", url: "http://localhost/audio.pcm" } : { pcm }),
			frames: 100, channels: 1, sampleRate: 10, firstFrame: 300, sourceDurationSec: 600,
		});
		const fetchRange = vi.fn().mockResolvedValue(new Response(samples, { status: 206 }));
		vi.stubGlobal("window", { electronAPI: { prepareExportAudioPcm: stage } });
		vi.stubGlobal("fetch", fetchRange);
		try {
			const input = await processor.loadOfflineAudioInput("file:///tmp/source.mp4");
			expect(input.duration).toBe(600);
			if (!("readWindow" in input)) throw new Error("Expected a staged PCM source");
			const data = new Float32Array(2);
			const buffer = { getChannelData: () => data } as unknown as AudioBuffer;
			const context = { createBuffer: vi.fn().mockReturnValue(buffer) } as unknown as BaseAudioContext;
			const window = await input.readWindow(context, 31.25, 0.1);
			if (location === "file") {
				expect(fetchRange).toHaveBeenCalledWith("http://localhost/audio.pcm", expect.objectContaining({
					headers: { Range: "bytes=24-27" },
				}));
			} else {
				expect(fetchRange).not.toHaveBeenCalled();
			}
			expect(window.offsetSec).toBeCloseTo(0.05);
			expect([...data]).toEqual([0.5, 0]);
		} finally {
			vi.unstubAllGlobals();
		}
	});

	it("renders a single full-length clip when only its per-clip audio settings changed", async () => {
		const processor = new AudioProcessor();
		const render = vi.spyOn(processor as unknown as OfflineRenderTestHarness, "renderAndMuxOfflineAudio").mockResolvedValue();
		const clips = [{ id: "clip", startMs: 0, endMs: 1000, sourceStartMs: 0, speed: 1 }];
		const settings = { clip: { mixed: { volume: 0.2, normalize: false } } };
		const muxer = {} as never;
		await processor.process(null, muxer, "recording.mp4", [], [], undefined, [], [], undefined, {}, clips, settings);
		expect(render).toHaveBeenCalledWith("recording.mp4", [], [], [], [], undefined, {}, clips, muxer, settings);
	});
	it("routes a muted full-track clip through offline audio rendering", async () => {
		const processor = new AudioProcessor();
		const render = vi.spyOn(processor as unknown as OfflineRenderTestHarness,
			"renderAndMuxOfflineAudio").mockResolvedValue();
		const clips = [{ id: "clip", startMs: 0, endMs: 1000, sourceStartMs: 0, speed: 1, muted: true }];
		const muxer = {} as never;
		await processor.process(null, muxer, "recording.mp4", [], [], undefined,
			[], [], undefined, undefined, clips);
		expect(render).toHaveBeenCalledWith("recording.mp4", [], [], [], [],
			undefined, undefined, clips, muxer, undefined);
	});

	it("rejects a cancelled chunked render instead of returning a partial WAV", async () => {
		const processor = new AudioProcessor() as unknown as OfflineRenderTestHarness;
		vi.spyOn(processor, "prepareOfflineRender").mockResolvedValue({
			mainBufferEntry: null,
			companionEntries: [],
			outputDurationMs: 1000,
			numChannels: 2,
		} as never);
		vi.spyOn(processor, "renderChunked").mockImplementation(async () => processor.cancel());
		await expect(processor.renderEditedAudioTrack("source.mp4")).rejects.toThrow(
			"Export cancelled",
		);
	});
	it("keeps embedded source audio separate from external companion sidecars", async () => {
		const processor = new AudioProcessor() as unknown as OfflineRenderTestHarness;
		const mainBuffer = { duration: 10, numberOfChannels: 2 } as AudioBuffer;
		const micBuffer = { duration: 9.5, numberOfChannels: 1 } as AudioBuffer;

		const decodeAudioFromUrl = vi
			.spyOn(processor, "decodeAudioFromUrl")
			.mockImplementation(async (url: string) => {
				if (url === "file:///tmp/recording.mp4") {
					return mainBuffer;
				}
				if (url === "/tmp/recording.mic.wav") {
					return micBuffer;
				}
				return null;
			});
		vi.spyOn(processor, "getMediaDurationSec").mockResolvedValue(10);

		const prepared = await processor.prepareOfflineRender(
			"file:///tmp/recording.mp4",
			[],
			[],
			[],
			["/tmp/recording.mp4", "/tmp/recording.mic.wav"],
		);

		expect(prepared.mainBufferEntry?.buffer).toBe(mainBuffer);
		expect(prepared.mainBufferEntry?.gain).toBe(1);
		expect(prepared.companionEntries).toHaveLength(1);
		expect(prepared.companionEntries[0]?.buffer).toBe(micBuffer);
		expect(prepared.companionEntries[0]?.gain).toBe(1);
		expect(decodeAudioFromUrl).toHaveBeenCalledWith("file:///tmp/recording.mp4");
		expect(decodeAudioFromUrl).toHaveBeenCalledWith("/tmp/recording.mic.wav");
		expect(decodeAudioFromUrl).not.toHaveBeenCalledWith("/tmp/recording.mp4");
	});

	it("does not treat a single embedded fallback path as an external sidecar", async () => {
		const processor = new AudioProcessor() as unknown as OfflineRenderTestHarness;
		const loadAudioFileDemuxer = vi.spyOn(processor, "loadAudioFileDemuxer");
		const renderAndMuxOfflineAudio = vi
			.spyOn(processor, "renderAndMuxOfflineAudio")
			.mockResolvedValue();

		await processor.process(
			null,
			{} as never,
			"file:///tmp/recording.mp4",
			[],
			[],
			undefined,
			[],
			["/tmp/recording.mp4"],
		);

		expect(loadAudioFileDemuxer).not.toHaveBeenCalled();
		expect(renderAndMuxOfflineAudio).not.toHaveBeenCalled();
	});

	it("uses recorded companion start-delay metadata instead of inferring from duration gap", async () => {
		const processor = new AudioProcessor() as unknown as OfflineRenderTestHarness;
		const mainBuffer = { duration: 600, numberOfChannels: 2 } as AudioBuffer;
		const micBuffer = { duration: 565, numberOfChannels: 1 } as AudioBuffer;

		vi.spyOn(processor, "decodeAudioFromUrl").mockImplementation(async (url: string) => {
			if (url === "file:///tmp/recording.mp4") {
				return mainBuffer;
			}
			if (url === "/tmp/recording.mic.webm") {
				return micBuffer;
			}
			return null;
		});

		const prepared = await processor.prepareOfflineRender(
			"file:///tmp/recording.mp4",
			[],
			[],
			[],
			["/tmp/recording.mic.webm"],
			{ "/tmp/recording.mic.webm": 3_500 },
		);

		expect(prepared.companionEntries[0]?.startDelaySec).toBeCloseTo(3.5);
	});

	it("avoids the single-sidecar fast path when companion timing metadata is present", async () => {
		const processor = new AudioProcessor() as unknown as OfflineRenderTestHarness;
		const loadAudioFileDemuxer = vi.spyOn(processor, "loadAudioFileDemuxer");
		const renderAndMuxOfflineAudio = vi
			.spyOn(processor, "renderAndMuxOfflineAudio")
			.mockResolvedValue();

		await processor.process(
			null,
			{} as never,
			"file:///tmp/recording.mp4",
			[],
			[],
			undefined,
			[],
			["/tmp/recording.mic.webm"],
			{ "/tmp/recording.mic.webm": 2_000 },
		);

		expect(loadAudioFileDemuxer).not.toHaveBeenCalled();
		expect(renderAndMuxOfflineAudio).toHaveBeenCalled();
	});

	it("avoids the single-sidecar fast path for legacy mac mic sidecars that still need embedded audio", async () => {
		const processor = new AudioProcessor() as unknown as OfflineRenderTestHarness;
		const loadAudioFileDemuxer = vi.spyOn(processor, "loadAudioFileDemuxer");
		const renderAndMuxOfflineAudio = vi
			.spyOn(processor, "renderAndMuxOfflineAudio")
			.mockResolvedValue();

		await processor.process(
			{} as never,
			{} as never,
			"file:///tmp/recording.mp4",
			[],
			[],
			undefined,
			[],
			["/tmp/recording.mic.m4a"],
		);

		expect(loadAudioFileDemuxer).not.toHaveBeenCalled();
		expect(renderAndMuxOfflineAudio).toHaveBeenCalled();
	});

	it("soft-limits mixed peaks before encoding or WAV conversion", () => {
		const samples = new Float32Array([
			-1.6,
			-0.5,
			Number.NEGATIVE_INFINITY,
			Number.NaN,
			0,
			0.5,
			0.95,
			Number.POSITIVE_INFINITY,
			1.6,
		]);
		const changed = softLimitOfflineMixPeaksInPlace(fakeAudioBuffer([samples]));

		expect(changed).toBe(true);
		expect(samples[0]).toBeGreaterThanOrEqual(-0.986);
		expect(samples[1]).toBe(-0.5);
		expect(samples[2]).toBe(0);
		expect(samples[3]).toBe(0);
		expect(samples[5]).toBe(0.5);
		expect(samples[6]).toBeLessThan(0.95);
		expect(samples[6]).toBeGreaterThan(0.9);
		expect(samples[7]).toBe(0);
		expect(samples[8]).toBeLessThanOrEqual(0.986);
	});

	it("runs the offline mix limiter for every rendered chunk", async () => {
		const processor = new AudioProcessor() as unknown as OfflineRenderTestHarness;
		const renderedSamples = new Float32Array([1.4]);
		const renderedBuffer = fakeAudioBuffer([renderedSamples]);
		const originalOfflineAudioContext = globalThis.OfflineAudioContext;
		(
			globalThis as unknown as { OfflineAudioContext: typeof OfflineAudioContext }
		).OfflineAudioContext = class {
			constructor() {}

			startRendering() {
				return Promise.resolve(renderedBuffer);
			}
		} as unknown as typeof OfflineAudioContext;

		try {
			let observedPeak = Number.POSITIVE_INFINITY;
			await processor.renderChunked(
				{
					mainBufferEntry: null,
					companionEntries: [],
					regionEntries: [],
					mutedSourceOutputRangesSec: [],
					slices: [],
					outputDurationMs: 100,
					numChannels: 1,
				},
				0.1,
				async (rendered) => {
					observedPeak = rendered.getChannelData(0)[0] ?? 0;
				},
			);

			expect(observedPeak).toBeLessThanOrEqual(0.986);
		} finally {
			(
				globalThis as unknown as { OfflineAudioContext: typeof OfflineAudioContext }
			).OfflineAudioContext = originalOfflineAudioContext;
		}
	});
});
