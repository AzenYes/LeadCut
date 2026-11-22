import type { WebcamOverlaySettings } from "@/components/video-editor/types";
import { getWebcamCornerRadiusPx, getWebcamCropSourceRect } from "@/components/video-editor/webcamOverlay";
import { getShadowFilterPadding, getWebcamShadowFilter, getWebcamShadowStrength, WEBCAM_SHADOW_LAYER_PROFILES } from "./exporter/shadowProfile";
import { drawSquircleOnCanvas } from "./geometry/squircle";

/** Continuous corners and two soft shadows, rasterized without stencil masks. */
export class WebcamLayerSurface {
	readonly canvas = document.createElement("canvas");
	private readonly shadow = document.createElement("canvas");
	private readonly context = this.canvas.getContext("2d")!;
	private key = "";
	private width = 1;
	private height = 1;
	private padding = 0;
	private radius = 0;
	private paintedSource: CanvasImageSource | null = null;
	private paintedFrame = -1;

	configure(width: number, height: number, resolution: number, webcam: WebcamOverlaySettings) {
		// A fixed surface survives animated zoom. Supersample the silhouette and let
		// the GPU scale premultiplied pixels, rather than rebuilding a hard stencil.
		const quality = Math.min(2 * Math.max(1, resolution), 2048 / Math.max(1, width, height));
		const w = Math.max(1, Math.ceil(width * quality));
		const h = Math.max(1, Math.ceil(height * quality));
		const strength = getWebcamShadowStrength(webcam.shadow ?? 0);
		const radius = getWebcamCornerRadiusPx(webcam.roundness, w, h);
		const key = JSON.stringify([w, h, radius, strength, webcam.mirror, webcam.cropRegion]);
		if (key === this.key) return;
		this.key = key;
		this.width = w; this.height = h; this.radius = radius;
		this.padding = WEBCAM_SHADOW_LAYER_PROFILES.reduce((sum, profile) => sum + getShadowFilterPadding(Math.min(w, h) * profile.blurScale * strength, Math.min(w, h) * profile.offsetScale * strength), 0);
		this.canvas.width = this.shadow.width = w + this.padding * 2;
		this.canvas.height = this.shadow.height = h + this.padding * 2;
		const ctx = this.shadow.getContext("2d")!;
		if (strength > 0) {
			const silhouette = document.createElement("canvas");
			silhouette.width = this.canvas.width; silhouette.height = this.canvas.height;
			const mask = silhouette.getContext("2d")!;
			drawSquircleOnCanvas(mask, { x: this.padding, y: this.padding, width: w, height: h, radius });
			mask.fillStyle = "black"; mask.fill();
			ctx.filter = getWebcamShadowFilter(Math.min(w, h), webcam.shadow ?? 0);
			ctx.drawImage(silhouette, 0, 0); ctx.filter = "none";
		}
		this.paintedSource = null;
	}

	paint(source: CanvasImageSource, sourceWidth: number, sourceHeight: number, webcam: WebcamOverlaySettings, frame: number): boolean {
		if (source === this.paintedSource && frame === this.paintedFrame) return false;
		const ctx = this.context;
		ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
		ctx.drawImage(this.shadow, 0, 0);
		ctx.save();
		drawSquircleOnCanvas(ctx, { x: this.padding, y: this.padding, width: this.width, height: this.height, radius: this.radius });
		ctx.clip();
		ctx.translate(this.padding, this.padding);
		if (webcam.mirror) { ctx.translate(this.width, 0); ctx.scale(-1, 1); }
		ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = "high";
		const crop = getWebcamCropSourceRect(webcam.cropRegion, sourceWidth, sourceHeight);
		const scale = Math.max(this.width / crop.sw, this.height / crop.sh);
		ctx.drawImage(source, crop.sx, crop.sy, crop.sw, crop.sh, (this.width - crop.sw * scale) / 2, (this.height - crop.sh * scale) / 2, crop.sw * scale, crop.sh * scale);
		ctx.restore();
		this.paintedSource = source; this.paintedFrame = frame;
		return true;
	}

	layout(box: { x: number; y: number; width: number; height: number }) {
		const scaleX = box.width / this.width;
		const scaleY = box.height / this.height;
		return { x: box.x - this.padding * scaleX, y: box.y - this.padding * scaleY, width: this.canvas.width * scaleX, height: this.canvas.height * scaleY };
	}

	invalidate() { this.paintedSource = null; }
}
