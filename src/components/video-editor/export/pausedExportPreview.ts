import type { Application } from "pixi.js";
import { flushSync } from "react-dom";
import type { createObservableValue } from "@/lib/observableValue";
import { destroyPixiApplication } from "@/lib/pixiApplicationLifecycle";
import type { VideoPlaybackRef } from "../VideoPlayback";

export type ExportPreview = { imageUrl: string; suspended: boolean; resumePlayback?: boolean };
export type ExportPreviewStore = ReturnType<typeof createObservableValue<ExportPreview | null>>;
export type PreparedExportPreview = { imageUrl: string; video: HTMLVideoElement; frame: HTMLElement; time: number };

export function createExportPreviewRenderer(store: ExportPreviewStore) {
	let active = false;
	let retained: Application | null = null;
	return {
		attach() {
			active = true;
			return () => {
				active = false;
				destroyPixiApplication(retained, "parked export preview");
				retained = null;
			};
		},
		park(app: Application) {
			const renderer = app.renderer;
			if (!active || retained || !store.get()?.suspended || !("gl" in renderer) || renderer.gl.isContextLost()) return false;
			try {
				// Keep the context across exports and release the scene and framebuffer
				// so the preview does not accumulate a new GPU allocation on every retry.
				app.stop();
				for (const child of app.stage.removeChildren()) child.destroy({ children: true });
				renderer.resize(1, 1);
				app.canvas.remove();
				retained = app;
				return true;
			} catch {
				return false;
			}
		},
		take() {
			const app = retained;
			retained = null;
			if (app && "gl" in app.renderer && app.renderer.gl.isContextLost()) {
				destroyPixiApplication(app, "lost export preview renderer");
				return null;
			}
			return app;
		},
	};
}

export type ExportPreviewRenderer = ReturnType<typeof createExportPreviewRenderer>;

export async function capturePausedExportPreview(
	playback: VideoPlaybackRef,
	exportMenu?: HTMLElement | null,
): Promise<PreparedExportPreview | null> {
	const { video } = playback;
	const container = playback.containerRef.current;
	const overlay = container?.nextElementSibling;
	if (!video || !container || !(overlay instanceof HTMLElement) || !overlay.hasAttribute("data-preview-overlay") ||
		!video.paused || video.seeking || video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA ||
		video.videoWidth * video.videoHeight < 3840 * 2160 || container.ownerDocument !== document ||
		typeof window.electronAPI?.captureExportPreview !== "function") return null;
	const frame = container.parentElement;
	if (!frame) return null;
	const { x, y, width, height } = overlay.getBoundingClientRect();
	const time = video.currentTime;
	const opacity = exportMenu?.style.getPropertyValue("opacity") ?? "";
	const priority = exportMenu?.style.getPropertyPriority("opacity") ?? "";
	let deadline: number | undefined;
	let paint: number | undefined;
	const capture = async () => {
		if (exportMenu) {
			// Leave the modal mounted and focused while its pixels are excluded.
			exportMenu.style.setProperty("opacity", "0", "important");
			await new Promise<void>(resolve => {
				paint = window.requestAnimationFrame(() => {
					paint = window.requestAnimationFrame(() => resolve());
				});
			});
		}
		const imageUrl = await window.electronAPI.captureExportPreview({ x, y, width, height });
		if (!imageUrl) return null;
		const image = new Image();
		image.src = imageUrl;
		await image.decode();
		return imageUrl;
	};
	try {
		const imageUrl = await Promise.race([
			capture(),
			new Promise<null>(resolve => { deadline = window.setTimeout(() => resolve(null), 500); }),
		]);
		if (!imageUrl || !video.paused || video.seeking || video.currentTime !== time || !frame.isConnected) return null;
		return { imageUrl, video, frame, time };
	} catch {
		return null;
	} finally {
		if (exportMenu) exportMenu.style.setProperty("opacity", opacity, priority);
		if (paint !== undefined) window.cancelAnimationFrame(paint);
		if (deadline !== undefined) window.clearTimeout(deadline);
	}
}

export function suspendPausedExportPreview(
	prepared: PreparedExportPreview,
	store: ExportPreviewStore,
	resumePlayback: boolean,
): (() => void) | undefined {
	const { imageUrl, frame, video } = prepared;
	const sources = new Set([video, ...frame.querySelectorAll("video")]);
	const still = { imageUrl, suspended: true };
	const resume = () => {
		if (store.get() === still) store.set({ imageUrl, suspended: false, resumePlayback });
	};
	try {
		flushSync(() => store.set(still));
		for (const source of sources) {
			if (source.isConnected) continue;
			source.pause();
			source.removeAttribute("src");
			source.load();
		}
		return resume;
	} catch {
		resume();
		return undefined;
	}
}
