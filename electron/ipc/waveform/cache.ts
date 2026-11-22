import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import type { WaveformPeaks } from "./peaks";

const CACHE_VERSION = 1;
const CACHE_EXTENSION = ".leadcut-peaks";
const MAX_CACHE_BYTES = 200 * 1024 * 1024;
const MAX_HEADER_BYTES = 1024;

export function waveformCacheKey(
	filePath: string,
	file: { size: number; mtimeMs: number },
	peaksPerSecond: number,
) {
	const identity = [
		path.resolve(filePath),
		file.size,
		file.mtimeMs,
		CACHE_VERSION,
		peaksPerSecond,
	];
	return createHash("sha1").update(JSON.stringify(identity)).digest("hex");
}

function decodePeaks(buffer: Buffer): WaveformPeaks {
	const separator = buffer.indexOf(10);
	if (separator <= 0 || separator > MAX_HEADER_BYTES)
		throw new Error("Invalid waveform cache header");
	const header = JSON.parse(buffer.toString("utf8", 0, separator)) as {
		version?: number;
		durationMs?: number;
		count?: number;
	} | null;
	const offset = separator + 1;
	if (
		header?.version !== CACHE_VERSION ||
		typeof header.durationMs !== "number" ||
		!Number.isFinite(header.durationMs) ||
		header.durationMs <= 0 ||
		typeof header.count !== "number" ||
		!Number.isSafeInteger(header.count) ||
		header.count <= 0 ||
		offset + header.count * Float32Array.BYTES_PER_ELEMENT !== buffer.length
	) {
		throw new Error("Invalid waveform cache data");
	}
	const peaks = new Float32Array(header.count);
	for (let index = 0; index < peaks.length; index++) {
		peaks[index] = buffer.readFloatLE(offset + index * Float32Array.BYTES_PER_ELEMENT);
		if (!Number.isFinite(peaks[index]) || peaks[index] < 0 || peaks[index] > 1) {
			throw new Error("Invalid waveform cache peak");
		}
	}
	return { durationMs: header.durationMs, peaks };
}

export function createWaveformDiskCache(directory: string, limitBytes = MAX_CACHE_BYTES) {
	const fileFor = (key: string) => path.join(directory, key + CACHE_EXTENSION);
	let pendingWrite = Promise.resolve();

	const prune = async () => {
		const names = (await fs.readdir(directory)).filter((name) =>
			/^[a-f0-9]{40}\.leadcut-peaks$/.test(name),
		);
		const entries = await Promise.all(
			names.map(async (name) => {
				const file = path.join(directory, name);
				const stat = await fs.stat(file).catch(() => null);
				return stat?.isFile() ? [{ file, stat }] : [];
			}),
		);
		const oldestFirst = entries
			.flat()
			.sort((left, right) => left.stat.mtimeMs - right.stat.mtimeMs);
		let size = oldestFirst.reduce((total, entry) => total + entry.stat.size, 0);
		for (const entry of oldestFirst) {
			if (size <= limitBytes) break;
			await fs.rm(entry.file, { force: true });
			size -= entry.stat.size;
		}
	};

	return {
		async read(key: string) {
			const file = fileFor(key);
			try {
				const stat = await fs.stat(file);
				if (stat.size > limitBytes) throw new Error("Waveform cache entry is oversized");
				const peaks = decodePeaks(await fs.readFile(file));
				const now = new Date();
				await fs.utimes(file, now, now).catch(() => undefined);
				return peaks;
			} catch (error) {
				if ((error as NodeJS.ErrnoException).code !== "ENOENT")
					await fs.rm(file, { force: true }).catch(() => undefined);
				return null;
			}
		},
		write(key: string, waveform: WaveformPeaks) {
			const current = pendingWrite
				.catch(() => undefined)
				.then(async () => {
					const { peaks, durationMs } = waveform;
					const header = Buffer.from(
						JSON.stringify({
							version: CACHE_VERSION,
							durationMs,
							count: peaks.length,
						}) + "\n",
					);
					const size = header.length + peaks.byteLength;
					if (size > limitBytes) return;
					await fs.mkdir(directory, { recursive: true });
					const data = Buffer.allocUnsafe(size);
					header.copy(data);
					for (let index = 0; index < peaks.length; index++) {
						data.writeFloatLE(
							peaks[index],
							header.length + index * Float32Array.BYTES_PER_ELEMENT,
						);
					}
					const temporary = path.join(directory, `.leadcut-peaks-${randomUUID()}.tmp`);
					try {
						await fs.writeFile(temporary, data, { flag: "wx" });
						await fs.rename(temporary, fileFor(key));
					} finally {
						await fs.rm(temporary, { force: true }).catch(() => undefined);
					}
					await prune();
				});
			pendingWrite = current;
			return current;
		},
	};
}
