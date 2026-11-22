import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { pauseCursorCapture, resetCursorCaptureClock, resumeCursorCapture } from "../cursor/telemetry";
import { setCursorCaptureStartTimeMs, setIsCursorCaptureActive } from "../state";
import { addRecordingMarker, persistRecordingMarkers, readRecordingMarkers, resetRecordingMarkers } from "./markers";

vi.mock("electron", () => ({ app: { setName: vi.fn(), setPath: vi.fn(), getPath: () => os.tmpdir() } }));

let directory: string;
beforeEach(async () => {
	directory = await fs.mkdtemp(path.join(os.tmpdir(), "leadcut-markers-"));
	vi.useFakeTimers({ toFake: ["Date"] });
	setIsCursorCaptureActive(false);
	setCursorCaptureStartTimeMs(1000);
	resetCursorCaptureClock();
	resetRecordingMarkers();
});

afterEach(async () => {
	vi.useRealTimers();
	await fs.rm(directory, { recursive: true, force: true });
});

it("ignores inactive and paused shortcuts and uses recording time after resuming", async () => {
	vi.setSystemTime(1200);
	expect(addRecordingMarker("cut")).toEqual({ success: false });
	setIsCursorCaptureActive(true);
	expect(addRecordingMarker("cut")).toMatchObject({ success: true, timeMs: 200, count: 1 });
	pauseCursorCapture(1300);
	vi.setSystemTime(1600);
	expect(addRecordingMarker("highlight")).toEqual({ success: false });
	resumeCursorCapture(1700);
	vi.setSystemTime(2100);
	expect(addRecordingMarker("highlight")).toMatchObject({ success: true, timeMs: 700, count: 2 });

	const video = path.join(directory, "recording-test.mp4");
	await persistRecordingMarkers(video);
	const sidecar = `${video}.leadcut-markers.json`;
	const markers = await readRecordingMarkers(video);
	expect(markers).toMatchObject([{ timeMs: 200, kind: "cut" }, { timeMs: 700, kind: "highlight" }]);
	expect(markers[0].id).not.toBe(markers[1].id);
	expect(JSON.parse(await fs.readFile(sidecar, "utf8"))).toEqual({ version: 1, markers });
});

it("leaves no sidecar for an empty recording", async () => {
	const video = path.join(directory, "recording-empty.webm");
	await persistRecordingMarkers(video);
	expect(await fs.readdir(directory)).toEqual([]);
	expect(await readRecordingMarkers(video)).toEqual([]);
});
