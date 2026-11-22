import { beforeEach, describe, expect, it, vi } from "vitest";
import { CURSOR_TELEMETRY_VERSION } from "../constants";

const { appendFile, writeFile, rm } = vi.hoisted(() => ({
	appendFile: vi.fn(),
	writeFile: vi.fn(),
	rm: vi.fn(),
}));

vi.mock("node:fs/promises", () => ({
	default: {
		appendFile,
		writeFile,
		rm,
	},
}));

vi.mock("electron", () => ({
	app: {
		setName: vi.fn(),
		setPath: vi.fn(),
		getPath: vi.fn(() => "/tmp"),
	},
}));

vi.mock("../utils", () => ({
	getTelemetryPathForVideo: vi.fn(() => "/tmp/recording.cursor.json"),
	getScreen: vi.fn(() => ({
		getCursorScreenPoint: () => ({ x: 0, y: 0 }),
		getPrimaryDisplay: () => ({ scaleFactor: 1 }),
		getDisplayNearestPoint: () => ({ bounds: { x: 0, y: 0, width: 1, height: 1 } }),
		getAllDisplays: () => [],
	})),
}));

import { activeCursorSamples, setActiveCursorSamples, setCursorCaptureStartTimeMs } from "../state";
import {
	getCursorCaptureElapsedMs,
	normalizeCursorTelemetrySamples,
	pauseCursorCapture,
	pauseCursorCaptureAtBoundary,
	persistPendingCursorTelemetry,
	pushCursorSample,
	resetCursorCaptureClock,
	resumeCursorCapture,
	snapshotCursorTelemetryForPersistence,
	startCursorSampling,
	stopCursorCapture,
	writeCursorTelemetry,
} from "./telemetry";

describe("cursor telemetry pause clock", () => {
	beforeEach(() => {
		appendFile.mockReset();
		writeFile.mockReset();
		rm.mockReset();
		setCursorCaptureStartTimeMs(1_000);
		setActiveCursorSamples([]);
		resetCursorCaptureClock();
	});

	it("subtracts paused time from elapsed cursor timestamps", () => {
		expect(getCursorCaptureElapsedMs(1_120)).toBe(120);

		pauseCursorCapture(1_200);
		expect(getCursorCaptureElapsedMs(1_450)).toBe(200);

		resumeCursorCapture(1_700);
		expect(getCursorCaptureElapsedMs(1_900)).toBe(400);
	});

	it("retains the first click after the former hour-long recording limit", () => {
		pushCursorSample(0.1, 0.2, 0, "click");
		for (let index = 1; index <= 108_000; index++) {
			pushCursorSample(0.3, 0.4, index * 34);
		}
		expect(activeCursorSamples).toHaveLength(108_001);
		expect(activeCursorSamples[0]).toMatchObject({ timeMs: 0, interactionType: "click" });
	});

	it("reads both ends of a 200,000-sample cursor sidecar", () => {
		const samples = Array.from({ length: 200_000 }, (_, index) => ({ timeMs: index * 33, cx: 0.5, cy: 0.5 }));
		const normalized = normalizeCursorTelemetrySamples({ samples });
		expect(normalized).toHaveLength(200_000);
		expect(normalized[0].timeMs).toBe(0);
		expect(normalized.at(-1)?.timeMs).toBe(199_999 * 33);
	});

	it("ignores duplicate pause or resume transitions", () => {
		pauseCursorCapture(1_150);
		pauseCursorCapture(1_250);
		resumeCursorCapture(1_500);
		resumeCursorCapture(1_650);

		expect(getCursorCaptureElapsedMs(1_900)).toBe(550);
	});

	it("drops cursor samples captured after the renderer pause boundary", () => {
		pushCursorSample(0.1, 0.1, 120, "move");
		pushCursorSample(0.2, 0.2, 205, "move");
		pushCursorSample(0.3, 0.3, 260, "move");

		pauseCursorCaptureAtBoundary(1_200);

		expect(getCursorCaptureElapsedMs(1_500)).toBe(200);
		expect(activeCursorSamples.map((sample) => sample.timeMs)).toEqual([120]);

		resumeCursorCapture(1_700);
		expect(getCursorCaptureElapsedMs(1_900)).toBe(400);
	});

	it("normalizes cursor telemetry samples before persisting them", async () => {
		const samples = normalizeCursorTelemetrySamples([
			{ timeMs: 30, cx: 2, cy: -1, interactionType: "click", cursorType: "pointer" },
			{ timeMs: -10, cx: Number.NaN, cy: 0.2, interactionType: "drag", cursorType: "ibeam" },
			{ timeMs: 10, cx: 0.25, cy: 0.75, interactionType: "move", cursorType: "text" },
		]);

		expect(samples).toEqual([
			{ timeMs: 0, cx: 0.5, cy: 0.2, interactionType: undefined, cursorType: undefined },
			{ timeMs: 10, cx: 0.25, cy: 0.75, interactionType: "move", cursorType: "text" },
			{ timeMs: 30, cx: 1, cy: 0, interactionType: "click", cursorType: "pointer" },
		]);

		await writeCursorTelemetry("/tmp/recording.mp4", samples);

		expect(writeFile).toHaveBeenCalledWith(
			"/tmp/recording.cursor.json",
			JSON.stringify(
				{
					version: CURSOR_TELEMETRY_VERSION,
					samples,
				},
				null,
				2,
			),
			"utf-8",
		);
		expect(rm).not.toHaveBeenCalled();
	});

	it("removes the sidecar when saving an empty cursor telemetry payload", async () => {
		await writeCursorTelemetry("/tmp/recording.mp4", []);

		expect(rm).toHaveBeenCalledWith("/tmp/recording.cursor.json", { force: true });
		expect(writeFile).not.toHaveBeenCalled();
	});

	it("writes long cursor sidecars as compact JSON with the same version and samples", async () => {
		const samples = Array.from({ length: 50_001 }, (_, timeMs) => ({ timeMs, cx: 0.5, cy: 0.5 }));
		await writeCursorTelemetry("/tmp/recording.mp4", samples);
		expect(writeFile).toHaveBeenCalledWith(
			"/tmp/recording.cursor.json",
			JSON.stringify({ version: CURSOR_TELEMETRY_VERSION, samples }),
			"utf-8",
		);
	});

	it("checkpoints during capture and removes the journal after writing the final sidecar", async () => {
		vi.useFakeTimers();
		vi.setSystemTime(1_000);
		const journalPath = startCursorSampling();
		try {
			pushCursorSample(0.1, 0.2, 100, "click");
			pushCursorSample(0.2, 0.3, 4_000, "move");
			await vi.advanceTimersByTimeAsync(5_000);
			expect(appendFile).toHaveBeenCalledWith(
				journalPath,
				`${JSON.stringify(activeCursorSamples[0])}\n`,
				"utf8",
			);
			stopCursorCapture();
			snapshotCursorTelemetryForPersistence();
			await persistPendingCursorTelemetry("/tmp/recording.mp4");
			expect(JSON.parse(writeFile.mock.calls[0][1]).samples).toHaveLength(2);
			expect(rm).toHaveBeenCalledWith(journalPath, { force: true });
		} finally {
			stopCursorCapture();
			vi.useRealTimers();
		}
	});
});
