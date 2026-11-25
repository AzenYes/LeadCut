import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { USER_DATA_PATH } from "../../appPaths";
import { type KeystrokeCaptureMode, isKeystrokeCaptureMode } from "../../../services/leadcut-mcp/src/keystrokeSidecar";

export interface RecordingJournal {
	version: 1;
	startedAt: number;
	tempVideoPath: string;
	tempSystemAudioPath?: string;
	tempMicAudioPath?: string;
	browserMicrophone?: { profile?: string; startDelayMs: number };
	finalVideoPath: string;
	cursorJournalPath?: string;
	keyJournalPath?: string;
	keyCaptureMode?: KeystrokeCaptureMode;
}

type JournalPaths = Omit<RecordingJournal, "version" | "startedAt">;

function isRecordingJournal(value: unknown): value is RecordingJournal {
	if (!value || typeof value !== "object") return false;
	const journal = value as Partial<RecordingJournal>;
	const absolutePath = (candidate: unknown) =>
		typeof candidate === "string" && path.isAbsolute(candidate);
	const optionalPath = (candidate: unknown) => candidate === undefined || absolutePath(candidate);
	return (
		journal.version === 1 &&
		Number.isSafeInteger(journal.startedAt) &&
		(journal.startedAt ?? 0) > 0 &&
		absolutePath(journal.tempVideoPath) &&
		absolutePath(journal.finalVideoPath) &&
		optionalPath(journal.tempSystemAudioPath) &&
		optionalPath(journal.tempMicAudioPath) &&
		(journal.browserMicrophone === undefined ||
			(Boolean(journal.browserMicrophone) &&
				Number.isFinite(journal.browserMicrophone.startDelayMs) &&
				journal.browserMicrophone.startDelayMs >= 0 &&
				(journal.browserMicrophone.profile === undefined ||
					typeof journal.browserMicrophone.profile === "string"))) &&
		optionalPath(journal.cursorJournalPath) &&
		optionalPath(journal.keyJournalPath) &&
		(journal.keyCaptureMode === undefined || isKeystrokeCaptureMode(journal.keyCaptureMode))
	);
}

export function createRecordingJournalStore(directory: string) {
	const file = path.join(directory, "leadcut-recording-journal.json");
	const archivedFile = (startedAt: number) =>
		path.join(directory, `leadcut-recording-journal-${startedAt}.json`);
	let committed: Promise<unknown> = Promise.resolve();
	const enqueue = <T>(operation: () => Promise<T>): Promise<T> => {
		const next = committed.catch(() => undefined).then(operation);
		committed = next;
		return next;
	};
	const read = async (journalFile = file) => {
		try {
			const data: unknown = JSON.parse(await fs.readFile(journalFile, "utf8"));
			return isRecordingJournal(data) ? data : null;
		} catch (error) {
			if (error instanceof SyntaxError || (error as NodeJS.ErrnoException).code === "ENOENT")
				return null;
			throw error;
		}
	};
	const hasVideo = async (journal: RecordingJournal) => {
		try {
			return (await fs.lstat(journal.tempVideoPath)).isFile();
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
			throw error;
		}
	};
	const write = async (journal: RecordingJournal, journalFile = file) => {
		if (!isRecordingJournal(journal)) throw new Error("Invalid recording recovery paths");
		await fs.mkdir(directory, { recursive: true });
		const temporary = path.join(directory, `.leadcut-recording-journal-${randomUUID()}.tmp`);
		try {
			await fs.writeFile(temporary, JSON.stringify(journal), {
				encoding: "utf8",
				flag: "wx",
				flush: true,
			});
			await fs.rename(temporary, journalFile);
		} finally {
			await fs.rm(temporary, { force: true }).catch(() => undefined);
		}
	};
	const findByStartedAt = async (startedAt: number) => {
		const current = await read();
		if (current?.startedAt === startedAt) return { recording: current, journalFile: file };
		const journalFile = archivedFile(startedAt);
		const archived = await read(journalFile);
		return archived?.startedAt === startedAt ? { recording: archived, journalFile } : null;
	};
	return {
		writeRecordingJournal: (journal: RecordingJournal) =>
			enqueue(async () => {
				const previous = await read();
				if (
					previous &&
					previous.startedAt !== journal.startedAt &&
					(await hasVideo(previous))
				) {
					await write(previous, archivedFile(previous.startedAt));
				}
				await write(journal);
			}),
		readRecordingJournal: () => enqueue(() => read()),
		updateRecordingJournal: (startedAt: number, changes: Partial<JournalPaths>) =>
			enqueue(async () => {
				const match = await findByStartedAt(startedAt);
				if (!match) return false;
				await write({ ...match.recording, ...changes }, match.journalFile);
				return true;
			}),
		clearRecordingJournal: (startedAt?: number) =>
			enqueue(async () => {
				const journalFile =
					startedAt === undefined
						? file
						: (await findByStartedAt(startedAt))?.journalFile;
				if (journalFile) await fs.rm(journalFile, { force: true });
			}),
		findInterruptedRecording: () =>
			enqueue(async () => {
				const recording = await read();
				if (recording && (await hasVideo(recording))) return recording;
				let files: string[];
				try {
					files = await fs.readdir(directory);
				} catch (error) {
					if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
					throw error;
				}
				const archiveIds = files
					.flatMap((name) => {
						const match = /^leadcut-recording-journal-(\d+)\.json$/.exec(name);
						return match ? [Number(match[1])] : [];
					})
					.sort((left, right) => right - left);
				for (const startedAt of archiveIds) {
					const archived = await read(archivedFile(startedAt));
					if (archived?.startedAt === startedAt && (await hasVideo(archived)))
						return archived;
				}
				return null;
			}),
	};
}

export const {
	writeRecordingJournal,
	readRecordingJournal,
	updateRecordingJournal,
	clearRecordingJournal,
	findInterruptedRecording,
} = createRecordingJournalStore(USER_DATA_PATH);
