import { execFileSync } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import ffmpeg from "ffmpeg-static";
import { createBrowserRecordingStreamStore, recoverBrowserRecordingPartial } from "./browserStream";

const state = vi.hoisted(() => ({ directory: "" }));
vi.mock("../../logger", () => ({ appLog: vi.fn() }));
vi.mock("../../uiI18n", () => ({ uiText: (key: string) => key }));
vi.mock("../utils", () => ({ getRecordingsDir: async () => state.directory }));
vi.mock("../project/manager", () => ({ rememberApprovedLocalReadPath: vi.fn() }));
vi.mock("../project/session", () => ({ persistRecordingSessionManifest: vi.fn() }));
vi.mock("../state", () => ({ setCurrentRecordingSession: vi.fn() }));
vi.mock("../ffmpeg/binary", () => ({ getFfmpegBinaryPath: () => ffmpeg }));
vi.mock("./diagnostics", () => ({ validateRecordedVideo: async (file: string) => fs.stat(file) }));
vi.mock("./mac", () => ({ finalizeStoredVideo: async (file: string) => ({ success: true, path: file }) }));

beforeEach(async () => { state.directory = await fs.mkdtemp(path.join(os.tmpdir(), "leadcut-browser-capture-")); });
afterEach(() => fs.rm(state.directory, { recursive: true, force: true }));

function buffer(data: Uint8Array) {
	return Uint8Array.from(data).buffer;
}

it("appends two slices before finalization and publishes a decodable WebM with audio", async () => {
	const input = path.join(state.directory, "source.webm");
	execFileSync(ffmpeg!, ["-v", "error", "-f", "lavfi", "-i", "testsrc2=size=128x72:rate=10", "-f", "lavfi", "-i", "sine=frequency=500:sample_rate=48000",
		"-t", "1", "-c:v", "libvpx-vp9", "-threads", "1", "-c:a", "libopus", input], { windowsHide: true });
	const bytes = await fs.readFile(input);
	const middle = Math.floor(bytes.length / 2);
	const name = "recording-1.webm";
	const output = path.join(state.directory, name);
	const store = createBrowserRecordingStreamStore();
	await store.append(11, name, buffer(bytes.subarray(0, middle)), true);
	await store.append(11, name, buffer(bytes.subarray(middle)), false);
	expect(await fs.readFile(`${output}.partial`)).toEqual(bytes);
	await expect(fs.stat(output)).rejects.toMatchObject({ code: "ENOENT" });
	await expect(store.finish(11, name, false)).resolves.toEqual({ success: true, path: output });
	execFileSync(ffmpeg!, ["-v", "error", "-xerror", "-i", output, "-map", "0:v:0", "-map", "0:a:0", "-f", "null", "-"], { windowsHide: true });
	await expect(fs.stat(`${output}.partial`)).rejects.toMatchObject({ code: "ENOENT" });
});

it("preserves a failed remux for recovery and removes a deliberately discarded capture", async () => {
	const store = createBrowserRecordingStreamStore();
	const bytes = buffer(Buffer.from("invalid footage"));
	await store.append(1, "recording-2.webm", bytes, true);
	const unfinished = path.join(state.directory, "recording-2.webm.partial");
	await expect(store.finish(1, "recording-2.webm", false)).resolves.toMatchObject({ success: false, partialPath: unfinished });
	expect(await fs.readFile(unfinished, "utf8")).toBe("invalid footage");
	await store.append(1, "recording-3.webm", bytes, true);
	await expect(store.finish(1, "recording-3.webm", true)).resolves.toBeNull();
	await expect(fs.stat(path.join(state.directory, "recording-3.webm.partial"))).rejects.toMatchObject({ code: "ENOENT" });
});

it("remuxes and links the matching camera partial when recovering a browser recording", async () => {
	const source = path.resolve("tests/ui/fixtures/waveform.mp4");
	const pathFor = (name: string) => path.join(state.directory, name);
	const videoPath = pathFor("recording-4.mp4");
	const webcamPath = pathFor("recording-4-webcam.mp4");
	await Promise.all(
		[videoPath, webcamPath].map(file => fs.copyFile(source, `${file}.partial`)),
	);
	await expect(recoverBrowserRecordingPartial(`${videoPath}.partial`)).resolves.toMatchObject({
		success: true, path: videoPath, webcamPath,
	});
	expect(await fs.readdir(state.directory)).toEqual(["recording-4-webcam.mp4", "recording-4.mp4"]);
}, 10_000);
