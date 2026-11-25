import GIF from "gif.js";
import { getGifFrameDelayMs } from "./gifTiming";
import type { FrameSink } from "./renderExportFrames";
import type { GifFrameRate } from "./types";

const GIF_WORKER_URL = new URL("gif.js/dist/gif.worker.js", import.meta.url).toString();

export function getGifRepeat(loop: boolean): -1 | 0 {
	return loop ? 0 : -1;
}

interface GifFrameSinkOptions {
	width: number;
	height: number;
	frameRate: GifFrameRate;
	loop: boolean;
	getCanvas: () => HTMLCanvasElement;
	checkFrameBudget: (frameCount: number) => void;
	onFinalizing: (progress?: number) => void;
}

export class GifFrameSink implements FrameSink<Blob> {
	private gif: GIF | null = null;

	constructor(private readonly options: GifFrameSinkOptions) {}

	start(): void {
		const { width, height, loop } = this.options;
		const cores = navigator.hardwareConcurrency || 4;
		this.gif = new GIF({
			workers: Math.max(1, Math.min(8, cores - 1)),
			quality: 10,
			width,
			height,
			workerScript: GIF_WORKER_URL,
			repeat: getGifRepeat(loop),
			background: "#000000",
			transparent: null,
			dither: "FloydSteinberg",
		});
	}

	writeFrame(frameIndex: number): void {
		const { checkFrameBudget, getCanvas, frameRate } = this.options;
		checkFrameBudget(frameIndex + 1);
		this.gif!.addFrame(getCanvas(), { delay: getGifFrameDelayMs(frameIndex, frameRate), copy: true });
	}

	async finish(): Promise<Blob> {
		const { onFinalizing } = this.options;
		try {
			onFinalizing();
			const gif = this.gif;
			if (!gif) throw new Error("Export cancelled");

			return await new Promise<Blob>((resolve, reject) => {
				gif.once("finished", (result, data) => {
					// gif.js includes the unused bytes of its last page after the GIF trailer.
					let length = data.length;
					while (data[length - 1] === 0) length--;
					resolve(data[length - 1] === 0x3b && length < result.size
						? result.slice(0, length, result.type) : result);
				});
				gif.once("abort", () => reject(new Error("Export cancelled")));
				gif.on("progress", progress => onFinalizing(Math.round(progress * 100)));
				gif.render();
			});
		} finally {
			this.abort();
		}
	}

	abort(): void {
		const gif = this.gif;
		if (!gif) return;
		this.gif = null;
		gif.abort();
		// gif.js terminates active workers on abort and retains idle workers for reuse.
		const { freeWorkers } = gif as GIF & { freeWorkers: Worker[] };
		for (const worker of freeWorkers) worker.terminate();
	}
}
