import { spawn, type ChildProcessByStdio } from "node:child_process";
import type { Readable } from "node:stream";

export interface AudioPcmWindow {
	firstFrame: number;
	endFrame: number;
	channels: number;
	sampleRate: number;
}

const MAX_OPEN_DECODERS = 4;

export function audioPcmOutputArgs(channels: number, sampleRate: number) {
	return ["-ac", String(channels), "-ar", String(sampleRate), "-f", "s16le", "pipe:1"];
}

class AudioPcmDecoder {
	private readonly child: ChildProcessByStdio<null, Readable, null>;
	private readonly output: AsyncIterator<Buffer>;
	private readonly completed: Promise<{ code: number | null; error?: Error }>;
	private stopping = false;
	private position = 0;
	private unread: Buffer = Buffer.alloc(0);
	private cached = Buffer.alloc(0);
	private cacheStart = 0;

	constructor(ffmpeg: string, source: string, channels: number, sampleRate: number) {
		this.child = spawn(ffmpeg, [
			"-v", "error", "-nostdin", "-i", source, "-map", "0:a:0",
			...audioPcmOutputArgs(channels, sampleRate),
		], { windowsHide: true, stdio: ["ignore", "pipe", "ignore"] });
		this.output = this.child.stdout[Symbol.asyncIterator]();
		this.completed = new Promise(resolve => {
			let error: Error | undefined;
			this.child.once("error", reason => { error = reason; });
			this.child.once("close", code => resolve({ code, error }));
		});
	}

	canRead(firstByte: number) {
		return firstByte >= this.cacheStart;
	}

	async close() {
		if (!this.stopping) {
			this.stopping = true;
			this.child.kill("SIGKILL");
			// A paused stdout must close even when its reader is between windows.
			this.child.stdout.destroy();
		}
		await this.completed;
	}

	async read(firstByte: number, endByte: number, signal: AbortSignal) {
		if (firstByte >= this.cacheStart && endByte <= this.cacheStart + this.cached.length) {
			return Buffer.from(this.cached.subarray(firstByte - this.cacheStart, endByte - this.cacheStart));
		}
		const bytes = Buffer.allocUnsafe(endByte - firstByte);
		let copied = 0;
		if (firstByte < this.cacheStart + this.cached.length) {
			copied = this.cached.copy(bytes, 0, firstByte - this.cacheStart);
		}
		while (this.position < endByte) {
			signal.throwIfAborted();
			if (!this.unread.length) {
				const next = await this.output.next();
				if (next.done) {
					const { code, error } = await this.completed;
					signal.throwIfAborted();
					if (error || code !== 0) throw error ?? new Error(`FFmpeg PCM decoder exited with ${code}`);
					break;
				}
				this.unread = next.value;
			}
			const consumed = Math.min(endByte - this.position, this.unread.length);
			const start = Math.max(firstByte + copied - this.position, 0);
			if (start < consumed) copied += this.unread.copy(bytes, copied, start, consumed);
			this.position += consumed;
			this.unread = this.unread.subarray(consumed);
		}
		this.cacheStart = firstByte;
		this.cached = bytes.subarray(0, copied);
		return this.cached;
	}
}

/** Retain only the latest sample window for each recently used source. */
export class AudioPcmWindowPool {
	private readonly decoders = new Map<string, AudioPcmDecoder>();
	private readonly controller = new AbortController();
	private closed?: Promise<void>;

	constructor(private readonly ffmpeg: string) {}

	close() {
		if (this.closed) return this.closed;
		this.controller.abort();
		this.closed = Promise.all([...this.decoders.values()].map(decoder => decoder.close())).then(() => {
			this.decoders.clear();
		});
		return this.closed;
	}

	async read(source: string, { firstFrame, endFrame, channels, sampleRate }: AudioPcmWindow, signal: AbortSignal) {
		const readSignal = AbortSignal.any([signal, this.controller.signal]);
		readSignal.throwIfAborted();
		const firstByte = firstFrame * channels * 2;
		const endByte = endFrame * channels * 2;
		const key = JSON.stringify([source, channels, sampleRate]);
		let decoder = this.decoders.get(key);
		if (decoder && !decoder.canRead(firstByte)) {
			await decoder.close();
			this.decoders.delete(key);
			decoder = undefined;
		}
		if (!decoder && this.decoders.size >= MAX_OPEN_DECODERS) {
			const [oldest, reader] = this.decoders.entries().next().value!;
			await reader.close();
			this.decoders.delete(oldest);
		}
		readSignal.throwIfAborted();
		decoder ??= new AudioPcmDecoder(this.ffmpeg, source, channels, sampleRate);
		this.decoders.delete(key);
		this.decoders.set(key, decoder);
		const reader = decoder;
		const abort = () => { void reader.close(); };
		readSignal.addEventListener("abort", abort, { once: true });
		try {
			const bytes = await reader.read(firstByte, endByte, readSignal);
			readSignal.throwIfAborted();
			return bytes;
		} catch (error) {
			await reader.close();
			this.decoders.delete(key);
			readSignal.throwIfAborted();
			throw error;
		} finally {
			readSignal.removeEventListener("abort", abort);
		}
	}
}
