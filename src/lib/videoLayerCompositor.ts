import { CanvasSource, Container, GpuMipmapGenerator, Graphics, Sprite, Texture, VideoSource, type WebGPURenderer } from "pixi.js";
import { WebcamLayerSurface } from "./webcamLayerSurface";
import type { VideoRegion, VideoTrack } from "@/components/video-editor/videoTracks";
import type { WebcamOverlaySettings } from "@/components/video-editor/types";
import { getCropMatchedWebcamHeightPercent, getWebcamCornerRadiusPx, getWebcamCropSourceRect, getWebcamOverlayDimensionsPx, getWebcamOverlayPosition, scaleWebcamOverlayPixels } from "@/components/video-editor/webcamOverlay";
import { getRenderableVideoUrl } from "./assetPath";
import { enablePitchPreservingPlayback } from "./mediaTiming";
import { applyPreviewPlaybackRate } from "@/components/video-editor/videoPlayback/playbackRate";
import { ForwardFrameSource } from "./exporter/forwardFrameSource";

const MAX_WEBCAM_SURFACE_REUSE_GAP_MS = 1000;

type Layer = {
	sourcePath: string;
	trackId: string;
	kind: VideoTrack["kind"];
	disposed?: boolean;
	root: Container; content: Container; mask?: Graphics; sprite: Sprite | null;
	webcamSurface?: WebcamLayerSurface;
	webcamLayout?: { region: VideoRegion; options: VideoLayerOptions };
	frameVersion?: number;
	frameCallback?: number;
	video?: HTMLVideoElement; decoder?: ForwardFrameSource;
	playRequested?: boolean;
	cancelLoading?: () => void;
	ready?: Promise<void>; frame?: VideoFrame; width: number; height: number;
};

function createWebcamSurfaceTexture(surface: WebcamLayerSurface, mipLevelCount?: number) {
	// Shadow, crop and viewport changes resize the backing canvas. Sprite must
	// refresh its cached geometry along with the texture's frame and UVs.
	return new Texture({
		source: new CanvasSource({
			resource: surface.canvas,
			autoGenerateMipmaps: mipLevelCount === undefined,
			mipLevelCount: mipLevelCount ?? 1,
			scaleMode: "linear",
		}),
		dynamic: true,
	});
}
export interface VideoLayerOptions {
	regions: VideoRegion[];
	tracks: VideoTrack[];
	webcam?: WebcamOverlaySettings;
	width: number;
	height: number;
	zoomScale?: number;
	resolution?: number;
}

/** One scene graph for independent webcam/B-roll clips in preview and both export pipelines. */
export class VideoLayerCompositor {
	constructor(private readonly options: {
		onPreviewFrame?: () => void;
		outputClipsVideoLayers?: boolean;
		webcamMipRenderer?: () => WebGPURenderer | undefined;
	} = {}) {}
	readonly container = new Container();
	private layers = new Map<string, Layer>();
	private disposed = false;
	private previewGeneration = 0;
	private webcamMipmaps?: GpuMipmapGenerator;
	private parkedWebcam: { region: VideoRegion; fromMs: number; layer: Layer } | null = null;

	private getLayer(region: VideoRegion, options: VideoLayerOptions) {
		const kind = region.kind ?? options.tracks.find(track => track.id === region.trackId)!.kind;
		let layer = this.layers.get(region.id);
		if (layer && (layer.sourcePath !== region.sourcePath || layer.kind !== kind)) { this.releaseLayer(layer); this.layers.delete(region.id); layer = undefined; }
		if (!layer && kind === "webcam" && this.parkedWebcam?.region === region) {
			const { root, content, mask, sprite, webcamSurface } = this.parkedWebcam.layer;
			this.parkedWebcam = null;
			layer = { sourcePath: region.sourcePath, trackId: region.trackId, kind, root, content, mask, sprite, webcamSurface, width: 1, height: 1 };
			this.layers.set(region.id, layer);
		}
		if (!layer) {
			const root = new Container();
			const content = new Container();
			const mask = kind === "video" && this.options.outputClipsVideoLayers ? undefined : new Graphics();
			if (mask) {
				content.addChild(mask);
				content.mask = mask;
			}
			root.addChild(content);
			layer = { sourcePath: region.sourcePath, trackId: region.trackId, kind, root, content, mask, sprite: null, width: 1, height: 1 };
			this.layers.set(region.id, layer);
			this.container.addChild(root);
		}
		layer.trackId = region.trackId;
		return layer;
	}
	private active(timeMs: number, options: VideoLayerOptions, reusePreview = false) {
		const parked = this.parkedWebcam;
		if (parked && (reusePreview || timeMs < parked.fromMs || timeMs >= parked.region.endMs ||
			!options.regions.includes(parked.region) || !this.trackShowsWebcam(parked.region.trackId, options))) {
			this.releaseLayer(parked.layer);
			this.parkedWebcam = null;
		}
		const result = options.regions.filter((region) => {
			const track = options.tracks.find((track) => track.id === region.trackId);
			return track && !track.hidden && ((region.kind ?? track.kind) !== "webcam" || options.webcam?.enabled !== false) && timeMs >= region.startMs && timeMs < region.endMs;
		}).sort((left, right) => options.tracks.findIndex((track) => track.id === left.trackId) - options.tracks.findIndex((track) => track.id === right.trackId));
		const ids = new Set(result.map((region) => region.id));
		if (reusePreview) for (const region of result) {
			if (this.layers.has(region.id)) continue;
			const kind = region.kind ?? options.tracks.find(track => track.id === region.trackId)?.kind;
			const reusable = [...this.layers].find(([id, layer]) => !ids.has(id) && layer.kind === kind && layer.video && !layer.disposed && layer.sourcePath === region.sourcePath);
			if (reusable) { this.layers.delete(reusable[0]); this.layers.set(region.id, reusable[1]); }
		}
		for (const [id, layer] of this.layers) if (!ids.has(id)) {
			layer.root.visible = false; layer.video?.pause();
			// Cancel pending loads too: a discarded seek must not later fail the whole editor.
			if (reusePreview || !this.parkWebcam(id, layer, timeMs, options)) this.releaseLayer(layer);
			this.layers.delete(id);
		}
		return result;
	}

	private trackShowsWebcam(trackId: string, options: VideoLayerOptions): boolean {
		return Boolean(options.webcam && options.webcam.enabled !== false &&
			options.tracks.some(track => track.id === trackId && !track.hidden));
	}

	private parkWebcam(id: string, layer: Layer, timeMs: number, options: VideoLayerOptions): boolean {
		if (this.parkedWebcam || layer.kind !== "webcam" || !layer.webcamSurface || !layer.sprite ||
			!this.trackShowsWebcam(layer.trackId, options)) return false;

		const previous = options.regions.find(region => region.id === id);
		if (!previous || previous.endMs > timeMs) return false;
		const track = options.tracks.find(track => track.id === layer.trackId);
		let next: VideoRegion | undefined;
		for (const region of options.regions) {
			if (region.trackId !== layer.trackId || region.sourcePath !== layer.sourcePath ||
				(region.kind ?? track?.kind) !== "webcam" || this.layers.has(region.id) ||
				region.endMs <= timeMs || region.startMs < previous.endMs ||
				region.startMs - previous.endMs > MAX_WEBCAM_SURFACE_REUSE_GAP_MS) continue;
			if (!next || region.startMs < next.startMs) next = region;
		}
		if (!next) return false;

		// A fresh layer owns the next decoder. Its canvas and sprite can stay
		// hidden during the gap and render again once the next frame is ready.
		layer.disposed = true;
		this.closeLayerDecoder(layer);
		layer.webcamSurface.invalidate();
		this.parkedWebcam = { region: next, fromMs: timeMs, layer };
		return true;
	}

	private layout(layer: Layer, region: VideoRegion, options: VideoLayerOptions, reorder = true) {
		if (this.disposed || layer.disposed || !layer.sprite || layer.sprite.destroyed || layer.root.destroyed) return;
		const isWebcam = (region.kind ?? options.tracks.find((track) => track.id === region.trackId)?.kind) === "webcam";
		const webcam = isWebcam ? options.webcam : undefined;
		let box = { x: 0, y: 0, width: options.width, height: options.height };
		let radius = 0;
		if (webcam) {
			const margin = scaleWebcamOverlayPixels(webcam.margin ?? 24, options.width);
			const size = getWebcamOverlayDimensionsPx({ scale: webcam?.scale ?? 1, containerWidth: options.width, containerHeight: options.height, widthPercent: webcam.width ?? webcam.size, heightPercent: getCropMatchedWebcamHeightPercent(webcam.width ?? webcam.size, webcam.height ?? webcam.size, layer.width, layer.height, webcam.cropRegion), margin, zoomScale: options.zoomScale ?? 1, reactToZoom: webcam.reactToZoom });
			const position = getWebcamOverlayPosition({ containerWidth: options.width, containerHeight: options.height, ...size, margin, positionPreset: webcam.positionPreset ?? webcam.corner, positionX: webcam.positionX ?? 1, positionY: webcam.positionY ?? 1, legacyCorner: webcam.corner });
			box = { ...position, ...size };
			radius = getWebcamCornerRadiusPx(webcam.roundness, box.width, box.height);
			layer.webcamLayout = { region, options };
			layer.webcamSurface ??= new WebcamLayerSurface();
			const surface = layer.webcamSurface;
			const baseSize = getWebcamOverlayDimensionsPx({ scale: webcam?.scale ?? 1, containerWidth: options.width, containerHeight: options.height, widthPercent: webcam.width ?? webcam.size, heightPercent: getCropMatchedWebcamHeightPercent(webcam.width ?? webcam.size, webcam.height ?? webcam.size, layer.width, layer.height, webcam.cropRegion), margin, zoomScale: 1, reactToZoom: false });
			// Clamp each dimension separately at the minimum camera size.
			// Keep that resulting aspect ratio when only one axis reaches the clamp.
			const rasterScale = Math.max(baseSize.width / box.width, baseSize.height / box.height);
			const sameAspect = Math.abs(baseSize.width * box.height - baseSize.height * box.width) < 0.000001;
			surface.configure(sameAspect ? baseSize.width : box.width * rasterScale, sameAspect ? baseSize.height : box.height * rasterScale, options.resolution ?? 1, webcam);
			const layout = surface.layout(box);
			const renderer = this.options.webcamMipRenderer?.();
			const previous = layer.sprite.texture;
			const previousSource = previous.source;
			const sameCanvas = previousSource.resource === surface.canvas;
			let mipLevelCount: number | undefined;
			if (renderer) {
				const { width, height } = surface.canvas;
				const scale = Math.max(width / Math.max(1, layout.width), height / Math.max(1, layout.height));
				const available = 1 + Math.floor(Math.log2(Math.max(width, height)));
				const required = 1 + Math.max(0, Math.ceil(Math.log2(scale)));
				// Let zoom allocate deeper levels as needed. Keep them when the same
				// surface grows on screen again so zooms do not churn its texture.
				const retained = sameCanvas && !previousSource.autoGenerateMipmaps &&
					previousSource.pixelWidth === width && previousSource.pixelHeight === height
					? previousSource.mipLevelCount : 1;
				mipLevelCount = Math.min(available, Math.max(required, retained));
			}
			const replaceTexture = !sameCanvas ||
				previousSource.autoGenerateMipmaps !== (mipLevelCount === undefined) ||
				(mipLevelCount !== undefined && previousSource.mipLevelCount !== mipLevelCount);
			if (replaceTexture) {
				layer.sprite.texture = createWebcamSurfaceTexture(surface, mipLevelCount);
				previous.destroy(true);
			}
			// Minification during reactive zoom must average the antialiased silhouette,
			// rather than skip the subpixel edge of the full-resolution surface.
			const source = layer.sprite.texture.source;
			source.resize(surface.canvas.width, surface.canvas.height);
			const media = layer.frame ?? layer.video;
			if (media && (surface.paint(media as CanvasImageSource, layer.width, layer.height, webcam, layer.frameVersion ?? 0) || replaceTexture)) {
				source.update();
				if (renderer && mipLevelCount && mipLevelCount > 1) {
					this.webcamMipmaps ??= new GpuMipmapGenerator(renderer.gpu.device);
					this.webcamMipmaps.generateMipmap(renderer.texture.getGpuSource(source));
				}
			}
			layer.sprite.anchor.set(0); layer.sprite.scale.set(1);
			layer.sprite.position.set(layout.x, layout.y);
			layer.sprite.width = layout.width; layer.sprite.height = layout.height;
			if (layer.mask) {
				layer.content.mask = null;
				layer.mask.visible = false;
			}
			layer.root.alpha = region.opacity ?? 1; layer.root.visible = true;
			if (reorder) this.container.addChild(layer.root);
			return;
		}
		const crop = getWebcamCropSourceRect(undefined, layer.width, layer.height);
		const fit = region.fit === "contain" ? Math.min : Math.max;
		const scale = fit(box.width / crop.sw, box.height / crop.sh);
		const mirror = false;
		layer.sprite.anchor.set(0.5);
		layer.sprite.scale.set(mirror ? -scale : scale, scale);
		layer.sprite.position.set(box.x + box.width / 2 + (layer.width / 2 - crop.sx - crop.sw / 2) * scale * (mirror ? -1 : 1), box.y + box.height / 2 + (layer.height / 2 - crop.sy - crop.sh / 2) * scale);
		layer.mask?.clear().roundRect(box.x, box.y, box.width, box.height, radius).fill(0xffffff);
		layer.root.alpha = region.opacity ?? 1;
		layer.root.filters = null;
		layer.root.visible = true;
		this.container.addChild(layer.root); // Authored track order, including overlapping layers.
	}
	updateViewport(viewport: Pick<VideoLayerOptions, "width" | "height" | "zoomScale" | "resolution">) {
		for (const layer of this.layers.values()) {
			if (layer.webcamLayout) this.layout(layer, layer.webcamLayout.region, { ...layer.webcamLayout.options, ...viewport }, false);
		}
	}
	async syncPreview(timeMs: number, playing: boolean, rate: number, options: VideoLayerOptions) {
		if (this.disposed) return;
		const generation = ++this.previewGeneration;
		for (const region of this.active(timeMs, options, true)) {
			const layer = this.getLayer(region, options);
			if (!layer.ready) layer.ready = (async () => {
				const video = document.createElement("video");
				layer.video = video;
				video.muted = true; video.preload = "metadata"; video.playsInline = true; video.crossOrigin = "anonymous";
				video.setAttribute("aria-hidden", "true");
				video.style.cssText = "position:fixed;left:0;top:0;width:1px;height:1px;opacity:0;pointer-events:none";
				// A connected media surface avoids Chromium deferring long detached videos.
				document.body?.appendChild(video);
				const url = await getRenderableVideoUrl(region.sourcePath);
				if (this.disposed || layer.disposed) return;
				await new Promise<void>((resolve, reject) => {
					const cleanup = () => { clearTimeout(timer); video.onloadedmetadata = null; video.onerror = null; layer.cancelLoading = undefined; };
					const timer = setTimeout(() => { cleanup(); reject(new Error(`Video layer did not load: ${region.sourcePath}`)); }, 15000);
					layer.cancelLoading = () => { cleanup(); resolve(); };
					// Detached long recordings can defer decoding until a seek/play request.
					// Metadata is sufficient to seek to the authored in-point and create VideoSource.
					video.onloadedmetadata = () => { cleanup(); resolve(); };
					video.onerror = () => { cleanup(); reject(new Error(`Video layer failed: ${region.sourcePath}`)); };
					video.src = url;
					video.load();
				});
				if (this.disposed || layer.disposed) return;
				layer.width = video.videoWidth; layer.height = video.videoHeight;
				video.currentTime = Math.max(0, Math.min(video.duration - 0.000001, (region.sourceStartMs + (timeMs - region.startMs) * region.speed) / 1000));
				if (video.readyState < 2 || video.seeking) await new Promise<void>((resolve, reject) => {
					const cleanup = () => { clearTimeout(timer); video.removeEventListener("loadeddata", check); video.removeEventListener("seeked", check); video.removeEventListener("error", failed); layer.cancelLoading = undefined; };
					const check = () => { if (video.readyState >= 2 && !video.seeking) { cleanup(); resolve(); } };
					const failed = () => { cleanup(); reject(new Error(`Video layer failed: ${region.sourcePath}`)); };
					const timer = setTimeout(failed, 15000);
					layer.cancelLoading = () => { cleanup(); resolve(); };
					video.addEventListener("loadeddata", check); video.addEventListener("seeked", check); video.addEventListener("error", failed);
					check();
				});
				if (this.disposed || layer.disposed) return;
				const isWebcam = options.tracks.find(track => track.id === region.trackId)?.kind === "webcam";
				const source = isWebcam ? null : new VideoSource({ resource: video, autoPlay: false });
				if (source) source.autoUpdate = true;
				const refreshFrame = () => {
					if (this.disposed || layer.disposed) return;
					layer.frameVersion = (layer.frameVersion ?? 0) + 1;
					source?.resize(video.videoWidth, video.videoHeight);
					source?.update();
					if (layer.webcamLayout) this.layout(layer, layer.webcamLayout.region, layer.webcamLayout.options, false);
					this.options.onPreviewFrame?.();
				};
				// Metadata can arrive before the first decoded frame. A paused monitor
				// has no running ticker to paint that frame when it subsequently arrives.
				video.addEventListener("loadeddata", refreshFrame);
				video.addEventListener("canplaythrough", refreshFrame);
				video.addEventListener("seeked", refreshFrame);
				if (isWebcam) {
					layer.webcamSurface = new WebcamLayerSurface();
					layer.sprite = new Sprite(createWebcamSurfaceTexture(layer.webcamSurface));
					const onFrame = () => { if (this.disposed || layer.disposed) return; refreshFrame(); layer.frameCallback = video.requestVideoFrameCallback(onFrame); };
					if (video.requestVideoFrameCallback) layer.frameCallback = video.requestVideoFrameCallback(onFrame);
				} else layer.sprite = new Sprite(new Texture({ source: source!, dynamic: true }));
				layer.content.addChildAt(layer.sprite, 0);
			})();
			try { await layer.ready; } catch (error) { if (this.disposed || layer.disposed) return; throw error; }
			if (this.disposed || layer.disposed || generation !== this.previewGeneration) return;
			const video = layer.video!;
			const target = Math.max(0, Math.min(video.duration - 0.000001, (region.sourceStartMs + (timeMs - region.startMs) * region.speed) / 1000));
			enablePitchPreservingPlayback(video);
			applyPreviewPlaybackRate(video, region.speed * rate);
			if (!video.seeking && Math.abs(video.currentTime - target) > (playing ? 0.12 : 0.001)) video.currentTime = target;
			if (playing) {
				// Playback startup can outlive a cut, hide, or window move. Never block scene
				// updates on it or retain a continuation that can touch a destroyed sprite.
				if (video.paused && !layer.playRequested) {
					layer.playRequested = true;
					void video.play().catch(() => undefined).finally(() => { layer.playRequested = false; });
				}
			} else video.pause();
			this.layout(layer, region, options);
		}
	}
	async syncExport(timeMs: number, options: VideoLayerOptions, signal?: AbortSignal) {
		signal?.throwIfAborted();
		if (this.disposed) return;
		for (const region of this.active(timeMs, options)) {
			const layer = this.getLayer(region, options);
			if (!layer.ready) layer.ready = (async () => {
				const decoder = new ForwardFrameSource(signal); layer.decoder = decoder;
				const metadata = await decoder.initialize(region.sourcePath, { startTimeSec: region.sourceStartMs / 1000 });
				layer.width = metadata.width; layer.height = metadata.height;
			})();
			try {
				await layer.ready;
			} catch (error) {
				if (this.disposed || layer.disposed) return;
				throw error;
			}
			if (this.disposed || layer.disposed) return;
			signal?.throwIfAborted();
			const target = Math.max(0, Math.min(region.sourceDurationMs - 0.001, region.sourceStartMs + (timeMs - region.startMs) * region.speed)) / 1000;
			const previous = layer.frame;
			const frame = layer.kind === "webcam"
				? await layer.decoder!.getFrameAtTime(target, previous ?? null)
				: await layer.decoder!.getFrameAtTime(target);
			if (this.disposed || layer.disposed || signal?.aborted) {
				if (frame && frame !== previous) frame.close();
				signal?.throwIfAborted();
				return;
			}
			if (!frame) throw new Error(`No frame for video layer ${region.id} at ${target}`);
			if (frame !== previous) {
				layer.frame = frame;
				layer.frameVersion = (layer.frameVersion ?? 0) + 1;
			}
			if (!layer.sprite) {
				if (layer.kind === "webcam") layer.webcamSurface = new WebcamLayerSurface();
				layer.sprite = new Sprite(layer.webcamSurface ? createWebcamSurfaceTexture(layer.webcamSurface) : Texture.from(frame as unknown as ImageBitmap));
				layer.content.addChildAt(layer.sprite, 0);
			} else if (!layer.webcamSurface) {
				const source = layer.sprite.texture.source as unknown as { resource: VideoFrame; update: () => void };
				source.resource = frame; source.update();
			}
			if (previous && previous !== frame) previous.close();
			this.layout(layer, region, options);
		}
	}
	private closeLayerDecoder(layer: Layer) {
		layer.decoder?.cancel();
		void layer.decoder?.destroy();
		layer.decoder = undefined;
		layer.frame?.close();
		layer.frame = undefined;
	}

	private releaseLayer(layer: Layer) {
		layer.disposed = true;
		layer.cancelLoading?.();
		if (layer.video && layer.frameCallback !== undefined) layer.video.cancelVideoFrameCallback?.(layer.frameCallback);
		if (layer.video) { layer.video.pause(); layer.video.removeAttribute("src"); layer.video.load(); layer.video.remove(); }
		this.closeLayerDecoder(layer);
		layer.root.filters = null;
		layer.root.destroy({ children: true, texture: true, textureSource: true });
	}
	destroy() {
		if (this.disposed) return;
		this.disposed = true;
		for (const layer of this.layers.values()) this.releaseLayer(layer);
		this.layers.clear();
		if (this.parkedWebcam) this.releaseLayer(this.parkedWebcam.layer);
		this.parkedWebcam = null;
		this.webcamMipmaps = undefined;
		this.container.destroy({ children: true, texture: true, textureSource: true });
	}
}
