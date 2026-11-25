import { expect, it, vi } from "vitest";
import { ForwardFrameSource, type ForwardFrameSourceMetadata } from "./forwardFrameSource";

const media = vi.hoisted(() => ({
	resolve: vi.fn(),
	fallback: vi.fn(),
	construct: vi.fn(),
	load: vi.fn(),
	info: vi.fn(),
	config: vi.fn(),
	destroy: vi.fn(),
}));

vi.mock("./localMediaSource", () => ({
	resolveMediaResourceUrl: media.resolve,
	createFallbackDemuxerSource: media.fallback,
}));

vi.mock("web-demuxer", () => ({
	AVSeekFlag: { AVSEEK_FLAG_BACKWARD: 1 },
	WebDemuxer: class {
		constructor() { media.construct(); }
		load = media.load;
		getMediaInfo = media.info;
		getDecoderConfig = media.config;
		destroy = media.destroy;
	},
}));

it.each(["resolve", "load", "info", "config"] as const)(
	"settles initialization cancelled during %s and releases its worker once",
	async phase => {
		for (const stub of Object.values(media)) stub.mockReset();
		media.resolve.mockResolvedValue("file:///clip.mp4");
		media.load.mockResolvedValue(undefined);
		media.info.mockResolvedValue({ duration: 1, streams: [] });
		const pending = Promise.withResolvers<unknown>();
		media[phase].mockReturnValueOnce(pending.promise);
		const fallback = vi.fn();
		media.fallback.mockImplementation(fallback);
		vi.stubGlobal("window", { location: { href: "file:///editor.html" } });
		const parent = new AbortController();
		const source = new ForwardFrameSource(parent.signal);
		const initializing = source.initialize("/clip.mp4");
		const outcome = initializing.then(() => "resolved", error => error?.name);
		try {
			await vi.waitFor(() => expect(media[phase]).toHaveBeenCalledOnce());
			parent.abort();
			const result = await Promise.race([outcome, new Promise(resolve => setTimeout(() => resolve("pending"), 150))]);
			expect(result).toBe("AbortError");
			expect(media.destroy).toHaveBeenCalledTimes(phase === "resolve" ? 0 : 1);
		} finally {
			// A terminated worker can stay pending. Resolve this test double after
			// shutdown to verify that a late continuation cannot resume loading.
			await source.destroy();
			pending.resolve(phase === "resolve" ? "file:///clip.mp4" : undefined);
			await new Promise(resolve => setTimeout(resolve, 0));
			vi.unstubAllGlobals();
		}
		expect(media.fallback).not.toHaveBeenCalled();
		expect(media.construct).toHaveBeenCalledTimes(phase === "resolve" ? 0 : 1);
	},
);

it("reuses an open caller-owned clone only while the same decoded frame is selected", async () => {
	class MockVideoFrame {
		displayWidth = 1920;

		constructor(readonly timestamp: number) {}

		close() {
			this.displayWidth = 0;
		}
	}
	class Clone extends MockVideoFrame {
		constructor(source: MockVideoFrame) {
			super(source.timestamp);
		}
	}
	vi.stubGlobal("VideoFrame", Clone);
	const source = new ForwardFrameSource();
	const metadata = {
		width: 1920,
		height: 1080,
		duration: 1,
		codec: "avc1",
	} satisfies ForwardFrameSourceMetadata;
	const first = new MockVideoFrame(0);
	const second = new MockVideoFrame(0);
	Object.assign(source, { metadata, pendingFrames: [first, second], decodeDone: true });

	try {
		const initial = await source.getFrameAtTime(0, null);
		expect(initial).toBeInstanceOf(Clone);
		expect(await source.getFrameAtTime(0, initial)).toBe(initial);
		const updated = await source.getFrameAtTime(0.01, initial);
		expect(updated).not.toBe(initial);
		expect(initial?.displayWidth).toBe(1920);
		expect(first.displayWidth).toBe(0);
		expect(await source.getFrameAtTime(0.02, updated)).toBe(updated);
		expect(await source.getFrameAtTime(0.03)).not.toBe(updated);
		updated?.close();
		expect(await source.getFrameAtTime(0.04, updated)).not.toBe(updated);
	} finally {
		await source.destroy();
		vi.unstubAllGlobals();
	}
});

async function startFrameSource(chunkCount: number) {
	const source = new ForwardFrameSource();
	Object.assign(source, {
		metadata: { width: 3840, height: 2160, duration: 1, codec: "avc1" },
		demuxer: {
			getDecoderConfig: async () => ({ codec: "avc1", codedWidth: 3840, codedHeight: 2160 }),
			read: () => new ReadableStream({
				start(controller) {
					for (let index = 0; index < chunkCount; index++) controller.enqueue({ timestamp: index });
					controller.close();
				},
			}),
			destroy: vi.fn(),
		},
	});
	await (source as unknown as { startDecoder: () => Promise<void> }).startDecoder();
	return source;
}

class TestFrame {
	readonly displayWidth = 3840;
	readonly close = vi.fn();
	readonly timestamp: number;

	constructor(source: number | TestFrame) {
		this.timestamp = typeof source === "number" ? source : source.timestamp;
	}
}

it("feeds reordered streams when decode queue space opens before any frame is returned", async () => {
	const submitted: number[] = [];
	class ReorderingDecoder {
		state: CodecState = "configured";
		decodeQueueSize = 0;
		ondequeue: (() => void) | null = null;
		constructor(private readonly callbacks: VideoDecoderInit) {}
		configure() {}
		decode(chunk: EncodedVideoChunk) {
			submitted.push(chunk.timestamp);
			this.decodeQueueSize++;
			setTimeout(() => {
				if (this.state !== "configured") return;
				this.decodeQueueSize--;
				this.ondequeue?.();
				if (chunk.timestamp >= 14) {
					this.callbacks.output(new TestFrame((chunk.timestamp - 14) * 33_333) as unknown as VideoFrame);
				}
			}, 0);
		}
		async flush() {
			await new Promise(resolve => setTimeout(resolve, 0));
		}
		close() {
			this.state = "closed";
		}
	}
	vi.stubGlobal("VideoDecoder", ReorderingDecoder);
	vi.stubGlobal("VideoFrame", TestFrame);
	const source = await startFrameSource(16);
	try {
		const frame = await source.getFrameAtTime(0);
		expect(frame?.timestamp).toBe(0);
		expect(submitted).toHaveLength(16);
		frame?.close();
	} finally {
		source.cancel();
		await source.destroy();
		vi.unstubAllGlobals();
	}
}, 1000);

it("destroys every decoded frame when stopped while waiting for capacity", async () => {
	const decoded: TestFrame[] = [];
	class BufferedDecoder {
		state: CodecState = "configured";
		decodeQueueSize = 0;
		constructor(private readonly callbacks: VideoDecoderInit) {}
		configure() {}
		decode(chunk: EncodedVideoChunk) {
			const frame = new TestFrame(chunk.timestamp * 33_333);
			decoded.push(frame);
			this.callbacks.output(frame as unknown as VideoFrame);
		}
		async flush() {}
		close() {
			this.state = "closed";
		}
	}
	vi.stubGlobal("VideoDecoder", BufferedDecoder);
	const source = await startFrameSource(40);
	try {
		await new Promise(resolve => setTimeout(resolve, 0));
		expect(decoded.length).toBeLessThan(40);
		await source.destroy();
		expect(decoded.length).toBeGreaterThan(0);
		for (const frame of decoded) expect(frame.close).toHaveBeenCalledOnce();
	} finally {
		source.cancel();
		await source.destroy();
		vi.unstubAllGlobals();
	}
}, 1000);

it("closes the decoder before waiting for a pending flush during destruction", async () => {
	let notifyFlush: () => void;
	const waitingForFlush = new Promise<void>(resolve => { notifyFlush = resolve; });
	const close = vi.fn();
	class PendingFlushDecoder {
		state: CodecState = "configured";
		decodeQueueSize = 0;
		private rejectFlush?: (error: Error) => void;
		configure() {}
		flush() {
			notifyFlush();
			return new Promise((_, reject) => { this.rejectFlush = reject; });
		}
		close() {
			this.state = "closed";
			this.rejectFlush?.(new Error("Decoder closed"));
			close();
		}
	}
	vi.stubGlobal("VideoDecoder", PendingFlushDecoder);
	const source = await startFrameSource(0);
	try {
		await waitingForFlush;
		await source.destroy();
		expect(close).toHaveBeenCalledOnce();
	} finally {
		vi.unstubAllGlobals();
	}
}, 1000);
