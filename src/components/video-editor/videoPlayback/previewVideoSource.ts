import { CanvasSource, DOMAdapter } from "pixi.js";

/** Keep the last decoded screen frame through seeks, backgrounding and GPU restores. */
export class PreviewVideoSource {
	private video: HTMLVideoElement | null = null;
	private source: CanvasSource | null = null;
	private canvas: HTMLCanvasElement | null = null;
	private context: CanvasRenderingContext2D | null = null;
	private active = false;
	private frameRequest: number | null = null;
	private fallbackRequest: number | null = null;
	private generation = 0;

	constructor(private readonly onFrame?: () => void) {}

	private capture = () => {
		const video = this.video;
		if (!this.active || !video || !this.canvas || !this.context || !this.source || video.readyState < 2 || video.seeking || video.videoWidth <= 0 || video.videoHeight <= 0) return;
		if (this.canvas.width !== video.videoWidth || this.canvas.height !== video.videoHeight) {
			this.canvas.width = video.videoWidth; this.canvas.height = video.videoHeight;
		}
		// Upload stable pixels, never an HTML video whose frame can disappear between
		// a seek event and the renderer's next upload. Leave the old pixels on stalls.
		this.context.drawImage(video, 0, 0, this.canvas.width, this.canvas.height);
		this.source.resize(this.canvas.width, this.canvas.height);
		this.source.update();
		this.onFrame?.();
	};

	private requestFrame = () => {
		if (!this.active || !this.video) return;
		const generation = this.generation;
		if (this.video.requestVideoFrameCallback) {
			if (this.frameRequest !== null) return;
			this.frameRequest = this.video.requestVideoFrameCallback(() => { if (generation !== this.generation) return; this.frameRequest = null; this.capture(); this.requestFrame(); });
		} else if (this.fallbackRequest === null) {
			this.fallbackRequest = requestAnimationFrame(() => { if (generation !== this.generation) return; this.fallbackRequest = null; if (!this.video?.paused) this.capture(); this.requestFrame(); });
		}
	};

	private cancelFrame() {
		this.generation++;
		if (this.frameRequest !== null) this.video?.cancelVideoFrameCallback?.(this.frameRequest);
		if (this.fallbackRequest !== null) cancelAnimationFrame(this.fallbackRequest);
		this.frameRequest = this.fallbackRequest = null;
	}

	setVideo(video: HTMLVideoElement | null): void {
		if (video === this.video) return;
		this.cancelFrame();
		if (this.video) {
			for (const type of ["loadeddata", "seeked", "resize"]) this.video.removeEventListener(type, this.capture);
			this.video.ownerDocument?.removeEventListener("visibilitychange", this.capture);
			this.video.ownerDocument?.defaultView?.removeEventListener("focus", this.capture);
		}
		this.source?.destroy(); this.source = null; this.canvas = null; this.context = null;
		this.video = video;
		if (video) {
			for (const type of ["loadeddata", "seeked", "resize"]) video.addEventListener(type, this.capture);
			video.ownerDocument?.addEventListener("visibilitychange", this.capture);
			video.ownerDocument?.defaultView?.addEventListener("focus", this.capture);
		}
	}

	getSource(): CanvasSource {
		if (!this.video) throw new Error("Preview video element is not attached");
		if (!this.source) {
			this.canvas = DOMAdapter.get().createCanvas(1, 1) as HTMLCanvasElement;
			this.context = this.canvas.getContext("2d", { alpha: false });
			if (!this.context) throw new Error("Could not retain the screen preview frame");
			this.source = new CanvasSource({ resource: this.canvas });
		}
		this.active = true;
		this.capture(); this.requestFrame();
		return this.source;
	}

	suspend(): void {
		this.active = false; this.cancelFrame(); this.source?.unload();
	}
}
