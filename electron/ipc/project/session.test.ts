import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { persistRecordingSessionManifest, resolveRecordingSessionManifest } from "./session";

vi.mock("../utils", () => ({
	normalizeVideoSourcePath: (file?: string | null) => file ? path.resolve(file) : null,
	parseJsonWithByteOrderMark: JSON.parse,
}));

let directory: string;
let video: string;
let legacy: string;
let modern: string;

beforeEach(async () => {
	directory = await fs.mkdtemp(path.join(os.tmpdir(), "leadcut-session-"));
	video = path.join(directory, "录屏.mp4");
	legacy = path.join(directory, "录屏.recordly-session.json");
	modern = path.join(directory, "录屏.leadcut-session.json");
});

afterEach(async () => {
	await fs.rm(directory, { recursive: true, force: true });
});

async function makeSession(manifest: string, webcamFileName: string, timeOffsetMs: number) {
	const webcam = path.join(directory, webcamFileName);
	await fs.writeFile(webcam, "video");
	await fs.writeFile(manifest, JSON.stringify({ version: 2, webcamFileName, timeOffsetMs }));
	return webcam;
}

it("loads a legacy-only session and prefers the current manifest when both exist", async () => {
	const legacyWebcam = await makeSession(legacy, "原摄像头.mp4", 970);
	expect(await resolveRecordingSessionManifest(video)).toEqual({ videoPath: video, webcamPath: legacyWebcam, timeOffsetMs: 970 });
	const modernWebcam = await makeSession(modern, "新摄像头.mp4", 120);
	expect(await resolveRecordingSessionManifest(video)).toEqual({ videoPath: video, webcamPath: modernWebcam, timeOffsetMs: 120 });
});

it("writes the current suffix and removes both manifests when webcam is cleared", async () => {
	const webcamPath = path.join(directory, "摄像头.mp4");
	await fs.writeFile(webcamPath, "video");
	await persistRecordingSessionManifest({ videoPath: video, webcamPath, timeOffsetMs: 300 });
	await expect(fs.stat(modern)).resolves.toBeDefined();
	await expect(fs.stat(legacy)).rejects.toMatchObject({ code: "ENOENT" });
	await makeSession(legacy, "原摄像头.mp4", 150);
	await persistRecordingSessionManifest({ videoPath: video, webcamPath: null });
	await expect(fs.stat(modern)).rejects.toMatchObject({ code: "ENOENT" });
	await expect(fs.stat(legacy)).rejects.toMatchObject({ code: "ENOENT" });
	expect(await resolveRecordingSessionManifest(video)).toBeNull();
});
