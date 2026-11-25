import { WebDemuxer } from "web-demuxer";
import { AudioTimelineProcessor } from "./audioTimelineProcessor";
import { DECODE_BACKPRESSURE_LIMIT, OFFLINE_AUDIO_SAMPLE_RATE, type OfflineAudioInput } from "./audioProcessorShared";
import { MAX_EXPORT_SOURCE_PCM_WINDOW_BYTES } from "./editedAudioWav";
import { getLocalFilePath, resolveMediaElementSource } from "./localMediaSource";

export class AudioMediaProcessor extends AudioTimelineProcessor {
	private readonly offlineSourcePaths = new Set<string>();
	private readonly offlineSourceAbort = new AbortController();
	private offlinePcmReader?: Promise<string>;

	constructor(private readonly useMemoryPcmWindows = false) {
		super();
	}

	override cancel() {
		super.cancel();
		this.offlineSourceAbort.abort();
		if (typeof window !== "undefined") {
			void window.electronAPI?.cancelExportAudioPcm?.().catch(() => undefined);
		}
	}

	protected async releaseOfflineAudioSources() {
		const paths = [...this.offlineSourcePaths];
		this.offlineSourcePaths.clear();
		const reader = this.offlinePcmReader;
		this.offlinePcmReader = undefined;
		const pending: Promise<unknown>[] = paths.map(path => window.electronAPI.discardExportedTemp(path));
		if (reader) pending.push(reader.then(id => window.electronAPI.closeExportAudioPcmReader?.(id)));
		await Promise.allSettled(pending);
	}

	protected async loadOfflineAudioInput(
		url: string,
		windowBounds?: { startSec: number; endSec: number },
	): Promise<OfflineAudioInput | null> {
		const localPath = getLocalFilePath(url);
		const bridge = typeof window === "undefined" ? null : window.electronAPI;
		const readSourceWindow = this.useMemoryPcmWindows ? bridge?.readExportAudioPcmWindow : undefined;
		const staged = localPath ? await (readSourceWindow
			? bridge?.prepareExportAudioPcm?.(localPath, windowBounds, true)
			: bridge?.prepareExportAudioPcm?.(localPath, windowBounds)) : null;
		if (!staged) return this.cancelled ? null : this.decodeAudioFromUrl(url);
		const { frames, channels, sampleRate, firstFrame: stagedFirstFrame = 0 } = staged;
		if ("path" in staged) this.offlineSourcePaths.add(staged.path);
		if (this.cancelled) return null;
		const bytesPerFrame = 2 * channels;
		const signal = this.offlineSourceAbort.signal;
		const acquirePcmReader = () => {
			if (bridge?.openExportAudioPcmReader && bridge.closeExportAudioPcmReader) {
				this.offlinePcmReader ??= bridge.openExportAudioPcmReader();
				return this.offlinePcmReader;
			}
		};
		return {
			duration: staged.sourceDurationSec ?? frames / sampleRate,
			numberOfChannels: channels,
			async readWindow(context, startSec, durationSec, paddingSec = 0) {
				const firstFrame = Math.max(stagedFirstFrame, Math.floor((startSec - paddingSec) * sampleRate));
				const requestedEndFrame = Math.ceil((startSec + durationSec + paddingSec) * sampleRate);
				// A decoder may emit codec padding beyond the container's declared duration.
				const endFrame = "memoryWindows" in staged ? requestedEndFrame : Math.min(stagedFirstFrame + frames, requestedEndFrame);
				const frameCount = endFrame - firstFrame;
				if (frameCount <= 0) throw new Error("Edited audio range is outside the staged source.");
				const firstByte = (firstFrame - stagedFirstFrame) * bytesPerFrame;
				const endByte = (endFrame - stagedFirstFrame) * bytesPerFrame;
				const parts: Uint8Array[] = [];
				if ("memoryWindows" in staged) {
					if (!localPath || !readSourceWindow) throw new Error("The export PCM range reader is unavailable.");
					signal.throwIfAborted();
					const reader = acquirePcmReader();
					const readerId = reader ? await reader : undefined;
					const framesPerRead = Math.floor(MAX_EXPORT_SOURCE_PCM_WINDOW_BYTES / bytesPerFrame);
					for (let from = firstFrame; from < endFrame;) {
						signal.throwIfAborted();
						const to = Math.min(from + framesPerRead, endFrame);
						const range = { firstFrame: from, endFrame: to, channels, sampleRate };
						const bytes = await (readerId ? readSourceWindow(localPath, range, readerId) : readSourceWindow(localPath, range));
						if (bytes.byteLength > (to - from) * bytesPerFrame || bytes.byteLength % bytesPerFrame) {
							throw new Error("Invalid PCM range from the native decoder.");
						}
						parts.push(bytes);
						if (bytes.byteLength < (to - from) * bytesPerFrame) break;
						from = to;
					}
				} else if ("pcm" in staged) {
					parts.push(staged.pcm.subarray(firstByte, endByte));
				} else {
					const response = await fetch(staged.url, {
						headers: { Range: `bytes=${firstByte}-${endByte - 1}` },
						signal,
					});
					if (response.status !== 206) {
						await response.body?.cancel();
						throw new Error("Could not stream the edited audio source.");
					}
					parts.push(new Uint8Array(await response.arrayBuffer()));
				}
				const availableFrames = parts.reduce((sum, bytes) => sum + bytes.byteLength / bytesPerFrame, 0);
				if (availableFrames === 0 || (!("memoryWindows" in staged) && availableFrames !== frameCount)) {
					throw new Error("Incomplete audio source range.");
				}
				const buffer = context.createBuffer(channels, availableFrames, sampleRate);
				let offset = 0;
				for (const bytes of parts) {
					const samples = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
					const framesInPart = bytes.byteLength / bytesPerFrame;
					for (let channel = 0; channel < channels; channel++) {
						const output = buffer.getChannelData(channel);
						for (let frame = 0; frame < framesInPart; frame++) {
							output[offset + frame] = samples.getInt16(frame * bytesPerFrame + channel * 2, true) / 32768;
						}
					}
					offset += framesInPart;
				}
				return { buffer, offsetSec: Math.max(0, startSec - firstFrame / sampleRate) };
			},
		};
	}

	protected async decodeAudioFromUrl(url: string): Promise<AudioBuffer | null> {
		const localPath = getLocalFilePath(url);
		const bridge = window.electronAPI;
		if (localPath && /\.(?:mp4|m4v|mov|webm|mkv|avi)$/i.test(localPath)) {
			const audioPath = await bridge?.prepareExportAudioSource?.(localPath).catch(() => null);
			if (audioPath) {
				try {
					if (this.cancelled) return null;
					const buffer = await this.decodeAudioSource(audioPath);
					if (buffer || this.cancelled) return buffer;
				} finally {
					await bridge.discardExportedTemp(audioPath).catch(() => undefined);
				}
			}
		}
		return this.cancelled ? null : this.decodeAudioSource(url);
	}

	private async decodeAudioSource(url: string): Promise<AudioBuffer | null> {
		try {
			const buffer = await this.streamDecodeFromUrl(url);
			if (buffer) return buffer;
		} catch (error) {
			console.warn(
				"[AudioProcessor] Streaming decode failed, falling back to bulk decode:",
				url,
				error,
			);
		}
		return this.cancelled ? null : this.bulkDecodeFromUrl(url, OFFLINE_AUDIO_SAMPLE_RATE);
	}

	// Streaming decode via WebDemuxer + AudioDecoder. Decodes audio chunk-by-chunk
	// without loading the entire compressed file into a contiguous ArrayBuffer.
	protected async streamDecodeFromUrl(url: string): Promise<AudioBuffer | null> {
		const source = await resolveMediaElementSource(url);
		let demuxer: WebDemuxer | null = null;

		try {
			const wasmUrl = new URL("./wasm/web-demuxer.wasm", window.location.href).href;
			demuxer = new WebDemuxer({ wasmFilePath: wasmUrl });
			await demuxer.load(source.src);

			let audioConfig: AudioDecoderConfig;
			try {
				audioConfig = (await demuxer.getDecoderConfig("audio")) as AudioDecoderConfig;
			} catch {
				return null; // No audio track
			}

			const sampleRate = audioConfig.sampleRate || 48_000;
			const numChannels = Math.min(audioConfig.numberOfChannels || 2, 2);

			// Accumulate decoded PCM per channel
			const channelChunks: Float32Array[][] = Array.from({ length: numChannels }, () => []);
			let totalFrames = 0;
			let decodeError: Error | null = null;
			const decodeCapacityWaiters = new Set<() => void>();

			const notifyDecodeCapacityAvailable = () => {
				if (decodeCapacityWaiters.size === 0) {
					return;
				}

				const waiters = [...decodeCapacityWaiters];
				decodeCapacityWaiters.clear();
				for (const resolve of waiters) {
					resolve();
				}
			};

			const waitForDecodeCapacity = () =>
				new Promise<void>((resolve) => {
					decodeCapacityWaiters.add(resolve);
				});

			const decoder = new AudioDecoder({
				output: (data: AudioData) => {
					try {
						const frames = data.numberOfFrames;
						const dataChannels = Math.min(data.numberOfChannels, numChannels);
						const format = data.format;

						if (format?.includes("planar")) {
							for (let ch = 0; ch < dataChannels; ch++) {
								const size = data.allocationSize({
									planeIndex: ch,
								});
								const bytes = new ArrayBuffer(size);
								data.copyTo(bytes, { planeIndex: ch });
								channelChunks[ch].push(this.rawToFloat32(bytes, format, frames));
							}
						} else if (format) {
							// Interleaved format — deinterleave into per-channel arrays.
							// Use data.numberOfChannels as stride (not capped dataChannels)
							// since the raw buffer contains all source channels.
							const srcChannels = data.numberOfChannels;
							const size = data.allocationSize({ planeIndex: 0 });
							const bytes = new ArrayBuffer(size);
							data.copyTo(bytes, { planeIndex: 0 });
							const interleaved = this.rawToFloat32(
								bytes,
								format,
								frames * srcChannels,
							);
							for (let ch = 0; ch < dataChannels; ch++) {
								const chData = new Float32Array(frames);
								for (let i = 0; i < frames; i++) {
									chData[i] = interleaved[i * srcChannels + ch];
								}
								channelChunks[ch].push(chData);
							}
						}

						// Fill missing channels with silence
						for (let ch = dataChannels; ch < numChannels; ch++) {
							channelChunks[ch].push(new Float32Array(frames));
						}

						totalFrames += frames;
					} finally {
						data.close();
						notifyDecodeCapacityAvailable();
					}
				},
				error: (err: DOMException) => {
					decodeError = new Error(`Streaming audio decode error: ${err.message}`);
					notifyDecodeCapacityAvailable();
				},
			});

			decoder.configure(audioConfig);

			const audioStream = demuxer.read("audio");
			const reader = (audioStream as ReadableStream<EncodedAudioChunk>).getReader();

			try {
				while (!this.cancelled) {
					if (decodeError) throw decodeError;
					const { done, value: chunk } = await reader.read();
					if (done || !chunk) break;

					decoder.decode(chunk);

					while (decoder.decodeQueueSize > DECODE_BACKPRESSURE_LIMIT && !this.cancelled) {
						if (decodeError) throw decodeError;
						await waitForDecodeCapacity();
					}
				}

				if (decoder.state === "configured") {
					await decoder.flush();
				}
				if (decodeError) throw decodeError;
			} finally {
				notifyDecodeCapacityAvailable();
				try {
					await reader.cancel();
				} catch {
					/* reader already closed */
				}
				if (decoder.state === "configured") {
					decoder.close();
				}
			}

			if (totalFrames === 0) return null;

			// Build AudioBuffer from accumulated chunks
			const audioBuffer = new AudioBuffer({
				length: totalFrames,
				numberOfChannels: numChannels,
				sampleRate,
			});
			for (let ch = 0; ch < numChannels; ch++) {
				const channelData = audioBuffer.getChannelData(ch);
				let writeOffset = 0;
				for (const chunk of channelChunks[ch]) {
					channelData.set(chunk, writeOffset);
					writeOffset += chunk.length;
				}
			}

			return audioBuffer;
		} finally {
			source.revoke();
			try {
				demuxer?.destroy();
			} catch {
				/* cleanup */
			}
		}
	}

	// Convert raw bytes from AudioData to Float32Array based on the sample format.
	protected rawToFloat32(bytes: ArrayBuffer, format: string, sampleCount: number): Float32Array {
		if (format.startsWith("f32")) {
			return new Float32Array(bytes);
		}
		if (format.startsWith("s16")) {
			const int16 = new Int16Array(bytes);
			const f32 = new Float32Array(sampleCount);
			for (let i = 0; i < sampleCount; i++) {
				f32[i] = int16[i] / 0x8000;
			}
			return f32;
		}
		if (format.startsWith("s32")) {
			const int32 = new Int32Array(bytes);
			const f32 = new Float32Array(sampleCount);
			for (let i = 0; i < sampleCount; i++) {
				f32[i] = int32[i] / 0x80000000;
			}
			return f32;
		}
		if (format.startsWith("u8")) {
			const uint8 = new Uint8Array(bytes);
			const f32 = new Float32Array(sampleCount);
			for (let i = 0; i < sampleCount; i++) {
				f32[i] = (uint8[i] - 128) / 128;
			}
			return f32;
		}
		// Unknown format — attempt float32 interpretation
		return new Float32Array(bytes);
	}

	// Bulk decode fallback: loads entire file into memory and uses decodeAudioData.
	protected async bulkDecodeFromUrl(
		url: string,
		sampleRate: number,
	): Promise<AudioBuffer | null> {
		try {
			const source = await resolveMediaElementSource(url);
			try {
				const response = await fetch(source.src);
				const arrayBuffer = await response.arrayBuffer();
				const tempCtx = new OfflineAudioContext(2, 1, sampleRate);
				return await tempCtx.decodeAudioData(arrayBuffer);
			} finally {
				source.revoke();
			}
		} catch (error) {
			console.warn("[AudioProcessor] Failed to decode audio from URL:", url, error);
			return null;
		}
	}

	// Get the duration of a media file by loading only its metadata.
	protected async getMediaDurationSec(url: string): Promise<number> {
		const source = await resolveMediaElementSource(url);
		try {
			const media = document.createElement("video");
			media.preload = "metadata";
			media.src = source.src;

			return await new Promise<number>((resolve, reject) => {
				const timeout = setTimeout(() => {
					cleanup();
					media.src = "";
					media.load();
					reject(new Error("Timed out getting media duration (30s)"));
				}, 30_000);

				const onLoaded = () => {
					cleanup();
					const duration = media.duration;
					media.src = "";
					media.load();
					resolve(Number.isFinite(duration) ? duration : 0);
				};
				const onError = () => {
					cleanup();
					media.src = "";
					media.load();
					reject(new Error("Failed to get media duration"));
				};
				const cleanup = () => {
					clearTimeout(timeout);
					media.removeEventListener("loadedmetadata", onLoaded);
					media.removeEventListener("error", onError);
				};

				media.addEventListener("loadedmetadata", onLoaded);
				media.addEventListener("error", onError, { once: true });
			});
		} finally {
			source.revoke();
		}
	}

	// Build non-overlapping timeline slices from the source timeline, excluding
	// trimmed regions and tagging each slice with its playback speed.
}
