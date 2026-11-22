import { afterEach, expect, it, vi } from "vitest";
import { VideoLayerCompositor } from "./videoLayerCompositor";

const harness = vi.hoisted(() => ({ videos: [] as ReturnType<typeof createMockVideo>[], play: Promise.resolve(), delayMetadata: false, frameReady: true }));
vi.mock("./assetPath", () => ({ getRenderableVideoUrl: async (path: string) => path }));
vi.mock("./exporter/forwardFrameSource", () => ({ ForwardFrameSource: class {} }));
vi.mock("pixi-filters/drop-shadow", () => ({ DropShadowFilter: class {} }));
vi.mock("pixi.js", () => {
	class Container {
		children: Container[] = []; parent: Container | null = null; destroyed = false;
		addChild<T extends Container>(child: T) { child.parent = this; this.children = this.children.filter((item) => item !== child); this.children.push(child); return child; }
		addChildAt<T extends Container>(child: T) { return this.addChild(child); }
		destroy() { this.destroyed = true; for (const child of this.children) child.destroy?.(); this.parent = null; }
	}
	class Graphics extends Container { clear() { return this; } roundRect() { return this; } fill() { return this; } }
	type Point = { set: (...values: number[]) => void };
	class Sprite extends Container {
		anchor: Point | null = { set() {} }; scale: Point | null = { set() {} }; position: Point | null = { set() {} };
		constructor(public texture: unknown) { super(); }
		destroy() { super.destroy(); this.anchor = this.scale = this.position = null; }
	}
	return { Container, Graphics, Sprite, Texture: class { constructor(public source: unknown) {} }, VideoSource: class { resize() {} update() {} } };
});

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
afterEach(() => { harness.delayMetadata = false; harness.frameReady = true; vi.unstubAllGlobals(); });

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
