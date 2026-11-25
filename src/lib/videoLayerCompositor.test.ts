import { afterEach, expect, it, vi } from "vitest";
import type { WebGPURenderer } from "pixi.js";
import { VideoLayerCompositor, type VideoLayerOptions } from "./videoLayerCompositor";
import { DEFAULT_WEBCAM_OVERLAY } from "@/components/video-editor/types";

const harness = vi.hoisted(() => ({
	videos: [] as ReturnType<typeof createMockVideo>[], play: Promise.resolve(), delayMetadata: false, frameReady: true,
	decoders: [] as ReturnType<typeof createMockDecoder>[], surfaces: [] as ReturnType<typeof createMockSurface>[],
	surfaceSize: [320, 180], generateMipmap: vi.fn(),
}));
vi.mock("./assetPath", () => ({ getRenderableVideoUrl: async (path: string) => path }));
vi.mock("./exporter/forwardFrameSource", () => ({ ForwardFrameSource: class {
	constructor() { return createMockDecoder(); }
} }));
vi.mock("./webcamLayerSurface", () => ({ WebcamLayerSurface: class {
	constructor() { return createMockSurface(); }
} }));
vi.mock("pixi-filters/drop-shadow", () => ({ DropShadowFilter: class {} }));
vi.mock("pixi.js", () => {
	class Container {
		children: Container[] = []; parent: Container | null = null; destroyed = false; visible = true;
		addChild<T extends Container>(child: T) { child.parent = this; this.children = this.children.filter((item) => item !== child); this.children.push(child); return child; }
		addChildAt<T extends Container>(child: T) { return this.addChild(child); }
		destroy() {
			this.destroyed = true;
			for (const child of this.children) child.destroy?.();
			if (this.parent) this.parent.children = this.parent.children.filter(child => child !== this);
			this.parent = null;
		}
	}
	class Graphics extends Container { clear() { return this; } roundRect() { return this; } fill() { return this; } }
	type Point = { set: (...values: number[]) => void };
	class Sprite extends Container {
		anchor: Point | null = { set() {} }; scale: Point | null = { set() {} }; position: Point | null = { set() {} };
		constructor(public texture: unknown) { super(); }
		destroy() { super.destroy(); this.anchor = this.scale = this.position = null; }
	}
	return {
		Container, Graphics, Sprite, GpuMipmapGenerator: class { generateMipmap = harness.generateMipmap; }, Texture: class {
			source: unknown;
			constructor(options: { source?: unknown }) { this.source = options.source; }
			destroy() {}
		}, VideoSource: class { resize() {} update() {} }, CanvasSource: class {
			resource: unknown; autoGenerateMipmaps: boolean; mipLevelCount: number; pixelWidth: number; pixelHeight: number;
			constructor(options: { resource: { width: number; height: number }; autoGenerateMipmaps: boolean; mipLevelCount: number }) {
				this.resource = options.resource;
				this.pixelWidth = options.resource.width;
				this.pixelHeight = options.resource.height;
				this.autoGenerateMipmaps = options.autoGenerateMipmaps;
				this.mipLevelCount = options.mipLevelCount;
			}
			resize(width: number, height: number) { this.pixelWidth = width; this.pixelHeight = height; }
			update() {}
		},
	};
});

function createMockDecoder() {
	const frame = { close: vi.fn() };
	const decoder = {
		frame, initialize: vi.fn(async () => ({ width: 1920, height: 1080 })),
		getFrameAtTime: vi.fn(async () => frame), cancel: vi.fn(), destroy: vi.fn(async () => {}),
	};
	harness.decoders.push(decoder);
	return decoder;
}

function createMockSurface() {
	const surface = {
		canvas: { width: harness.surfaceSize[0], height: harness.surfaceSize[1] }, configure: vi.fn(), paint: vi.fn((_source: unknown) => true), invalidate: vi.fn(),
		layout: vi.fn(() => ({ x: 0, y: 0, width: 320, height: 180 })),
	};
	harness.surfaces.push(surface);
	return surface;
}

function createMockVideo() {
	const listeners = new Map<string, Set<() => void>>();
	const video = {
		duration: 10, readyState: harness.frameReady ? 2 : 1, videoWidth: 320, videoHeight: 180,
		currentTime: 0, paused: true, seeking: false, playbackRate: 1, style: {},
		crossOrigin: "", onloadedmetadata: undefined as (() => void) | null | undefined,
		setAttribute() {}, remove() {}, removeAttribute() {}, load() {},
		addEventListener(type: string, listener: () => void) {
			if (!listeners.has(type)) listeners.set(type, new Set());
			listeners.get(type)!.add(listener);
		},
		removeEventListener(type: string, listener: () => void) { listeners.get(type)?.delete(listener); },
		emit(type: string) { for (const listener of [...(listeners.get(type) ?? [])]) listener(); },
		pause() { this.paused = true; },
		play: vi.fn((): Promise<void> => { video.paused = false; return harness.play; }),
	};
	Object.defineProperty(video, "src", { set() { if (!harness.delayMetadata) queueMicrotask(() => video.onloadedmetadata?.()); } });
	return video;
}

function setup() {
	harness.videos = [];
	vi.stubGlobal("document", { createElement: () => {
		const video = createMockVideo();
		harness.videos.push(video); return video;
	} });
	return { regions: [{ id: "clip", trackId: "track", sourcePath: "/video.mp4", sourceDurationMs: 10000, sourceStartMs: 0, startMs: 0, endMs: 10000, speed: 1, volume: 1 }], tracks: [{ id: "track", kind: "video" as const, name: "Video" }], width: 320, height: 180 };
}
afterEach(() => {
	harness.delayMetadata = false; harness.frameReady = true; harness.decoders = []; harness.surfaces = [];
	harness.surfaceSize = [320, 180]; harness.generateMipmap.mockClear(); vi.unstubAllGlobals();
});

it("waits for a decoded first frame before exposing a paused video layer", async () => {
	harness.frameReady = false;
	const options = setup();
	const compositor = new VideoLayerCompositor();
	let ready = false;
	const pending = compositor.syncPreview(0, false, 1, options).then(() => { ready = true; });
	await vi.waitFor(() => expect(harness.videos[0]?.onloadedmetadata).toBeNull());
	expect(ready).toBe(false);
	expect(harness.videos[0].crossOrigin).toBe("anonymous");
	harness.videos[0].readyState = 2; harness.videos[0].emit("loadeddata");
	await pending;
	expect(ready).toBe(true);
	compositor.destroy();
});

it("cancels the loading timer and settles old seeks when a pending layer becomes inactive", async () => {
	const options = setup(); harness.delayMetadata = true;
	const compositor = new VideoLayerCompositor();
	const pending = compositor.syncPreview(0, false, 1, options);
	await Promise.resolve();
	await compositor.syncPreview(1000, false, 1, { ...options, regions: [] });
	await expect(pending).resolves.toBeUndefined();
	compositor.destroy();
});

it("seeks to the authored in-point before requesting playback", async () => {
	const options = setup(); harness.play = Promise.resolve();
	options.regions[0].sourceStartMs = 4000;
	const compositor = new VideoLayerCompositor();
	await compositor.syncPreview(1000, true, 1, options);
	expect(harness.videos[0].currentTime).toBe(5);
	expect(harness.videos[0].play).toHaveBeenCalledOnce();
	compositor.destroy();
});

it("does not touch a destroyed Pixi sprite when play resolves after teardown", async () => {
	const options = setup();
	let finish!: () => void;
	harness.play = new Promise((resolve) => { finish = resolve; });
	const compositor = new VideoLayerCompositor();
	const pending = compositor.syncPreview(0, true, 1, options);
	await vi.waitFor(() => expect(harness.videos[0]?.play).toHaveBeenCalled());
	compositor.destroy(); finish();
	await expect(pending).resolves.toBeUndefined();
});

it("does not let a previous play request resurrect a hidden or replaced layer", async () => {
	const options = setup();
	let finish!: () => void;
	harness.play = new Promise((resolve) => { finish = resolve; });
	const compositor = new VideoLayerCompositor();
	const pending = compositor.syncPreview(0, true, 1, options);
	await vi.waitFor(() => expect(harness.videos[0]?.play).toHaveBeenCalled());
	await compositor.syncPreview(1000, false, 1, { ...options, regions: [] });
	finish();
	await expect(pending).resolves.toBeUndefined();
	expect(harness.videos[0].paused).toBe(true);
	compositor.destroy();
});

it("keeps the camera surface version when export holds the same decoded frame", async () => {
	const options = { ...setup(), tracks: [{ id: "track", kind: "webcam" as const, name: "Camera" }] };
	const compositor = new VideoLayerCompositor();
	const first = { close: vi.fn() };
	const next = { close: vi.fn() };
	const getFrameAtTime = vi.fn().mockResolvedValueOnce(first).mockResolvedValueOnce(next);
	const layer = {
		kind: "webcam", ready: Promise.resolve(), decoder: { getFrameAtTime },
		frame: first, frameVersion: 1, sprite: {}, webcamSurface: {},
	};
	const internal = compositor as unknown as { getLayer(): typeof layer; layout(): void };
	vi.spyOn(internal, "getLayer").mockReturnValue(layer);
	const layout = vi.spyOn(internal, "layout").mockImplementation(() => undefined);
	try {
		await compositor.syncExport(16, options);
		expect(getFrameAtTime).toHaveBeenNthCalledWith(1, 0.016, first);
		expect(layer.frameVersion).toBe(1);
		expect(first.close).not.toHaveBeenCalled();
		await compositor.syncExport(33, options);
		expect(layer.frame).toBe(next);
		expect(layer.frameVersion).toBe(2);
		expect(first.close).toHaveBeenCalledOnce();
		expect(layout).toHaveBeenCalledTimes(2);
	} finally {
		compositor.destroy();
	}
});

function webcamSequence(secondStartMs: number): VideoLayerOptions {
	const { regions, width, height } = setup();
	const first = { ...regions[0], endMs: 2000 };
	return {
		width, height, tracks: [{ id: "track", kind: "webcam", name: "Camera" }],
		webcam: { ...DEFAULT_WEBCAM_OVERLAY, enabled: true },
		regions: [first, { ...first, id: "second", startMs: secondStartMs, endMs: secondStartMs + 2000, sourceStartMs: 5500 }],
	};
}

it("allocates only the required mip levels when a static WebGPU webcam surface is minified", async () => {
	harness.surfaceSize = [640, 360];
	const gpuTexture = {};
	const getGpuSource = vi.fn(() => gpuTexture);
	const renderer = { gpu: { device: {} }, texture: { getGpuSource } } as unknown as WebGPURenderer;
	const compositor = new VideoLayerCompositor({ webcamMipRenderer: () => renderer });
	try {
		await compositor.syncExport(1000, webcamSequence(2800));
		expect(getGpuSource).toHaveBeenCalledWith(expect.objectContaining({ autoGenerateMipmaps: false, mipLevelCount: 2 }));
		expect(harness.generateMipmap).toHaveBeenCalledExactlyOnceWith(gpuTexture);
	} finally {
		compositor.destroy();
	}
});

it("adds mip levels for a shrinking webcam and reuses the texture when it grows again", async () => {
	harness.surfaceSize = [640, 360];
	const getGpuSource = vi.fn((source: unknown) => source);
	const renderer = { gpu: { device: {} }, texture: { getGpuSource } } as unknown as WebGPURenderer;
	const compositor = new VideoLayerCompositor({ webcamMipRenderer: () => renderer });
	const options = webcamSequence(2800);
	if (options.webcam) options.webcam.reactToZoom = true;
	try {
		await compositor.syncExport(1000, options);
		const initial = getGpuSource.mock.calls[0][0];
		expect(initial).toMatchObject({ mipLevelCount: 2 });
		harness.surfaces[0].layout.mockReturnValueOnce({ x: 0, y: 0, width: 160, height: 90 });
		compositor.updateViewport({ width: options.width, height: options.height, zoomScale: 2 });
		const enlargedTexture = getGpuSource.mock.calls[1][0];
		expect(enlargedTexture).toMatchObject({ mipLevelCount: 3 });
		expect(enlargedTexture).not.toBe(initial);
		compositor.updateViewport({ width: options.width, height: options.height, zoomScale: 1 });
		expect(getGpuSource.mock.calls[2][0]).toBe(enlargedTexture);
	} finally {
		compositor.destroy();
	}
});

it("hides the cached camera in a short gap and reuses it with the next clip's decoded frame", async () => {
	const compositor = new VideoLayerCompositor();
	const options = webcamSequence(2800);
	try {
		await compositor.syncExport(1000, options);
		const root = compositor.container.children[0];
		const first = harness.decoders[0];
		await compositor.syncExport(2200, options);
		expect(root.visible).toBe(false);
		expect(first.cancel).toHaveBeenCalledOnce();
		expect(first.destroy).toHaveBeenCalledOnce();
		expect(first.frame.close).toHaveBeenCalledOnce();
		expect(harness.surfaces[0].paint).toHaveBeenCalledTimes(1);
		await compositor.syncExport(2900, options);
		expect(compositor.container.children).toEqual([root]);
		expect(root.visible).toBe(true);
		expect(harness.decoders).toHaveLength(2);
		expect(harness.decoders[1].initialize).toHaveBeenCalledWith("/video.mp4", { startTimeSec: 5.5 });
		expect(harness.decoders[1].getFrameAtTime).toHaveBeenCalledWith(5.6, null);
		expect(harness.surfaces).toHaveLength(1);
		expect(harness.surfaces[0].paint.mock.calls[1]?.[0]).toBe(harness.decoders[1].frame);
	} finally {
		compositor.destroy();
	}
});

it("keeps overlapping camera clips on independent canvases", async () => {
	const compositor = new VideoLayerCompositor();
	const options = webcamSequence(1500);
	try {
		await compositor.syncExport(1750, options);
		const [first, second] = compositor.container.children;
		expect(first.visible && second.visible).toBe(true);
		expect(harness.surfaces).toHaveLength(2);
		await compositor.syncExport(2000, options);
		expect(first.destroyed).toBe(true);
		expect(compositor.container.children).toEqual([second]);
		expect(harness.decoders[1].cancel).not.toHaveBeenCalled();
	} finally {
		compositor.destroy();
	}
});

it("releases the camera immediately when the next clip is beyond the reuse window", async () => {
	const compositor = new VideoLayerCompositor();
	const options = webcamSequence(3001);
	try {
		await compositor.syncExport(1500, options);
		const root = compositor.container.children[0];
		await compositor.syncExport(2016, options);
		expect(root.destroyed).toBe(true);
		expect(compositor.container.children).toHaveLength(0);
		await compositor.syncExport(3001, options);
		expect(harness.surfaces).toHaveLength(2);
	} finally {
		compositor.destroy();
	}
});

it("cleans a parked camera when export is cancelled during the gap", async () => {
	const compositor = new VideoLayerCompositor();
	const options = webcamSequence(2800);
	const controller = new AbortController();
	await compositor.syncExport(1000, options, controller.signal);
	const root = compositor.container.children[0];
	await compositor.syncExport(2300, options, controller.signal);
	expect(root.destroyed).toBe(false);
	controller.abort();
	compositor.destroy();
	compositor.destroy();
	expect(root.destroyed).toBe(true);
	expect(harness.decoders).toHaveLength(1);
	expect(harness.decoders[0].destroy).toHaveBeenCalledOnce();
	expect(harness.decoders[0].frame.close).toHaveBeenCalledOnce();
	await expect(compositor.syncExport(2900, options, controller.signal)).rejects.toThrow("aborted");
});
