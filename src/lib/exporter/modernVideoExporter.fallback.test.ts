import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { ModernVideoExporter as ModernVideoExporterClass } from "./modernVideoExporter";
import { GpuFramePipelineError } from "./webGpuNv12Readback";

const mocks = vi.hoisted(() => {
	const videoInfo = {
		width: 1920,
		height: 1080,
		duration: 1,
		streamDuration: 1,
		frameRate: 30,
		codec: "h264",
		hasAudio: false,
		audioCodec: null,
		audioSampleRate: null,
	};

	return {
		videoInfo,
		streamingDecoderDestroy: vi.fn(),
		streamingDecoderCancel: vi.fn(),
		streamingDecoderDecodeAll: vi.fn(async () => {}),
		streamingDecoderGetDemuxer: vi.fn(() => null),
		streamingDecoderGetEffectiveDuration: vi.fn(() => 0),
		streamingDecoderLoadMetadata: vi.fn(async () => videoInfo),
		frameRendererDestroy: vi.fn(),
		frameRendererGetBackend: vi.fn(() => "webgl"),
		frameRendererInitialize: vi.fn(async () => {}),
		muxerDestroy: vi.fn(),
		muxerFinalize: vi.fn(async () => ({
			mode: "buffer" as const,
			blob: new Blob([], { type: "video/mp4" }),
		})),
		muxerInitialize: vi.fn(async () => {}),
		muxerFinalizePipe: vi.fn(async () => {}),
	};
});

vi.mock("./streamingDecoder", async (importOriginal) => ({
	...await importOriginal<typeof import("./streamingDecoder")>(),
	StreamingVideoDecoder: vi.fn().mockImplementation(function () {
		return {
			cancel: mocks.streamingDecoderCancel,
			decodeAll: mocks.streamingDecoderDecodeAll,
			destroy: mocks.streamingDecoderDestroy,
			getDemuxer: mocks.streamingDecoderGetDemuxer,
			getEffectiveDuration: mocks.streamingDecoderGetEffectiveDuration,
			loadMetadata: mocks.streamingDecoderLoadMetadata,
		};
	}),
}));

vi.mock("./modernFrameRenderer", () => ({
	FrameRenderer: vi.fn().mockImplementation(function () {
		return {
			cancelPendingMedia: vi.fn(),
			destroy: mocks.frameRendererDestroy,
			getRendererBackend: mocks.frameRendererGetBackend,
			initialize: mocks.frameRendererInitialize,
		};
	}),
}));

vi.mock("./muxer", () => ({
	VideoMuxer: vi.fn().mockImplementation(function () {
		return {
			destroy: mocks.muxerDestroy,
			finalize: mocks.muxerFinalize,
			finalizePipe: mocks.muxerFinalizePipe,
			initialize: mocks.muxerInitialize,
		};
	}),
}));

function mockActiveNativeStream(exporter: object) {
	const stream = exporter as {
		tryStartNativeVideoExport: () => Promise<boolean>;
		nativeExportSessionId: string;
		nativeH264Encoder: Pick<VideoEncoder, "flush" | "close">;
	};
	return vi.spyOn(stream, "tryStartNativeVideoExport").mockImplementation(async () => {
		stream.nativeExportSessionId = "native-stream";
		stream.nativeH264Encoder = { flush: vi.fn(async () => {}), close: vi.fn() };
		return true;
	});
}

describe("ModernVideoExporter native fallback routing", () => {
	let ModernVideoExporter: typeof ModernVideoExporterClass;

	beforeAll(async () => {
		({ ModernVideoExporter } = await import("./modernVideoExporter"));
	}, 30_000);

	afterEach(() => {
		vi.clearAllMocks();
		if (vi.isMockFunction(console.error)) console.error.mockRestore();
		vi.unstubAllGlobals();
	});

	it.each([true, false])("holds the first frame during GPU readback (canvas recovery: %s)", async (canRecover) => {
		const exporter = new ModernVideoExporter({ useGpuFramePipeline: true } as never);
		const readback = Promise.withResolvers<VideoFrame>();
		const internal = exporter as unknown as {
			encodeRenderedFrame: (timestamp: number, duration: number, index: number) => Promise<void>;
			submitRenderedFrame: (timestamp: number, duration: number, index: number) => Promise<void>;
			renderer: {
				takeGpuOutputFrame: () => Promise<VideoFrame>;
				recoverCanvasAfterGpuReadbackFailure: () => Promise<boolean>;
			};
		};
		internal.renderer = {
			takeGpuOutputFrame: () => readback.promise,
			recoverCanvasAfterGpuReadbackFailure: vi.fn(async () => canRecover),
		};
		const submit = vi.spyOn(internal, "submitRenderedFrame").mockResolvedValue(undefined);
		const warning = vi.spyOn(console, "warn").mockImplementation(() => {});
		try {
			const buffered = internal.encodeRenderedFrame(0, 16_667, 0);
			const finished = vi.fn();
			void buffered.then(finished, finished);
			await Promise.resolve();
			await Promise.resolve();
			expect(finished).not.toHaveBeenCalled();
			const error = new GpuFramePipelineError("GPU export frame readback failed");
			readback.reject(error);
			if (canRecover) {
				await buffered;
				expect(submit).toHaveBeenCalledExactlyOnceWith(0, 16_667, 0);
			} else {
				await expect(buffered).rejects.toBe(error);
				expect(submit).not.toHaveBeenCalled();
			}
			expect(internal.renderer.recoverCanvasAfterGpuReadbackFailure).toHaveBeenCalledOnce();
		} finally {
			warning.mockRestore();
		}
	});

	it("removes failed native writes without creating an unhandled rejection", async () => {
		const exporter = new ModernVideoExporter({} as never) as unknown as {
			trackNativeWritePromise: (write: Promise<void>) => void;
			nativeWritePromises: Set<Promise<void>>;
		};
		const write = Promise.reject(new Error("Native write failed"));
		exporter.trackNativeWritePromise(write);
		await expect(write).rejects.toThrow("Native write failed");
		expect(exporter.nativeWritePromises.size).toBe(0);
	});

	it("cancels a pending WebCodecs flush before container finalization", async () => {
		const flushing = Promise.withResolvers<void>();
		const encoderFlush = Promise.withResolvers<void>();
		const encoder = {
			state: "configured",
			flush: vi.fn(() => {
				flushing.resolve();
				return encoderFlush.promise;
			}),
			close: vi.fn(() => {
				encoder.state = "closed";
				encoderFlush.reject(new Error("Encoder closed"));
			}),
		};
		const exporter = new ModernVideoExporter({
			backendPreference: "webcodecs", width: 1920, height: 1080, frameRate: 30,
			bitrate: 6_000_000, videoUrl: "file:///recording.mp4",
		} as never);
		const internal = exporter as unknown as {
			initializeEncoder: () => Promise<unknown>;
			encoder: typeof encoder;
		};
		vi.spyOn(internal, "initializeEncoder").mockImplementation(async () => {
			internal.encoder = encoder;
			return { hardwareAcceleration: "prefer-software" };
		});

		const result = exporter.export();
		await flushing.promise;
		exporter.cancel();

		await expect(result).resolves.toMatchObject({ success: false, error: "Export cancelled" });
		expect(encoder.close).toHaveBeenCalledOnce();
		expect(mocks.muxerFinalize).not.toHaveBeenCalled();
		expect(mocks.muxerDestroy).toHaveBeenCalledOnce();
	});

	it.each([false, true])("collects environment diagnostics only when an export fails (failure: %s)", async (fails) => {
		const getAppVersion = vi.fn(async () => "0.1.2");
		const getExportHardwareInfo = vi.fn(async () => ({ success: false }));
		vi.stubGlobal("window", { electronAPI: { getAppVersion, getExportHardwareInfo } });
		const exporter = new ModernVideoExporter({ backendPreference: "webcodecs", width: 1920,
			height: 1080, frameRate: 30, bitrate: 6_000_000, videoUrl: "file:///recording.mp4" } as never);
		const internal = exporter as unknown as { initializeEncoder: () => Promise<unknown> };
		vi.spyOn(internal, "initializeEncoder").mockImplementation(async () => {
			if (fails) throw new Error("Video encoding not supported");
			return { hardwareAcceleration: "prefer-software" };
		});
		const result = await exporter.export();
		expect(result.success).toBe(!fails);
		expect(getAppVersion).toHaveBeenCalledTimes(fails ? 1 : 0);
		expect(getExportHardwareInfo).toHaveBeenCalledTimes(fails ? 1 : 0);
		if (fails) expect(result.error).toContain("LeadCut version: 0.1.2");
	});

	it("counts overlapping transport writes once and ignores stale write acknowledgements", async () => {
		const first = Promise.withResolvers<{ success: boolean }>();
		const second = Promise.withResolvers<{ success: boolean }>();
		const abandoned = Promise.withResolvers<{ success: boolean }>();
		vi.stubGlobal("window", { electronAPI: {
			nativeVideoExportWriteFrames: vi.fn().mockReturnValueOnce(first.promise)
				.mockReturnValueOnce(second.promise).mockReturnValueOnce(abandoned.promise),
		} });
		const exporter = new ModernVideoExporter({} as never) as unknown as {
			nativeExportSessionId: string;
			nativeWriteTimeMs: number;
			peakNativeWriteInFlight: number;
			writeNativeVideoChunks: (session: string, chunks: Uint8Array[]) => Promise<unknown>;
			getNowMs: () => number;
		};
		exporter.nativeExportSessionId = "first";
		let now = 10;
		vi.spyOn(exporter, "getNowMs").mockImplementation(() => now);
		const video = [new Uint8Array([1])];
		const firstWrite = exporter.writeNativeVideoChunks("first", video);
		now = 15;
		const secondWrite = exporter.writeNativeVideoChunks("first", video);
		now = 20;
		first.resolve({ success: true });
		await firstWrite;
		now = 25;
		second.resolve({ success: true });
		await secondWrite;
		expect(exporter.nativeWriteTimeMs).toBe(15);
		expect(exporter.peakNativeWriteInFlight).toBe(2);
		const abandonedWrite = exporter.writeNativeVideoChunks("first", video);
		exporter.nativeExportSessionId = "retry";
		now = 40;
		abandoned.resolve({ success: true });
		await abandonedWrite;
		expect(exporter.nativeWriteTimeMs).toBe(15);
	});

	it("records both the planned route and the actual fallback on a normal export", async () => {
		vi.stubGlobal("navigator", { platform: "Win32" });
		const nativeVideoExportStart = vi.fn();
		vi.stubGlobal("window", { electronAPI: { nativeVideoExportStart } });
		vi.stubGlobal("VideoEncoder", { isConfigSupported: vi.fn(async () => ({ supported: false })) });
		const onRouteChange = vi.fn();
		const exporter = new ModernVideoExporter({
			backendPreference: "auto", onRouteChange,
			videoUrl: "file:///recording.mp4", wallpaper: "#000000",
			width: 1920, height: 1080, frameRate: 30, bitrate: 8_000_000,
		} as never);
		const internal = exporter as unknown as { initializeEncoder: () => Promise<unknown> };
		vi.spyOn(internal, "initializeEncoder").mockResolvedValue({ hardwareAcceleration: "prefer-software" });

		const result = await exporter.export();

		expect(result.success).toBe(true);
		expect(result.metrics).toMatchObject({
			exportRoute: "webcodecs",
			exportRoutePlan: { primary: "breeze-stream", fallbacks: ["webcodecs"] },
		});
		expect(nativeVideoExportStart).not.toHaveBeenCalled();
		expect(result.metrics?.routeChanges).toContainEqual({
			reason: "native-encoder",
			detail: "H.264 Annex B encoding is not supported at 1920x1080.",
			restarted: false,
		});
		expect(onRouteChange).not.toHaveBeenCalledWith(expect.objectContaining({ reason: "native-encoder" }));
	});

	it("tries a failed Breeze startup only once and keeps the configured software encoder", async () => {
		vi.stubGlobal("navigator", { platform: "Linux x86_64" });
		const exporter = new ModernVideoExporter({
			videoUrl: "file:///recording.mp4", width: 1920, height: 1080, frameRate: 30,
			bitrate: 8_000_000, wallpaper: "#000000", backendPreference: "auto",
		} as never);
		const internal = exporter as unknown as {
			initializeEncoder: () => Promise<unknown>;
			tryStartNativeVideoExport: () => Promise<boolean>;
		};
		const initialize = vi.spyOn(internal, "initializeEncoder").mockResolvedValue({ hardwareAcceleration: "prefer-software" });
		const breeze = vi.spyOn(internal, "tryStartNativeVideoExport").mockRejectedValue(new Error("Breeze transport unavailable"));

		const result = await exporter.export();

		expect(initialize).toHaveBeenCalledOnce();
		expect(breeze).toHaveBeenCalledOnce();
		expect(result).toMatchObject({
			success: true,
			metrics: {
				exportRoute: "webcodecs",
				routeChanges: [{ reason: "native-encoder", detail: "Breeze transport unavailable", restarted: false }],
			},
		});
	});

	it.each([false, true])("uses the Linux audio streaming route only when needed (audio: %s)", async (hasAudio) => {
		vi.stubGlobal("navigator", { platform: "Linux x86_64" });
		vi.stubGlobal("window", { electronAPI: {
			nativeVideoExportWriteWav: vi.fn(),
			nativeVideoExportEndVideoInput: vi.fn(),
		} });
		vi.stubGlobal("AudioEncoder", undefined);
		mocks.streamingDecoderLoadMetadata.mockResolvedValueOnce({ ...mocks.videoInfo, hasAudio });
		const exporter = new ModernVideoExporter({
			backendPreference: "auto",
			videoUrl: "file:///recording.mp4",
			width: 1920,
			height: 1080,
			frameRate: 30,
			bitrate: 8_000_000,
			wallpaper: "#000000",
		} as never);
		const internal = exporter as unknown as {
			initializeEncoder: () => Promise<unknown>;
			finishNativeVideoExport: () => Promise<unknown>;
		};
		const start = mockActiveNativeStream(exporter);
		const initialize = vi.spyOn(internal, "initializeEncoder").mockResolvedValue({ hardwareAcceleration: "prefer-software" });
		vi.spyOn(internal, "finishNativeVideoExport").mockResolvedValue({ success: true, tempFilePath: "/tmp/recording.mp4" });

		const result = await exporter.export();

		expect(result.success).toBe(true);
		expect(start).toHaveBeenCalledTimes(hasAudio ? 1 : 0);
		expect(initialize).toHaveBeenCalledTimes(hasAudio ? 0 : 1);
	});

	it.each(["streamed", "unavailable", "pipe-failure", "disk-full", "auto-webcodecs"])("keeps WebCodecs selected when the audio mux is %s", async (mode) => {
		vi.stubGlobal("navigator", { platform: "Linux x86_64" });
		vi.stubGlobal("AudioEncoder", undefined);
		const start = vi.fn(async () => mode === "unavailable"
			? { success: false, error: "Audio stream unavailable" }
			: { success: true, sessionId: "audio-stream" });
		vi.stubGlobal("window", { electronAPI: {
			nativeVideoExportStart: start,
			nativeVideoExportWriteFrames: vi.fn(),
			nativeVideoExportWriteWav: vi.fn(),
			nativeVideoExportEndVideoInput: vi.fn(),
			nativeVideoExportCancel: vi.fn(async () => ({ success: true })),
		} });
		mocks.streamingDecoderLoadMetadata.mockResolvedValue({ ...mocks.videoInfo, hasAudio: true });
		mocks.streamingDecoderGetEffectiveDuration.mockReturnValue(1);
		if (mode === "pipe-failure" || mode === "disk-full") {
			mocks.muxerFinalizePipe.mockRejectedValueOnce(new Error(mode === "disk-full" ? "ENOSPC" : "Pipe failed"));
		}
		const onRouteChange = vi.fn();
		const exporter = new ModernVideoExporter({
			backendPreference: mode === "auto-webcodecs" ? "auto" : "webcodecs", onRouteChange, measureFrameTiming: true,
			videoUrl: "file:///recording.mp4", wallpaper: "#000000",
			width: 1920, height: 1080, frameRate: 30, bitrate: 8_000_000,
		} as never);
		const internal = exporter as unknown as {
			initializeEncoder: () => Promise<unknown>;
			tryStartNativeVideoExport: () => Promise<boolean>;
			finishNativeVideoExport: () => Promise<unknown>;
			finalizeExportWithFfmpegAudio: () => Promise<unknown>;
		};
		const encode = vi.spyOn(internal, "initializeEncoder").mockResolvedValue({ hardwareAcceleration: "prefer-software" });
		const breeze = vi.spyOn(internal, "tryStartNativeVideoExport").mockResolvedValue(false);
		const streamFinish = vi.spyOn(internal, "finishNativeVideoExport").mockResolvedValue({ success: true, tempFilePath: "/tmp/streamed.mp4" });
		const fileFinish = vi.spyOn(internal, "finalizeExportWithFfmpegAudio").mockResolvedValue({ success: true, tempFilePath: "/tmp/file.mp4" });
		try {
			const result = await exporter.export();
			expect(start).toHaveBeenCalledTimes(1);
			expect(start).toHaveBeenCalledWith(expect.objectContaining({ inputMode: "mp4-stream" }));
			expect(breeze).toHaveBeenCalledTimes(mode === "auto-webcodecs" ? 1 : 0);
			if (mode === "unavailable" || mode === "pipe-failure") {
				const routeChange = {
					reason: "audio-mux", restarted: mode === "pipe-failure",
					detail: mode === "pipe-failure" ? expect.stringContaining("Reason: Pipe failed") : "Audio stream unavailable",
				};
				expect(onRouteChange).toHaveBeenCalledExactlyOnceWith(routeChange);
				expect(result.metrics?.routeChanges).toEqual([onRouteChange.mock.calls[0][0]]);
			} else {
				expect(onRouteChange).not.toHaveBeenCalled();
				expect(result.metrics?.routeChanges).toEqual([]);
			}
			expect(encode).toHaveBeenCalledTimes(mode === "pipe-failure" ? 2 : 1);
			expect(streamFinish).toHaveBeenCalledTimes(mode === "streamed" || mode === "auto-webcodecs" ? 1 : 0);
			expect(fileFinish).toHaveBeenCalledTimes(mode === "pipe-failure" || mode === "unavailable" ? 1 : 0);
			expect(result.success).toBe(mode !== "disk-full");
			if (mode === "disk-full") expect(result.error).toMatch(/ran out of disk space/i);
		} finally {
			mocks.streamingDecoderLoadMetadata.mockResolvedValue(mocks.videoInfo);
			mocks.streamingDecoderGetEffectiveDuration.mockReturnValue(0);
		}
	});

	it.each([
		"returned",
		"thrown",
		"write",
		"disk-full-result",
		"disk-full-write",
		"cancelled",
		"both-fail",
		"decode",
	])("handles a native runtime failure: %s", async (failure) => {
		vi.stubGlobal("navigator", { platform: "Win32" });
		const exporter = new ModernVideoExporter({
			videoUrl: "file:///recording.mp4",
			width: 1920,
			height: 1080,
			frameRate: 30,
			bitrate: 8_000_000,
			wallpaper: "#000000",
			backendPreference: "auto",
		} as never) as unknown as {
			export: () => Promise<{ success: boolean; error?: string }>;
			cancel: () => void;
			initializeEncoder: () => Promise<unknown>;
			finishNativeVideoExport: () => Promise<unknown>;
			nativeEncoderError: Error | null;
		};
		const log = vi.spyOn(console, "error").mockImplementation(() => {});
		const start = mockActiveNativeStream(exporter);
		const initialize = vi.spyOn(exporter, "initializeEncoder").mockImplementation(async () => {
			if (failure === "both-fail") throw new Error("WebCodecs unavailable");
			return { hardwareAcceleration: "prefer-hardware" };
		});
		vi.spyOn(exporter, "finishNativeVideoExport").mockImplementation(async () => {
			if (failure === "disk-full-result") return { success: false, error: "No space left on device" };
			if (failure === "cancelled") exporter.cancel();
			if (failure === "thrown" || failure === "cancelled")
				throw new Error("Native finish failed");
			return { success: false, error: "Native finish failed" };
		});
		if (failure === "write" || failure === "decode" || failure === "disk-full-write") {
			mocks.streamingDecoderDecodeAll.mockImplementationOnce(async () => {
				const error = new Error(
					failure === "disk-full-write" ? "ENOSPC: output write failed"
						: failure === "write" ? "Native write failed" : "Source decode failed",
				);
				if (failure !== "decode") exporter.nativeEncoderError = error;
				throw error;
			});
		}
		const result = await exporter.export();
		expect(start).toHaveBeenCalledTimes(1);
		const diskFull = failure.startsWith("disk-full");
		const shouldRetry = failure !== "cancelled" && failure !== "decode" && !diskFull;
		expect(initialize).toHaveBeenCalledTimes(shouldRetry ? 1 : 0);
		expect(result.success).toBe(shouldRetry && failure !== "both-fail");
		if (shouldRetry)
			expect(log).toHaveBeenCalledWith(
				expect.stringContaining("restarting once with WebCodecs"),
			);
		if (failure === "both-fail") {
			expect(result.error).toContain("Native finish failed");
			expect(result.error).toContain("WebCodecs unavailable");
		}
		if (failure === "cancelled") expect(result.error).toBe("Export cancelled");
		if (diskFull) expect(result.error).toMatch(/ran out of disk space/i);
	});

	it("falls back to WebCodecs instead of surfacing a native error when Breeze is unavailable", async () => {
		const exporter = new ModernVideoExporter({
			videoUrl: "file:///recording.mp4",
			width: 1920,
			height: 1080,
			frameRate: 30,
			bitrate: 8_000_000,
			wallpaper: "#101010",
			padding: 0,
			borderRadius: 0,
			backgroundBlur: 0,
			shadowIntensity: 0,
			showShadow: false,
			cropRegion: { x: 0, y: 0, width: 1, height: 1 },
			experimentalNativeExport: true,
			backendPreference: "breeze",
		} as never) as unknown as {
			export: () => Promise<{ success: boolean; blob?: Blob; error?: string }>;
			initializeEncoder: () => Promise<unknown>;
			loadNativeStaticLayoutVideoInfo: () => Promise<unknown>;
			tryExportNativeStaticLayout: () => Promise<unknown>;
			tryStartNativeVideoExport: () => Promise<boolean>;
			lastNativeExportError: string | null;
		};

		vi.spyOn(exporter, "loadNativeStaticLayoutVideoInfo").mockResolvedValue(mocks.videoInfo);
		vi.spyOn(exporter, "tryExportNativeStaticLayout").mockResolvedValue(null);
		vi.spyOn(exporter, "tryStartNativeVideoExport").mockImplementation(async () => {
			exporter.lastNativeExportError = "Breeze native encoder unavailable";
			return false;
		});
		const initializeEncoder = vi.spyOn(exporter, "initializeEncoder").mockResolvedValue({
			codec: "avc1.640034",
			hardwareAcceleration: "prefer-hardware",
		});

		const result = await exporter.export();

		expect(result.success).toBe(true);
		expect(result.error).toBeUndefined();
		expect(result.blob).toBeInstanceOf(Blob);
		expect(initializeEncoder).toHaveBeenCalledTimes(1);
		expect(mocks.muxerFinalize).toHaveBeenCalledTimes(1);
	}, 15_000);

	it("keeps Windows auto exports on the streaming native route before static layout", async () => {
		vi.stubGlobal("navigator", {
			platform: "Win32",
			userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
		});

		const nativeResult = {
			success: true,
			blob: new Blob([], { type: "video/mp4" }),
		};
		const exporter = new ModernVideoExporter({
			videoUrl: "file:///recording.mp4",
			width: 1920,
			height: 1080,
			frameRate: 30,
			bitrate: 8_000_000,
			wallpaper: "#101010",
			padding: 0,
			borderRadius: 0,
			backgroundBlur: 0,
			shadowIntensity: 0,
			showShadow: false,
			cropRegion: { x: 0, y: 0, width: 1, height: 1 },
			experimentalNativeExport: true,
			backendPreference: "auto",
		} as never) as unknown as {
			export: () => Promise<{ success: boolean; blob?: Blob; error?: string }>;
			finishNativeVideoExport: () => Promise<unknown>;
			loadNativeStaticLayoutVideoInfo: () => Promise<unknown>;
			tryExportNativeStaticLayout: () => Promise<unknown>;
		};

		const loadNativeStaticLayoutVideoInfo = vi.spyOn(
			exporter,
			"loadNativeStaticLayoutVideoInfo",
		);
		const tryExportNativeStaticLayout = vi.spyOn(exporter, "tryExportNativeStaticLayout");
		const tryStartNativeVideoExport = mockActiveNativeStream(exporter);
		const finishNativeVideoExport = vi
			.spyOn(exporter, "finishNativeVideoExport")
			.mockResolvedValue(nativeResult);

		const result = await exporter.export();

		expect(result.success).toBe(true);
		expect(result.blob).toBe(nativeResult.blob);
		expect(tryStartNativeVideoExport).toHaveBeenCalledTimes(1);
		expect(loadNativeStaticLayoutVideoInfo).not.toHaveBeenCalled();
		expect(tryExportNativeStaticLayout).not.toHaveBeenCalled();
		expect(mocks.streamingDecoderLoadMetadata).toHaveBeenCalledTimes(1);
		expect(finishNativeVideoExport).toHaveBeenCalledTimes(1);
	}, 15_000);

	it("tries Windows auto static-layout first when NVIDIA CUDA is opted in", async () => {
		vi.stubGlobal("navigator", {
			platform: "Win32",
			userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
		});

		const staticLayoutResult = {
			success: true,
			blob: new Blob([], { type: "video/mp4" }),
		};
		const exporter = new ModernVideoExporter({
			videoUrl: "file:///recording.mp4",
			width: 1920,
			height: 1080,
			frameRate: 30,
			bitrate: 8_000_000,
			wallpaper: "#101010",
			padding: 0,
			borderRadius: 0,
			backgroundBlur: 0,
			shadowIntensity: 0,
			showShadow: false,
			cropRegion: { x: 0, y: 0, width: 1, height: 1 },
			experimentalNativeExport: true,
			experimentalNvidiaCudaExport: true,
			backendPreference: "auto",
		} as never) as unknown as {
			export: () => Promise<{ success: boolean; blob?: Blob; error?: string }>;
			initializeEncoder: () => Promise<unknown>;
			loadNativeStaticLayoutVideoInfo: () => Promise<unknown>;
			tryExportNativeStaticLayout: () => Promise<unknown>;
			tryStartNativeVideoExport: () => Promise<boolean>;
		};

		const initializeEncoder = vi.spyOn(exporter, "initializeEncoder").mockResolvedValue({
			codec: "avc1.640034",
			hardwareAcceleration: "prefer-hardware",
		});
		const loadNativeStaticLayoutVideoInfo = vi
			.spyOn(exporter, "loadNativeStaticLayoutVideoInfo")
			.mockResolvedValue(mocks.videoInfo);
		const tryExportNativeStaticLayout = vi
			.spyOn(exporter, "tryExportNativeStaticLayout")
			.mockResolvedValue(staticLayoutResult);
		const tryStartNativeVideoExport = vi
			.spyOn(exporter, "tryStartNativeVideoExport")
			.mockResolvedValue(true);

		const result = await exporter.export();

		expect(result).toBe(staticLayoutResult);
		expect(loadNativeStaticLayoutVideoInfo).toHaveBeenCalledTimes(1);
		expect(tryExportNativeStaticLayout).toHaveBeenCalledTimes(1);
		expect(tryStartNativeVideoExport).not.toHaveBeenCalled();
		expect(initializeEncoder).not.toHaveBeenCalled();
		expect(mocks.streamingDecoderLoadMetadata).not.toHaveBeenCalled();
	}, 15_000);

	it("retries the main decode path once with a fresh media source", async () => {
		mocks.streamingDecoderGetEffectiveDuration.mockReturnValue(1);
		mocks.streamingDecoderDecodeAll
			.mockRejectedValueOnce(
				new Error("readAVPacket pipeline failed: Failed after 3 attempts"),
			)
			.mockResolvedValueOnce(undefined);

		const exporter = new ModernVideoExporter({
			videoUrl: "file:///recording.mp4",
			width: 1920,
			height: 1080,
			frameRate: 30,
			bitrate: 8_000_000,
			wallpaper: "#101010",
			padding: 0,
			borderRadius: 0,
			backgroundBlur: 0,
			shadowIntensity: 0,
			showShadow: false,
			cropRegion: { x: 0, y: 0, width: 1, height: 1 },
			backendPreference: "webcodecs",
		} as never) as unknown as {
			export: () => Promise<{ success: boolean; blob?: Blob; error?: string }>;
			initializeEncoder: () => Promise<unknown>;
		};

		vi.spyOn(exporter, "initializeEncoder").mockResolvedValue({
			codec: "avc1.640034",
			hardwareAcceleration: "prefer-hardware",
		});

		const result = await exporter.export();

		expect(result.success).toBe(true);
		expect(mocks.streamingDecoderLoadMetadata).toHaveBeenCalledTimes(2);
		expect(mocks.streamingDecoderLoadMetadata.mock.calls[0]).toEqual([
			"file:///recording.mp4",
			{
				useFallbackMediaSource: false,
			},
		]);
		expect(mocks.streamingDecoderLoadMetadata.mock.calls[1]).toEqual([
			"file:///recording.mp4",
			{
				useFallbackMediaSource: true,
			},
		]);
		expect(mocks.streamingDecoderDecodeAll).toHaveBeenCalledTimes(2);
		expect(mocks.muxerFinalize).toHaveBeenCalledTimes(1);
	});

	it("builds actionable diagnostics for input decoder failures", () => {
		vi.stubGlobal("navigator", {
			platform: "Win32",
			userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
		});
		const exporter = new ModernVideoExporter({
			videoUrl: "file:///recording.mp4",
			width: 1200,
			height: 570,
			frameRate: 60,
			bitrate: 8_000_000,
			backendPreference: "auto",
		} as never) as unknown as {
			buildLightningExportError: (error: unknown) => string;
			sourceVideoInfo: typeof mocks.videoInfo;
			renderBackend: "webgpu";
			encodeBackend: "ffmpeg";
			encoderName: string;
			processedFrameCount: number;
			totalExportStartTimeMs: number;
			mediaSourceRetryAttempted: boolean;
			effectiveDurationSec: number;
			runtimeDiagnostics: {
				appVersion: string;
				userAgent: string;
				logicalProcessors: number;
				deviceMemoryGb: number;
				hardware: RendererExportHardwareInfo;
			};
			backpressureProfile: {
				name: string;
				maxDecodeQueue: number;
				maxPendingFrames: number;
				maxEncodeQueue: number;
			};
		};
		exporter.sourceVideoInfo = mocks.videoInfo;
		exporter.renderBackend = "webgpu";
		exporter.encodeBackend = "ffmpeg";
		exporter.encoderName = "h264-stream-copy";
		exporter.processedFrameCount = 314;
		exporter.totalExportStartTimeMs = 1;
		exporter.mediaSourceRetryAttempted = true;
		exporter.effectiveDurationSec = 10;
		exporter.runtimeDiagnostics = {
			appVersion: "1.4.0",
			userAgent: "LeadCutTest/1.0 Electron/43.1.0",
			logicalProcessors: 12,
			deviceMemoryGb: 8,
			hardware: {
				platform: "win32",
				release: "10.0.26100",
				arch: "x64",
				cpuModel: "AMD Ryzen 9 7900X",
				logicalProcessors: 24,
				totalMemoryGb: 31.8,
				machineModel: "Custom PC",
				gpus: [
					{
						name: "NVIDIA GeForce RTX 4070",
						vendor: "NVIDIA",
						active: true,
					},
				],
				gpuFeatures: {
					videoDecode: "enabled",
					videoEncode: "enabled",
					webgl: "enabled",
					webgpu: "enabled",
				},
			},
		};
		exporter.backpressureProfile = {
			name: "webcodecs-balanced-plus",
			maxDecodeQueue: 12,
			maxPendingFrames: 32,
			maxEncodeQueue: 72,
		};

		const report = exporter.buildLightningExportError(
			new Error(
				"[VIDEO_DECODE_ENCODING_ERROR] VideoDecoder failure: EncodingError: bad frame",
			),
		);

		expect(report).toContain("Failure code: VIDEO_DECODE_ENCODING_ERROR");
		expect(report).toContain("Failure stage: Input video decoding");
		expect(report).toContain("Output: 1200x570 @ 60 FPS; 8.00 Mbps; mode=default");
		expect(report).toContain("LeadCut version: 1.4.0");
		expect(report).toContain("Runtime: LeadCutTest/1.0 Electron/43.1.0");
		expect(report).toContain("System: win32 10.0.26100 (x64); model=Custom PC");
		expect(report).toContain("CPU: AMD Ryzen 9 7900X; 24 logical processors");
		expect(report).toContain("Memory: 31.8 GB");
		expect(report).toContain("GPU 1: NVIDIA GeForce RTX 4070; active");
		expect(report).toContain(
			"GPU acceleration: video decode=enabled; video encode=enabled; WebGL=enabled; WebGPU=enabled",
		);
		expect(report).toContain("Source: h264 1920x1080 @ 30.000 FPS; 1.000s");
		expect(report).toContain("Source audio: none");
		expect(report).toContain("Progress at failure: 314/600 (52.3%) rendered frames after");
		expect(report).toContain("Media source retry: attempted with a fresh source");
		expect(report).toContain(
			"Pipeline tuning: webcodecs-balanced-plus; decode queue=12; pending frames=32; encode queue=72",
		);
		expect(report).toContain("If only this recording fails");
		expect(report).not.toContain("Windows Lightning exports can use WebCodecs or FFmpeg");
	});

	it("forwards cursor click-effect settings into the modern frame renderer", async () => {
		const { ModernVideoExporter } = await import("./modernVideoExporter");
		const { FrameRenderer } = await import("./modernFrameRenderer");
		mocks.streamingDecoderGetEffectiveDuration.mockReturnValue(1);

		const exporter = new ModernVideoExporter({
			videoUrl: "file:///recording.mp4",
			width: 1920,
			height: 1080,
			frameRate: 30,
			bitrate: 8_000_000,
			wallpaper: "#101010",
			padding: 0,
			borderRadius: 24,
			backgroundBlur: 0,
			shadowIntensity: 0,
			showShadow: false,
			cropRegion: { x: 0, y: 0, width: 1, height: 1 },
			backendPreference: "webcodecs",
			cursorClickEffect: "echo",
			cursorClickEffectColor: "#22C55E",
			cursorClickEffectScale: 1.4,
			cursorClickEffectOpacity: 0.65,
			cursorClickEffectDurationMs: 720,
		} as never) as unknown as {
			export: () => Promise<{ success: boolean; blob?: Blob; error?: string }>;
			initializeEncoder: () => Promise<unknown>;
		};

		vi.spyOn(exporter, "initializeEncoder").mockResolvedValue({
			codec: "avc1.640034",
			hardwareAcceleration: "prefer-hardware",
		});

		const result = await exporter.export();

		expect(result.success).toBe(true);
		expect(FrameRenderer).toHaveBeenCalledWith(
			expect.objectContaining({
				cursorClickEffect: "echo",
				cursorClickEffectColor: "#22C55E",
				cursorClickEffectScale: 1.4,
				cursorClickEffectOpacity: 0.65,
				cursorClickEffectDurationMs: 720,
			}),
		);
	});
});
