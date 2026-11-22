import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, expect, it } from "vitest";
import { createWaveformDiskCache, waveformCacheKey } from "./cache";

let directory: string;
const key = (index: number) => index.toString(16).padStart(40, "0");
const entry = (index: number) => path.join(directory, `${key(index)}.leadcut-peaks`);

beforeEach(async () => {
	directory = await fs.mkdtemp(path.join(os.tmpdir(), "leadcut-waveform-cache-"));
});

afterEach(async () => {
	await fs.rm(directory, { recursive: true, force: true });
});

it("round trips the duration and Float32 peaks", async () => {
	const cache = createWaveformDiskCache(directory);
	const value = { durationMs: 30, peaks: new Float32Array([0.2, 0, 0.78]) };
	await cache.write(key(1), value);
	await expect(cache.read(key(1))).resolves.toEqual(value);
});

it("changes the cache key when file metadata or density changes", () => {
	const file = path.join(directory, "original.wav");
	const current = { size: 20_000, mtimeMs: 1000 };
	const original = waveformCacheKey(file, current, 100);
	expect(waveformCacheKey(file, { ...current, size: 20_001 }, 100)).not.toBe(original);
	expect(waveformCacheKey(file, { ...current, mtimeMs: 1001 }, 100)).not.toBe(original);
	expect(waveformCacheKey(file, current, 60)).not.toBe(original);
});

it("treats a truncated cache entry as a miss and removes it", async () => {
	const cache = createWaveformDiskCache(directory);
	await cache.write(key(1), { durationMs: 10, peaks: new Float32Array([0.6]) });
	const { size } = await fs.stat(entry(1));
	await fs.truncate(entry(1), size - 1);
	await expect(cache.read(key(1))).resolves.toBeNull();
	await expect(fs.stat(entry(1))).rejects.toMatchObject({ code: "ENOENT" });
});

it("keeps the recently read entry when pruning the oldest one", async () => {
	const cache = createWaveformDiskCache(directory, 180);
	const value = { durationMs: 100, peaks: new Float32Array(10).fill(0.2) };
	await cache.write(key(1), value);
	await cache.write(key(2), value);
	await fs.utimes(entry(1), new Date(1000), new Date(1000));
	await fs.utimes(entry(2), new Date(2000), new Date(2000));
	await cache.read(key(1));
	await cache.write(key(3), value);
	await expect(cache.read(key(2))).resolves.toBeNull();
	await expect(cache.read(key(1))).resolves.toEqual(value);
	await expect(cache.read(key(3))).resolves.toEqual(value);
});
