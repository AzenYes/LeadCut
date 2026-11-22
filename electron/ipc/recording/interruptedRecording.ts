import fs from "node:fs/promises";
import path from "node:path";
import { app } from "electron";
import { USER_DATA_PATH } from "../../appPaths";
import { getKeysPathForVideo } from "../../../services/leadcut-mcp/src/keystrokeSidecar";
import { rebuildKeystrokesFromJournal, writeKeystrokes } from "../cursor/keystrokes";
import { writeCursorTelemetry } from "../cursor/telemetry";
import { rebuildCursorTelemetryFromJournal } from "../cursor/telemetryJournal";
import { rememberApprovedLocalReadPath } from "../project/manager";
import { prepareSeekableMedia } from "../project/seekableMedia";
import { getTelemetryPathForVideo } from "../utils";
import {
	windowsCaptureProcess,
	windowsCaptureStopRequested,
	windowsNativeCaptureActive,
} from "../state";
import { validateRecordedVideo } from "./diagnostics";
import { finalizeStoredVideo } from "./mac";
import {
	type RecordingJournal,
	clearRecordingJournal,
	findInterruptedRecording,
	updateRecordingJournal,
} from "./recoveryJournal";
import { repairCapturedWavFile } from "./wavHeaderRepair";
import { findCaptureFile, stageWindowsCaptureOutputs } from "./windowsCaptureOutputs";

let recoveryOperation: Promise<unknown> = Promise.resolve();

function enqueueRecovery<T>(operation: () => Promise<T>): Promise<T> {
	const next = recoveryOperation.catch(() => undefined).then(operation);
	recoveryOperation = next;
	return next;
}

function validateCapturePaths(recording: RecordingJournal) {
	const {
		startedAt,
		tempVideoPath,
		finalVideoPath,
		tempMicAudioPath,
		tempSystemAudioPath,
		cursorJournalPath,
		keyJournalPath,
	} = recording;
	const temporaryDirectory = app.getPath("temp");
	const allowedTemporaryStems = ["recordly-native", "leadcut-native"].map((prefix) =>
		path.join(temporaryDirectory, `${prefix}-${startedAt}`),
	);
	const validTemporary = (file: string, extension: string) =>
		allowedTemporaryStems.some((stem) => file === `${stem}.${extension}`);
	if (
		path.basename(finalVideoPath) !== `recording-${startedAt}.mp4` ||
		(tempVideoPath !== finalVideoPath && !validTemporary(tempVideoPath, "mp4")) ||
		(tempMicAudioPath && !validTemporary(tempMicAudioPath, "mic.wav")) ||
		(tempSystemAudioPath && !validTemporary(tempSystemAudioPath, "system.wav")) ||
		(cursorJournalPath &&
			(path.dirname(cursorJournalPath) !== USER_DATA_PATH ||
				!/^leadcut-cursor-journal-\d+\.jsonl$/.test(path.basename(cursorJournalPath)))) ||
		(keyJournalPath && (path.dirname(keyJournalPath) !== USER_DATA_PATH ||
			!/^leadcut-keys-journal-\d+\.jsonl$/.test(path.basename(keyJournalPath))))
	) {
		throw new Error("Invalid paths for the interrupted Windows recording");
	}
}

async function getRecoverableRecording() {
	if (windowsCaptureProcess || windowsNativeCaptureActive || windowsCaptureStopRequested)
		return null;
	return findInterruptedRecording();
}

export async function getInterruptedRecording() {
	const recording = await getRecoverableRecording();
	return recording
		? { startedAt: recording.startedAt, videoPath: recording.tempVideoPath }
		: null;
}

function getAudioPaths(recording: RecordingJournal) {
	const stem = recording.finalVideoPath.slice(0, -".mp4".length);
	return [
		{ temporary: recording.tempSystemAudioPath, final: `${stem}.system.wav` },
		{ temporary: recording.tempMicAudioPath, final: `${stem}.mic.wav` },
	];
}

export function recoverInterruptedRecording(startedAt?: number) {
	return enqueueRecovery(async () => {
		const recording = await getRecoverableRecording();
		if (!recording || (startedAt !== undefined && recording.startedAt !== startedAt)) {
			return { success: false as const };
		}
		let videoPath = recording.tempVideoPath;
		try {
			validateCapturePaths(recording);
			if (!(await findCaptureFile(videoPath)))
				throw new Error("The interrupted video file is unavailable");
			await validateRecordedVideo(videoPath);
			const audioPaths = await stageWindowsCaptureOutputs({
				temporaryVideo: videoPath,
				finalVideo: recording.finalVideoPath,
				audio: getAudioPaths(recording),
				protectExisting: true,
				onVideoStaged: async () => {
					videoPath = recording.finalVideoPath;
					if (videoPath !== recording.tempVideoPath) {
						await updateRecordingJournal(recording.startedAt, {
							tempVideoPath: videoPath,
						});
					}
				},
			});
			for (const audioPath of audioPaths) {
				try {
					await repairCapturedWavFile(audioPath);
				} catch (error) {
					console.warn("Could not repair interrupted WAV:", audioPath, error);
				}
			}
			await prepareSeekableMedia(videoPath, { replaceOriginal: true });
			if (recording.cursorJournalPath) {
				const samples = await rebuildCursorTelemetryFromJournal(
					recording.cursorJournalPath,
				);
				if (samples.length > 0) await writeCursorTelemetry(videoPath, samples);
			}
			if (recording.keyJournalPath) {
				const events = await rebuildKeystrokesFromJournal(recording.keyJournalPath);
				await writeKeystrokes(videoPath, events, recording.keyCaptureMode);
			}
			await rememberApprovedLocalReadPath(videoPath);
			await Promise.all(audioPaths.map(rememberApprovedLocalReadPath));
			const finalized = await finalizeStoredVideo(videoPath);
			if (recording.cursorJournalPath)
				await fs.rm(recording.cursorJournalPath, { force: true });
			if (recording.keyJournalPath) await fs.rm(recording.keyJournalPath, { force: true });
			await clearRecordingJournal(recording.startedAt);
			return { ...finalized, success: true as const };
		} catch (error) {
			return { success: false as const, path: videoPath, error: String(error) };
		}
	});
}

export function discardInterruptedRecording(startedAt: number) {
	return enqueueRecovery(async () => {
		const recording = await getRecoverableRecording();
		if (!recording || recording.startedAt !== startedAt) return { success: false };
		try {
			validateCapturePaths(recording);
			const { tempVideoPath, finalVideoPath, cursorJournalPath, keyJournalPath } = recording;
			const audioFiles = getAudioPaths(recording).flatMap(({ temporary, final }) => {
				if (!temporary) return [];
				const files = [temporary, `${temporary}.json`];
				if (tempVideoPath === finalVideoPath) files.push(final, `${final}.json`);
				return files;
			});
			for (const file of [
				...audioFiles,
				cursorJournalPath,
				keyJournalPath,
				getTelemetryPathForVideo(tempVideoPath),
				getKeysPathForVideo(tempVideoPath),
				tempVideoPath,
			]) {
				if (file && (await findCaptureFile(file))) await fs.rm(file, { force: true });
			}
			await clearRecordingJournal(recording.startedAt);
			return { success: true };
		} catch (error) {
			return { success: false, path: recording.tempVideoPath, error: String(error) };
		}
	});
}
