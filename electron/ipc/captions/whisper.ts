import { createHash } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { constants as fsConstants } from "node:fs";
import fs from "node:fs/promises";
import { get as httpsGet } from "node:https";
import { Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import type Electron from "electron";
import {
	WHISPER_MODEL_DIR,
	WHISPER_MODEL_DOWNLOAD_URL,
	WHISPER_SMALL_MODEL_PATH,
} from "../constants";

// Published by the whisper.cpp model repository's ggml-small.bin Git LFS pointer.
const SMALL_MODEL_BYTES = 487_601_967;
const SMALL_MODEL_SHA256 = "1be3a9b2063867b937e64e2ec7483364a79917e157fa98c5d94b5c1fffea987b";
const MODEL_URLS = [
	WHISPER_MODEL_DOWNLOAD_URL,
	"https://hf-mirror.com/ggerganov/whisper.cpp/resolve/main/ggml-small.bin",
];
let currentDownload: Promise<string> | null = null;
let downloadController: AbortController | null = null;
const subscribers = new Set<Electron.WebContents>();

export function sendWhisperModelDownloadProgress(
	webContents: Electron.WebContents,
	payload: {
		status: "idle" | "downloading" | "downloaded" | "error";
		progress: number;
		path?: string | null;
		error?: string;
	},
) {
	if (!webContents.isDestroyed()) webContents.send("whisper-small-model-download-progress", payload);
}

export async function getWhisperSmallModelStatus() {
	try {
		await fs.access(WHISPER_SMALL_MODEL_PATH, fsConstants.R_OK);
		if ((await fs.stat(WHISPER_SMALL_MODEL_PATH)).size !== SMALL_MODEL_BYTES) throw new Error("Invalid model size.");
		return {
			success: true,
			exists: true,
			path: WHISPER_SMALL_MODEL_PATH,
		};
	} catch {
		return {
			success: true,
			exists: false,
			path: null,
		};
	}
}

async function downloadFileWithProgress(
	url: string,
	destinationPath: string,
	onProgress: (progress: number) => void,
	signal: AbortSignal,
): Promise<void> {
	const partial = await fs.lstat(destinationPath).catch(error => {
		if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
		return null;
	});
	if (partial && !partial.isFile()) throw new Error("Invalid Whisper model staging file.");
	const offset = partial && partial.size <= SMALL_MODEL_BYTES ? partial.size : 0;
	if (offset === SMALL_MODEL_BYTES) return;
	const request = (currentUrl: string, redirectCount = 0): Promise<void> => {
		return new Promise((resolve, reject) => {
			const req = httpsGet(currentUrl, {
				timeout: 30_000,
				signal,
				headers: offset > 0 ? { Range: `bytes=${offset}-` } : {},
			}, (response) => {
				const statusCode = response.statusCode ?? 0;
				const location = response.headers.location;

				if (statusCode >= 300 && statusCode < 400 && location) {
					response.resume();
					if (redirectCount >= 5) {
						reject(new Error("Too many redirects while downloading Whisper model."));
						return;
					}

					const nextUrl = new URL(location, currentUrl).toString();
					void request(nextUrl, redirectCount + 1)
						.then(resolve)
						.catch(reject);
					return;
				}

				const append = offset > 0 && statusCode === 206 &&
					response.headers["content-range"] === `bytes ${offset}-${SMALL_MODEL_BYTES - 1}/${SMALL_MODEL_BYTES}`;
				if (!append && statusCode !== 200) {
					response.resume();
					reject(new Error(`Whisper model download failed with status ${statusCode}.`));
					return;
				}

				let downloadedBytes = append ? offset : 0;
				let lastProgress = -1;
				const progress = new Transform({
					transform(chunk: Buffer, _encoding, callback) {
						downloadedBytes += chunk.byteLength;
						if (downloadedBytes > SMALL_MODEL_BYTES) {
							callback(new Error("Whisper model exceeds its expected size."));
							return;
						}
						const nextProgress = Math.min(99, Math.floor(downloadedBytes * 100 / SMALL_MODEL_BYTES));
						if (nextProgress !== lastProgress) {
							lastProgress = nextProgress;
							onProgress(nextProgress);
						}
						callback(null, chunk);
					},
				});
				void pipeline(response, progress, createWriteStream(destinationPath, { flags: append ? "a" : "w" }), { signal })
					.then(() => {
						if (downloadedBytes !== SMALL_MODEL_BYTES) throw new Error("Whisper model download is incomplete.");
						resolve();
					})
					.catch(reject);
			});

			req.on("error", reject);
			req.on("timeout", () => {
				req.destroy(new Error("Whisper model download timed out."));
			});
		});
	};

	return request(url);
}

async function verifyDownloadedModel(file: string, signal: AbortSignal) {
	if ((await fs.stat(file)).size !== SMALL_MODEL_BYTES) throw new Error("The Whisper model download has an unexpected size.");
	const hash = createHash("sha256");
	for await (const chunk of createReadStream(file, { signal })) hash.update(chunk);
	if (hash.digest("hex") !== SMALL_MODEL_SHA256) {
		await fs.rm(file, { force: true });
		throw new Error("The Whisper model failed checksum verification.");
	}
}

function broadcastDownloadProgress(payload: Parameters<typeof sendWhisperModelDownloadProgress>[1]) {
	for (const webContents of subscribers) sendWhisperModelDownloadProgress(webContents, payload);
}

async function downloadSmallModelFromAvailableSource(signal: AbortSignal): Promise<string> {
	await fs.mkdir(WHISPER_MODEL_DIR, { recursive: true });
	const tempPath = `${WHISPER_SMALL_MODEL_PATH}.download`;

	broadcastDownloadProgress({
		status: "downloading",
		progress: 0,
		path: null,
	});

	try {
		let failure: unknown;
		for (const url of MODEL_URLS) {
			signal.throwIfAborted();
			try {
				await downloadFileWithProgress(url, tempPath, (progress) => {
					broadcastDownloadProgress({ status: "downloading", progress: Math.min(99, progress), path: null });
				}, signal);
				await verifyDownloadedModel(tempPath, signal);
				failure = undefined;
				break;
			} catch (error) {
				failure = error;
			}
		}
		if (failure !== undefined) throw failure;
		signal.throwIfAborted();
		await fs.rename(tempPath, WHISPER_SMALL_MODEL_PATH);
		broadcastDownloadProgress({
			status: "downloaded",
			progress: 100,
			path: WHISPER_SMALL_MODEL_PATH,
		});
		return WHISPER_SMALL_MODEL_PATH;
	} catch (error) {
		broadcastDownloadProgress({
			status: signal.aborted ? "idle" : "error",
			progress: 0,
			path: null,
			error: String(error),
		});
		throw error;
	}
}

export function downloadWhisperSmallModel(webContents: Electron.WebContents): Promise<string> {
	subscribers.add(webContents);
	if (!currentDownload) {
		downloadController = new AbortController();
		currentDownload = downloadSmallModelFromAvailableSource(downloadController.signal).finally(() => {
			currentDownload = null;
			downloadController = null;
			subscribers.clear();
		});
	}
	return currentDownload;
}

export function cancelWhisperModelDownload() {
	downloadController?.abort();
}

export async function deleteWhisperSmallModel(): Promise<void> {
	await currentDownload?.catch(() => undefined);
	await fs.rm(WHISPER_SMALL_MODEL_PATH, { force: true });
}
