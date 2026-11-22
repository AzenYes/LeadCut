import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createRecordingJournalStore, type RecordingJournal } from "./recoveryJournal";

vi.mock("../../appPaths", () => ({ USER_DATA_PATH: "unused-default" }));

let directory: string;
let store: ReturnType<typeof createRecordingJournalStore>;
let journal: RecordingJournal;

beforeEach(async () => {
	directory = await fs.mkdtemp(path.join(os.tmpdir(), "leadcut-recording-journal-"));
	store = createRecordingJournalStore(directory);
	journal = {
		version: 1,
		startedAt: 1000,
		tempVideoPath: path.join(directory, "capture.mp4"),
		finalVideoPath: path.join(directory, "recording.mp4"),
	};
});

afterEach(async () => {
	await fs.rm(directory, { recursive: true, force: true });
});

it("round trips recording recovery metadata and removes it on completion", async () => {
	await store.writeRecordingJournal(journal);
	await expect(store.readRecordingJournal()).resolves.toEqual(journal);
	await store.clearRecordingJournal(journal.startedAt);
	await expect(store.readRecordingJournal()).resolves.toBeNull();
});

it("only offers recovery when the saved recording still exists", async () => {
	await store.writeRecordingJournal(journal);
	await expect(store.findInterruptedRecording()).resolves.toBeNull();
	await fs.writeFile(journal.tempVideoPath, "capture");
	await expect(store.findInterruptedRecording()).resolves.toEqual(journal);
});

it("updates the matching recording and preserves it when an older session finishes", async () => {
	const cursorJournalPath = path.join(directory, "cursor.jsonl");
	await store.writeRecordingJournal(journal);
	await Promise.all([
		store.updateRecordingJournal(journal.startedAt, { cursorJournalPath }),
		store.clearRecordingJournal(journal.startedAt - 1),
	]);
	await expect(store.readRecordingJournal()).resolves.toEqual({ ...journal, cursorJournalPath });
});

it("offers a deferred capture again after a later recording finishes", async () => {
	await fs.writeFile(journal.tempVideoPath, "capture 1");
	await store.writeRecordingJournal(journal);
	const later = { ...journal, startedAt: 2000, tempVideoPath: path.join(directory, "later.mp4") };
	await fs.writeFile(later.tempVideoPath, "capture 2");
	await store.writeRecordingJournal(later);
	await expect(store.findInterruptedRecording()).resolves.toEqual(later);
	await store.clearRecordingJournal(later.startedAt);
	const cursorJournalPath = path.join(directory, "deferred-cursor.jsonl");
	await expect(
		store.updateRecordingJournal(journal.startedAt, { cursorJournalPath }),
	).resolves.toBe(true);
	await expect(store.findInterruptedRecording()).resolves.toEqual({
		...journal,
		cursorJournalPath,
	});
	await store.clearRecordingJournal(journal.startedAt);
	await expect(store.findInterruptedRecording()).resolves.toBeNull();
});
