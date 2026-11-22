import fs from "node:fs/promises";
import { RECORDINGS_SETTINGS_FILE } from "../constants";
import { parseJsonWithByteOrderMark } from "../utils";

export interface RecordingPreferencesPatch {
	recordingsDir?: string;
	microphoneEnabled?: boolean;
	microphoneDeviceId?: string;
	microphoneDeviceLabel?: string;
	systemAudioEnabled?: boolean;
	webcamEnabled?: boolean;
	webcamDeviceId?: string;
	webcamDeviceLabel?: string;
}

export const recordingPreferencesStore = createRecordingPreferencesStore(RECORDINGS_SETTINGS_FILE);

export function createRecordingPreferencesStore(filePath: string) {
	let operationQueue: Promise<void> = Promise.resolve();

	const readFile = async (): Promise<Record<string, unknown>> => {
		try {
			const content = await fs.readFile(filePath, "utf-8");
			const parsed = parseJsonWithByteOrderMark<unknown>(content);
			return parsed && typeof parsed === "object" && !Array.isArray(parsed)
				? (parsed as Record<string, unknown>)
				: {};
		} catch {
			return {};
		}
	};

	return {
		async read(): Promise<Record<string, unknown>> {
			await operationQueue;
			return { systemAudioEnabled: true, ...(await readFile()) };
		},
		async update(patch: RecordingPreferencesPatch): Promise<void> {
			const operation = operationQueue.then(async () => {
				const existing = await readFile();
				await fs.writeFile(
					filePath,
					JSON.stringify({ ...existing, ...patch }, null, 2),
					"utf-8",
				);
			});
			operationQueue = operation.catch(() => undefined);
			await operation;
		},
	};
}
