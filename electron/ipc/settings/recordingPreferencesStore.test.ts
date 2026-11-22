import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createRecordingPreferencesStore } from "./recordingPreferencesStore";

vi.mock("electron", () => ({
	app: {
		setName: vi.fn(),
		setPath: vi.fn(),
		getPath: () => "",
	},
}));

const temporaryDirectories: string[] = [];

afterEach(async () => {
	await Promise.all(
		temporaryDirectories.splice(0).map((directory) =>
			fs.rm(directory, {
				recursive: true,
				force: true,
			}),
		),
	);
});

describe("recording preferences store", () => {
	it("round trips microphone and webcam labels and clears the label for an explicit default", async () => {
		const directory = await fs.mkdtemp(path.join(os.tmpdir(), "leadcut-preferences-"));
		temporaryDirectories.push(directory);
		const file = path.join(directory, "recording.json");
		const store = createRecordingPreferencesStore(file);
		const preferences = {
			microphoneDeviceId: "preferred-mic",
			microphoneDeviceLabel: "Desk microphone",
			webcamDeviceId: "preferred-camera",
			webcamDeviceLabel: "Front camera",
		};
		await store.update(preferences);
		await expect(createRecordingPreferencesStore(file).read()).resolves.toMatchObject(preferences);
		await store.update({ webcamDeviceId: "default", webcamDeviceLabel: undefined });
		const saved = await createRecordingPreferencesStore(file).read();
		expect(saved.webcamDeviceId).toBe("default");
		expect(saved).not.toHaveProperty("webcamDeviceLabel");
	});

	it("stores the recording directory without replacing device preferences", async () => {
		const directory = await fs.mkdtemp(path.join(os.tmpdir(), "leadcut-preferences-"));
		temporaryDirectories.push(directory);
		const store = createRecordingPreferencesStore(path.join(directory, "recording.json"));
		const preferences = {
			microphoneDeviceId: "preferred-mic",
			webcamDeviceId: "preferred-camera",
			webcamEnabled: true,
			systemAudioEnabled: false,
		};
		await store.update(preferences);
		const recordingsDir = path.join(directory, "recordings");
		await store.update({ recordingsDir });
		await expect(store.read()).resolves.toEqual({ ...preferences, recordingsDir });
	});

	it("serializes directory and device updates together", async () => {
		const directory = await fs.mkdtemp(path.join(os.tmpdir(), "leadcut-preferences-"));
		temporaryDirectories.push(directory);
		const store = createRecordingPreferencesStore(path.join(directory, "recording.json"));
		const recordingsDir = path.join(directory, "recordings");
		await Promise.all([store.update({ recordingsDir }), store.update({ microphoneEnabled: true })]);
		await expect(store.read()).resolves.toMatchObject({ recordingsDir, microphoneEnabled: true });
	});

	it("preserves concurrent microphone and webcam preference updates", async () => {
		const directory = await fs.mkdtemp(path.join(os.tmpdir(), "recordly-preferences-"));
		temporaryDirectories.push(directory);
		const store = createRecordingPreferencesStore(path.join(directory, "recording.json"));

		await Promise.all([
			store.update({ microphoneEnabled: true }),
			store.update({ microphoneDeviceId: "preferred-mic" }),
			store.update({ webcamEnabled: true }),
			store.update({ webcamDeviceId: "preferred-camera" }),
		]);

		await expect(store.read()).resolves.toEqual({
			systemAudioEnabled: true,
			microphoneEnabled: true,
			microphoneDeviceId: "preferred-mic",
			webcamEnabled: true,
			webcamDeviceId: "preferred-camera",
		});
	});

	it("enables system audio for new and existing preferences without an explicit choice", async () => {
		const directory = await fs.mkdtemp(path.join(os.tmpdir(), "leadcut-preferences-"));
		temporaryDirectories.push(directory);
		const store = createRecordingPreferencesStore(path.join(directory, "recording.json"));
		await expect(store.read()).resolves.toMatchObject({ systemAudioEnabled: true });
		await store.update({ microphoneEnabled: true });
		await expect(store.read()).resolves.toMatchObject({ systemAudioEnabled: true });
	});

	it("preserves an explicit system audio choice across other preference updates", async () => {
		const directory = await fs.mkdtemp(path.join(os.tmpdir(), "leadcut-preferences-"));
		temporaryDirectories.push(directory);
		const store = createRecordingPreferencesStore(path.join(directory, "recording.json"));
		await store.update({ systemAudioEnabled: false });
		await store.update({ webcamEnabled: true });
		await expect(store.read()).resolves.toMatchObject({ systemAudioEnabled: false });
		await store.update({ systemAudioEnabled: true });
		await expect(store.read()).resolves.toMatchObject({ systemAudioEnabled: true });
	});
});
