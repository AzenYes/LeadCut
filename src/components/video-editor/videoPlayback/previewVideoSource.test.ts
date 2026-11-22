import { DOMAdapter, Texture } from "pixi.js";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PreviewVideoSource } from "./previewVideoSource";

class TestVideo extends EventTarget {
	videoWidth = 5120;
	videoHeight = 2880;
	width = 5120;
	height = 2880;
	readyState = 4;
	seeking = false;
	HAVE_ENOUGH_DATA = 4;
	HAVE_FUTURE_DATA = 3;
	paused = true;
	ended = false;
	src = "recording.mp4";
	currentTime = 5;
	playbackRate = 1;
	play = vi.fn();
	pause = vi.fn();
	load = vi.fn();
	requestVideoFrameCallback = vi.fn(() => 1);
	cancelVideoFrameCallback = vi.fn();
	listeners = new Map<string, Set<EventListenerOrEventListenerObject>>();

	override addEventListener(type: string, listener: EventListenerOrEventListenerObject) {
		const listeners = this.listeners.get(type) ?? new Set();
		listeners.add(listener);
		this.listeners.set(type, listeners);
		super.addEventListener(type, listener);
	}

	override removeEventListener(type: string, listener: EventListenerOrEventListenerObject) {
		this.listeners.get(type)?.delete(listener);
		super.removeEventListener(type, listener);
	}

	asElement() {
		return this as unknown as HTMLVideoElement;
	}
}

const originalAdapter = DOMAdapter.get();
beforeAll(() => {
	DOMAdapter.set({
		...originalAdapter,
		createCanvas: (width = 1, height = 1) => {
			const context = { drawImage: vi.fn() };
			return { width, height, getContext: () => context } as unknown as HTMLCanvasElement;
		},
	});
});
afterAll(() => DOMAdapter.set(originalAdapter));

describe("PreviewVideoSource", () => {
	it("reuses a single source and listener set across repeated texture lifecycles", async () => {
		const video = new TestVideo();
		const owner = new PreviewVideoSource();
		owner.setVideo(video.asElement());
		const source = owner.getSource();
		const unload = vi.fn();
		source.on("unload", unload);

		for (let i = 0; i < 100; i++) {
			expect(owner.getSource()).toBe(source);
			const texture = new Texture({ source });
			texture.destroy(false);
			owner.suspend();
		}

		expect(source.destroyed).toBe(false);
		expect(unload).toHaveBeenCalledTimes(100);
		for (const type of ["loadeddata", "resize", "seeked"]) {
			expect(video.listeners.get(type)?.size).toBe(1);
		}
		expect(video.src).toBe("recording.mp4");
		expect(video.currentTime).toBe(5);
		expect(video.play).not.toHaveBeenCalled();
		expect(video.load).not.toHaveBeenCalled();

		owner.setVideo(null);
		expect(source.destroyed).toBe(true);
		for (const listeners of video.listeners.values()) expect(listeners.size).toBe(0);
	});

	it("updates paused seeks and new media dimensions after resuming", async () => {
		const video = new TestVideo();
		const owner = new PreviewVideoSource();
		owner.setVideo(video.asElement());
		const source = owner.getSource();
		const update = vi.fn();
		source.on("update", update);
		video.dispatchEvent(new Event("seeked"));
		expect(update).toHaveBeenCalledTimes(1);
		owner.suspend();
		video.dispatchEvent(new Event("seeked"));
		expect(update).toHaveBeenCalledTimes(1);
		video.videoWidth = 1920;
		video.videoHeight = 1080;
		owner.getSource();
		expect(source.pixelWidth).toBe(1920);
		expect(source.pixelHeight).toBe(1080);
		owner.setVideo(null);
	});

	it("cancels frame callbacks and releases the source when the element detaches", async () => {
		const video = new TestVideo();
		const owner = new PreviewVideoSource();
		owner.setVideo(video.asElement());
		const source = owner.getSource();
		video.paused = false;
		video.dispatchEvent(new Event("play"));
		expect(video.requestVideoFrameCallback).toHaveBeenCalledTimes(1);
		owner.setVideo(null);
		expect(video.cancelVideoFrameCallback).toHaveBeenCalledWith(1);
		expect(source.destroyed).toBe(true);
		owner.setVideo(null);
		expect(video.load).not.toHaveBeenCalled();
		expect(() => owner.getSource()).toThrow("not attached");
		const nextVideo = new TestVideo();
		owner.setVideo(nextVideo.asElement());
		expect(owner.getSource()).not.toBe(source);
		owner.setVideo(null);
	});

	it("retains decoded pixels while seeking or stalled, including after a GPU unload", () => {
		const video = new TestVideo();
		const owner = new PreviewVideoSource(); owner.setVideo(video.asElement());
		const source = owner.getSource();
		const canvas = source.resource;
		const draw = source.context2D.drawImage as ReturnType<typeof vi.fn>;
		const before = draw.mock.calls.length;
		video.seeking = true; video.readyState = 1;
		source.unload(); owner.getSource(); video.dispatchEvent(new Event("resize"));
		expect(source.resource).toBe(canvas);
		expect(source.pixelWidth).toBe(5120); expect(source.pixelHeight).toBe(2880);
		expect(draw).toHaveBeenCalledTimes(before);
		video.seeking = false; video.readyState = 4;
		video.dispatchEvent(new Event("seeked"));
		expect(draw).toHaveBeenCalledTimes(before + 1);
		owner.setVideo(null);
	});

	it("ignores already queued callbacks belonging to a replaced video", () => {
		const first = new TestVideo(); const next = new TestVideo();
		const owner = new PreviewVideoSource(); owner.setVideo(first.asElement()); owner.getSource();
		const stale = first.requestVideoFrameCallback.mock.calls[0] as unknown as [() => void];
		owner.setVideo(next.asElement()); const source = owner.getSource();
		const update = vi.fn(); source.on("update", update);
		stale[0]();
		expect(update).not.toHaveBeenCalled();
		expect(next.requestVideoFrameCallback).toHaveBeenCalledOnce();
		owner.setVideo(null);
	});
});
