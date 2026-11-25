import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { convertVideoToGif } from "./gif";

vi.mock("../ffmpeg/binary", () => ({
	getFfmpegBinaryPath: () => createRequire(import.meta.url)("ffmpeg-static"),
}));

describe("disk-backed GIF encoder", () => {
	let directory: string;

	beforeEach(async () => {
		directory = await fs.mkdtemp(path.join(os.tmpdir(), "leadcut-gif-test-"));
	});
	afterEach(async () => {
		await fs.rm(directory, { force: true, recursive: true });
	});

	it("encodes a GIF of the requested size and removes the palette", async () => {
		const outputPath = path.join(directory, "export.gif");
		await convertVideoToGif({
			videoPath: path.resolve("tests/ui/fixtures/waveform.mp4"),
			outputPath, width: 160, height: 90, fps: 10, loop: true,
		});
		const bytes = await fs.readFile(outputPath);
		expect(bytes.subarray(0, 6).toString("ascii")).toBe("GIF89a");
		expect(bytes.readUInt16LE(6)).toBe(160);
		expect(bytes.readUInt16LE(8)).toBe(90);
		expect(await fs.readdir(directory)).toEqual(["export.gif"]);
	});

	it("preserves a solid background held after a short multicolor segment", async () => {
		const ffmpeg = createRequire(import.meta.url)("ffmpeg-static") as string;
		const videoPath = path.join(directory, "background-tail.mp4");
		const outputPath = path.join(directory, "background-tail.gif");
		execFileSync(ffmpeg, [
			"-v", "error", "-f", "lavfi", "-i", "testsrc=size=320x180:rate=15:duration=1",
			"-f", "lavfi", "-i", "color=c=0x008800:s=320x180:r=15:d=8",
			"-filter_complex", "[0:v]format=yuv420p[first];[first][1:v]concat=n=2:v=1:a=0",
			"-c:v", "libx264", "-preset", "ultrafast", "-threads", "2", videoPath,
		], { windowsHide: true });
		await convertVideoToGif({ videoPath, outputPath, width: 320, height: 180, fps: 15, loop: false });
		const rgb = execFileSync(ffmpeg, [
			"-v", "error", "-ignore_loop", "1", "-ss", "8.5", "-i", outputPath, "-frames:v", "1",
			"-vf", "crop=2:2:160:90,scale=1:1", "-pix_fmt", "rgb24", "-f", "rawvideo", "-",
		], { windowsHide: true });
		expect(rgb).toHaveLength(3);
		expect(rgb[0]).toBeLessThan(20);
		expect(rgb[1]).toBeGreaterThan(115);
		expect(rgb[2]).toBeLessThan(20);
	});

	it.each([
		{ fps: 15, expectedDelays: [70, 60] },
		{ fps: 30, expectedDelays: [30, 40] },
	])("preserves the last frame delay at $fps FPS", async ({ fps, expectedDelays }) => {
		const require = createRequire(import.meta.url);
		const videoPath = path.join(directory, "two-frames.mp4");
		const outputPath = path.join(directory, "export.gif");
		execFileSync(require("ffmpeg-static"), [
			"-v", "error", "-f", "lavfi", "-i", `testsrc2=size=160x90:rate=${fps}`,
			"-frames:v", "2", "-c:v", "libx264", "-threads", "2", videoPath,
		], { windowsHide: true });
		await convertVideoToGif({
			videoPath, outputPath, width: 161, height: 91, fps, frameCount: 2, loop: false,
		});
		const { packets } = JSON.parse(execFileSync(require("ffprobe-static").path, [
			"-v", "error", "-show_packets", "-show_entries", "packet=duration_time", "-of", "json", outputPath,
		], { encoding: "utf8", windowsHide: true })) as { packets: { duration_time: string }[] };
		expect(packets.map(packet => Math.round(Number(packet.duration_time) * 1000))).toEqual(expectedDelays);
	});

	it("does not leave a palette or output when canceled before conversion", async () => {
		const controller = new AbortController();
		controller.abort();
		await expect(convertVideoToGif({
			videoPath: path.resolve("tests/ui/fixtures/waveform.mp4"),
			outputPath: path.join(directory, "canceled.gif"),
			width: 160, height: 90, fps: 10, loop: false, signal: controller.signal,
		})).rejects.toMatchObject({ name: "AbortError" });
		expect(await fs.readdir(directory)).toEqual([]);
	});
});
