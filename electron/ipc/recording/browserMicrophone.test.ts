import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { expect, it, vi } from "vitest";
import { convertBrowserMicrophone, createBrowserMicrophoneStreams, getBrowserMicrophonePartial } from "./browserMicrophone";

const getFfmpeg = () => createRequire(import.meta.url)("ffmpeg-static");
vi.mock("../ffmpeg/binary", () => ({ getFfmpegBinaryPath: () => getFfmpeg() }));

it("recovers a playable microphone WAV from ordered chunks after the renderer closes", async () => {
	const directory = await fs.mkdtemp(path.join(os.tmpdir(), "leadcut-mic-test-"));
	try {
		const source = path.join(directory, "source.webm");
		await promisify(execFile)(getFfmpeg(), [
			"-v", "error", "-f", "lavfi", "-i", "sine=frequency=440:duration=0.8",
			"-c:a", "libopus", source,
		], { windowsHide: true });
		const bytes = await fs.readFile(source);
		const midpoint = Math.floor(bytes.length / 2);
		const videoPath = path.join(directory, "recording-1.mp4");
		const partial = getBrowserMicrophonePartial(videoPath);
		const streams = createBrowserMicrophoneStreams();
		const id = streams.create(1, videoPath, 17);
		expect(() => streams.append(2, id, Uint8Array.of(1).buffer)).toThrow();
		expect(streams.hasRecording(17)).toBe(true);
		await Promise.all([
			streams.append(1, id, Uint8Array.from(bytes.subarray(0, midpoint)).buffer),
			streams.append(1, id, Uint8Array.from(bytes.subarray(midpoint)).buffer),
		]);
		streams.releaseOwner(1);
		expect(() => streams.append(1, id, Uint8Array.of(1).buffer)).toThrow();
		expect(await fs.readFile(partial)).toEqual(bytes);
		const wav = path.join(directory, "recording-1.mic.wav");
		await convertBrowserMicrophone(partial, wav);
		const restored = await fs.readFile(wav);
		expect(restored.subarray(0, 4).toString("ascii")).toBe("RIFF");
		expect(restored.length).toBeGreaterThan(70_000);
	} finally {
		await fs.rm(directory, { recursive: true, force: true });
	}
}, 10_000);
