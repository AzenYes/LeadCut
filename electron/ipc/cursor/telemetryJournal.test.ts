import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, expect, it } from "vitest";
import type { CursorTelemetryPoint } from "../types";
import { rebuildCursorTelemetryFromJournal, startCursorJournal } from "./telemetryJournal";

let directory: string;
let journal: ReturnType<typeof startCursorJournal>;
let elapsed: number;
let samples: CursorTelemetryPoint[];

beforeEach(async () => {
	directory = await fs.mkdtemp(path.join(os.tmpdir(), "leadcut-cursor-journal-"));
	elapsed = 5000;
	samples = [{ timeMs: 500, cx: 0.2, cy: 0.3, interactionType: "click", cursorType: "pointer" }];
	journal = startCursorJournal({
		directory,
		startTs: 12345,
		getSamples: () => samples,
		getElapsedMs: () => elapsed,
	});
});

afterEach(async () => {
	await journal.stop({ keepFile: false });
	await fs.rm(directory, { recursive: true, force: true });
});

it("recovers complete samples after an interrupted final line", async () => {
	await journal.flush();
	await journal.stop({ keepFile: true });
	await fs.appendFile(journal.journalPath, '{"timeMs":');
	await expect(rebuildCursorTelemetryFromJournal(journal.journalPath)).resolves.toEqual(samples);
});

it("appends only new stable samples and orders overlapping flushes", async () => {
	await journal.flush();
	samples.push({ timeMs: 2500, cx: 0.4, cy: 0.1 });
	await Promise.all([journal.flush(), journal.flush()]);
	await expect(rebuildCursorTelemetryFromJournal(journal.journalPath)).resolves.toEqual(samples);
});

it("leaves the two seconds around a pause boundary unwritten until they stabilize", async () => {
	samples.push({ timeMs: 4000, cx: 0.5, cy: 0.5 });
	await journal.flush();
	await expect(rebuildCursorTelemetryFromJournal(journal.journalPath)).resolves.toEqual([
		samples[0],
	]);
	elapsed = 6000;
	await journal.flush();
	await expect(rebuildCursorTelemetryFromJournal(journal.journalPath)).resolves.toEqual(samples);
	await journal.stop({ keepFile: false });
	await expect(rebuildCursorTelemetryFromJournal(journal.journalPath)).resolves.toEqual([]);
});
