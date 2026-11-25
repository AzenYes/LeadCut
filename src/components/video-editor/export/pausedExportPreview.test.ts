import type { Application } from "pixi.js";
import { afterEach, expect, it, vi } from "vitest";
import { createObservableValue } from "@/lib/observableValue";
import { initializePixiApplication } from "@/lib/pixiApplicationLifecycle";
import type { VideoPlaybackRef } from "../VideoPlayback";
import { capturePausedExportPreview, createExportPreviewRenderer, type ExportPreview } from "./pausedExportPreview";

afterEach(() => {
	vi.useRealTimers();
	vi.unstubAllGlobals();
});

function createPreviewRenderer() {
	const isContextLost = vi.fn(() => false);
	const destroy = vi.fn();
	const remove = vi.fn();
	const resize = vi.fn();
	const destroyChild = vi.fn();
	const stop = vi.fn();
	const app = {
		init: vi.fn(), destroy, stop,
		canvas: { remove },
		renderer: { resize, gl: { isContextLost } },
		stage: { removeChildren: () => [{ destroy: destroyChild }] },
	} as unknown as Application;
	const store = createObservableValue<ExportPreview | null>({ imageUrl: "still", suspended: true });
	return { app, destroy, isContextLost, remove, resize, destroyChild, stop, preview: createExportPreviewRenderer(store) };
}

it("releases the preview scene and framebuffer while keeping the renderer available for reuse", () => {
	const { app, destroy, remove, resize, destroyChild, stop, preview } = createPreviewRenderer();
	const detach = preview.attach();
	expect(preview.park(app)).toBe(true);
	expect(stop).toHaveBeenCalledOnce();
	expect(destroyChild).toHaveBeenCalledOnce();
	expect(resize).toHaveBeenCalledWith(1, 1);
	expect(remove).toHaveBeenCalledOnce();
	expect(preview.take()).toBe(app);
	detach();
	expect(destroy).not.toHaveBeenCalled();
});

it("destroys a renderer that lost its context while parked so recovery can create a fresh one", async () => {
	const { app, destroy, isContextLost, preview } = createPreviewRenderer();
	await initializePixiApplication(app, {});
	const detach = preview.attach();
	expect(preview.park(app)).toBe(true);
	isContextLost.mockReturnValue(true);
	expect(preview.take()).toBeNull();
	detach();
	expect(destroy).toHaveBeenCalledOnce();
});

function createPreviewCapture() {
	const ownerDocument = {};
	const bounds = { x: 10, y: 20, width: 800, height: 450 };
	const frame = { isConnected: true };
	class PreviewOverlay {
		hasAttribute(name: string) { return name === "data-preview-overlay"; }
		getBoundingClientRect() { return bounds; }
	}
	const video = {
		paused: true, seeking: false, readyState: 2, videoWidth: 3840, videoHeight: 2160, currentTime: 1.25,
	};
	const playback = {
		video,
		containerRef: { current: { nextElementSibling: new PreviewOverlay(), ownerDocument, parentElement: frame } },
	} as unknown as VideoPlaybackRef;
	const style = {
		getPropertyValue: () => "0.75",
		getPropertyPriority: () => "",
		setProperty: vi.fn(),
	};
	const menu = { style } as unknown as HTMLElement;
	const capture = vi.fn(() => Promise.resolve<string | null>("data:image/png;base64,frame"));
	vi.useFakeTimers();
	vi.stubGlobal("document", ownerDocument);
	vi.stubGlobal("HTMLElement", PreviewOverlay);
	vi.stubGlobal("HTMLMediaElement", { HAVE_CURRENT_DATA: 2 });
	vi.stubGlobal("Image", class { decode() { return Promise.resolve(); } });
	vi.stubGlobal("window", {
		electronAPI: { captureExportPreview: capture },
		setTimeout,
		clearTimeout,
		requestAnimationFrame: (callback: () => void) => setTimeout(callback, 16),
		cancelAnimationFrame: clearTimeout,
	});
	return { bounds, capture, frame, menu, playback, style, video };
}

it("excludes the export menu from the settled preview capture and restores its inline opacity", async () => {
	const { bounds, capture, frame, menu, playback, style, video } = createPreviewCapture();
	const result = capturePausedExportPreview(playback, menu);
	expect(style.setProperty).toHaveBeenCalledWith("opacity", "0", "important");
	await vi.advanceTimersByTimeAsync(16);
	expect(capture).not.toHaveBeenCalled();
	await vi.advanceTimersByTimeAsync(16);
	expect(capture).toHaveBeenCalledWith(bounds);
	expect(await result).toEqual({ imageUrl: "data:image/png;base64,frame", video, frame, time: 1.25 });
	expect(style.setProperty).toHaveBeenLastCalledWith("opacity", "0.75", "");
});

it("restores the export menu if the desktop preview capture stalls", async () => {
	const { capture, menu, playback, style } = createPreviewCapture();
	capture.mockImplementation(() => new Promise(() => {}));
	const result = capturePausedExportPreview(playback, menu);
	await vi.advanceTimersByTimeAsync(500);
	expect(await result).toBeNull();
	expect(capture).toHaveBeenCalledOnce();
	expect(style.setProperty).toHaveBeenLastCalledWith("opacity", "0.75", "");
});
