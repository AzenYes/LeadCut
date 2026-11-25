import { handleTrustedIpc } from "../../trustedIpc";
import fs from "node:fs/promises";
import path from "node:path";

import { USER_DATA_PATH } from "../../appPaths";
import { isAllowedLocalReadPath } from "../project/manager";
import { createWaveformDiskCache, waveformCacheKey } from "../waveform/cache";
import {
	WAVEFORM_PEAKS_PER_SECOND,
	type WaveformPeaks,
	type WaveformPeaksResponse,
	generateWaveformPeaks,
} from "../waveform/peaks";

const MAX_PARALLEL_DECODERS = 2;
const cache = createWaveformDiskCache(path.join(USER_DATA_PATH, "waveform-cache"));
let activeDecoders = 0;
const waiting: Array<() => void> = [];

type WaveformJob = {
	reporters: Set<(ratio: number) => void>;
	ratio: number;
	result: Promise<WaveformPeaks | null>;
};
const inFlight = new Map<string, WaveformJob>();

async function generateWithSlot(filePath: string, onProgress: (ratio: number) => void) {
	if (activeDecoders < MAX_PARALLEL_DECODERS) activeDecoders++;
	else await new Promise<void>((resume) => waiting.push(resume));
	try {
		return await generateWaveformPeaks(filePath, onProgress);
	} finally {
		const resume = waiting.shift();
		if (resume) resume();
		else activeDecoders--;
	}
}

async function loadWaveform(key: string, filePath: string, report: (ratio: number) => void) {
	const known = inFlight.get(key);
	if (known) {
		known.reporters.add(report);
		report(known.ratio);
		return known.result;
	}

	const reporters = new Set([report]);
	let ratio = 0;
	const result = (async () => {
		const cached = await cache.read(key);
		if (cached) {
			for (const reporter of reporters) reporter(1);
			return cached;
		}
		const waveform = await generateWithSlot(filePath, (progress) => {
			ratio = progress;
			for (const reporter of reporters) reporter(progress);
		});
		if (waveform) {
			await cache
				.write(key, waveform)
				.catch((error) => console.warn("Could not save waveform cache:", error));
		}
		return waveform;
	})().finally(() => inFlight.delete(key));
	inFlight.set(key, {
		reporters,
		get ratio() {
			return ratio;
		},
		result,
	});
	return result;
}

export function registerWaveformHandlers() {
	handleTrustedIpc(
		"generate-waveform-peaks",
		async (event, filePath: string, requestId: number): Promise<WaveformPeaksResponse> => {
			if (
				typeof filePath !== "string" ||
				!path.isAbsolute(filePath) ||
				!Number.isSafeInteger(requestId) ||
				!isAllowedLocalReadPath(filePath)
			) {
				return {
					success: false,
					unavailable: true,
					error: "Waveform media path is not available",
				};
			}
			try {
				const stat = await fs.stat(filePath);
				if (!stat.isFile())
					return { success: false, error: "Waveform media is not a file" };
				const key = waveformCacheKey(filePath, stat, WAVEFORM_PEAKS_PER_SECOND);
				const result = await loadWaveform(key, filePath, (ratio) => {
					if (event.sender.isDestroyed()) return;
					try {
						event.sender.send("waveform-peaks-progress", { requestId, ratio });
					} catch {
						// A window can close after a request joins a shared decode.
					}
				});
				return result ? { success: true, ...result } : { success: true, noAudio: true };
			} catch (error) {
				if ((error as NodeJS.ErrnoException).code === "ENOENT")
					return { success: true, noAudio: true };
				console.warn("Could not generate waveform:", error);
				return { success: false, error: String(error) };
			}
		},
	);
}
