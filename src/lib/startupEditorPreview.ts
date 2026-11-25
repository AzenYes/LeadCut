import type { Application } from "pixi.js";
import { destroyPixiApplication, initializePixiApplicationWithTimeout } from "./pixiApplicationLifecycle";

type StartupPreview = {
	request?: Promise<ProjectLoadResult>;
	video?: HTMLVideoElement;
	expiry?: number;
};

let preparedRenderer: { result: Promise<Application | null>; expiry: number } | undefined;
const MAX_WEBGPU_PREVIEW_PIXELS = 1920 * 1080;

function getStartupPreview(): StartupPreview | undefined {
	return (window as Window & { leadcutStartupPreview?: StartupPreview }).leadcutStartupPreview;
}

export function loadInitialEditorProject() {
	const preview = getStartupPreview();
	const request = preview?.request;
	if (preview) preview.request = undefined;
	return request ?? window.electronAPI.loadCurrentProjectFile();
}

export function findStartupPreviewVideo(source: string): HTMLVideoElement | null {
	const video = getStartupPreview()?.video;
	return video?.getAttribute("src") === source ? video : null;
}

export function retainStartupPreviewVideo(video: HTMLVideoElement): () => void {
	const preview = getStartupPreview();
	if (preview?.video === video) window.clearTimeout(preview.expiry);
	return () => {
		if (preview?.video === video) delete preview.video;
	};
}

export function prepareStartupPreviewRenderer(): void {
	const project = getStartupPreview()?.request;
	if (!project || !navigator.gpu) return;
	const result = project.then(async loaded => {
		if (!loaded.startupOpen || !loaded.success) return null;
		const { Application } = await import("pixi.js");
		const app = new Application();
		try {
			await initializePixiApplicationWithTimeout(app, {
				width: 1,
				height: 1,
				backgroundAlpha: 0,
				antialias: true,
				failIfMajorPerformanceCaveat: false,
				resolution: window.devicePixelRatio || 1,
				autoDensity: true,
				preference: "webgpu",
				autoStart: false,
				sharedTicker: false,
			}, 8000, "webgpu");
			performance.mark("leadcut-early-renderer-ready");
			return app;
		} catch {
			destroyPixiApplication(app, "startup preview renderer");
			return null;
		}
	}).catch(() => null);
	const expiry = window.setTimeout(() => {
		if (preparedRenderer?.result !== result) return;
		preparedRenderer = undefined;
		void result.then(app => {
			if (app) destroyPixiApplication(app, "unused startup preview renderer");
		});
	}, 6000);
	preparedRenderer = { result, expiry };
}

export function takeStartupPreviewRenderer(video: HTMLVideoElement | null): Promise<Application | null> | undefined {
	const pending = preparedRenderer;
	if (!pending) return;
	window.clearTimeout(pending.expiry);
	preparedRenderer = undefined;
	// WebGPU's color-preserving upload needs a staging canvas. Preserve the
	// direct frame upload on WebGL for large sources and unknown dimensions.
	const pixels = video ? video.videoWidth * video.videoHeight : 0;
	if (pixels <= 0 || pixels > MAX_WEBGPU_PREVIEW_PIXELS) {
		void pending.result.then(app => {
			if (app) destroyPixiApplication(app, "unused startup preview renderer");
		});
		return;
	}
	let wait: number | undefined;
	const fallback = new Promise<null>(resolve => {
		wait = window.setTimeout(() => resolve(null), 350);
	});
	return Promise.race([pending.result, fallback]).then(app => {
		window.clearTimeout(wait);
		if (!app) void pending.result.then(late => {
			if (late) destroyPixiApplication(late, "late startup preview renderer");
		});
		return app;
	});
}
