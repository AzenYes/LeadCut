import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { isFragmentedMp4, prepareSeekableMedia } from "./seekableMedia";

const harness = vi.hoisted(() => ({ root: "", calls: 0 }));
vi.mock("electron", () => ({ app: { getPath: () => harness.root } }));
vi.mock("../ffmpeg/binary", () => ({ getFfmpegBinaryPath: () => "ffmpeg" }));
vi.mock("node:child_process", () => ({ execFile: (_binary: string, args: string[], _options: unknown, callback: (error: Error | null, stdout?: string, stderr?: string) => void) => {
	harness.calls++;
	void import("node:fs/promises").then(fs => fs.writeFile(args.at(-1)!, "indexed-media")).then(() => callback(null, "", ""), callback);
} }));
const box = (type: string, payload = Buffer.alloc(0)) => {
	const header = Buffer.alloc(8); header.writeUInt32BE(8 + payload.length); header.write(type, 4); return Buffer.concat([header, payload]);
};
beforeEach(async () => { harness.root = await fs.mkdtemp(path.join(os.tmpdir(), "leadcut-seekable-")); harness.calls = 0; });
afterEach(async () => { await fs.rm(harness.root, { recursive: true, force: true }); });

it("identifies MediaRecorder fragments without reading the media payload and rejects malformed boxes", async () => {
	const file = path.join(harness.root, "camera.mp4");
	await fs.writeFile(file, Buffer.concat([box("ftyp"), box("moov"), box("moof"), box("mdat")]));
	expect(await isFragmentedMp4(file)).toBe(true);
	await fs.writeFile(file, Buffer.concat([box("ftyp"), box("moov"), box("mdat")]));
	expect(await isFragmentedMp4(file)).toBe(false);
	await fs.writeFile(file, Buffer.alloc(16));
	expect(await isFragmentedMp4(file)).toBe(false);
});

it("shares concurrent remuxes, reuses the indexed copy, and invalidates it when source changes", async () => {
	const file = path.join(harness.root, "camera.mp4");
	const original = Buffer.concat([box("ftyp"), box("moov"), box("moof"), box("mdat")]);
	await fs.writeFile(file, original);
	const [first, second] = await Promise.all([prepareSeekableMedia(file), prepareSeekableMedia(file)]);
	expect(first).toBe(second);
	expect(first).not.toBe(file);
	expect(harness.calls).toBe(1);
	expect(await prepareSeekableMedia(file)).toBe(first);
	expect(harness.calls).toBe(1);
	expect(await fs.readFile(file)).toEqual(original);
	await fs.appendFile(file, "changed");
	expect(await prepareSeekableMedia(file)).not.toBe(first);
	expect(harness.calls).toBe(2);
});

it("keeps ordinary indexed MP4 and audio on their original paths", async () => {
	for (const name of ["normal.mp4", "sound.wav"]) {
		const file = path.join(harness.root, name);
		await fs.writeFile(file, Buffer.concat([box("ftyp"), box("moov"), box("mdat")]));
		expect(await prepareSeekableMedia(file)).toBe(file);
	}
	expect(harness.calls).toBe(0);
});

it("publishes a stopped native capture at its original path", async () => {
	const file = path.join(harness.root, "recording.mp4");
	await fs.writeFile(file, Buffer.concat([box("ftyp"), box("moov"), box("moof"), box("mdat")]));
	const results = await Promise.all([
		prepareSeekableMedia(file, { replaceOriginal: true }),
		prepareSeekableMedia(file, { replaceOriginal: true }),
	]);
	expect(results).toEqual([file, file]);
	expect(harness.calls).toBe(1);
	expect(await fs.readFile(file, "utf8")).toBe("indexed-media");
	expect(await fs.readdir(harness.root)).toEqual(["recording.mp4"]);
});
