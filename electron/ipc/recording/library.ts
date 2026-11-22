import { uiText } from "../../uiI18n";
import fs from "node:fs/promises";
import { constants } from "node:fs";
import path from "node:path";
import { shell } from "electron";
import { buildMediaUrl, getMediaServerBaseUrl } from "../../mediaServer";
import { rememberApprovedLocalReadPath } from "../project/manager";
import { getMarkersPathForVideo, getRecordingsDir } from "../utils";
import { getKeysPathForVideo } from "../../../services/leadcut-mcp/src/keystrokeSidecar";
import type { RecordingLibraryEntry } from "../../../src/types/recordingLibrary";
import { LEGACY_RECORDING_SESSION_MANIFEST_SUFFIXES, RECORDING_SESSION_MANIFEST_SUFFIX } from "./recordingFileNames";

let mutation = Promise.resolve();
const undoBatches = new Map<string, { bundle: string; files: string[] }>();
const isRecording = (name: string) =>
	/\.(mp4|mov|webm|mkv|m4v)$/i.test(name) && !/[.-]webcam[.-]/i.test(name);
const batchKey = (paths: string[]) => JSON.stringify([...new Set(paths)].sort());

export function listRecordings(includeSources = false): Promise<RecordingLibraryEntry[]> {
	const task = mutation.then(async () => {
		const root = await fs.realpath(await getRecordingsDir());
		const server = getMediaServerBaseUrl();
		if (!server) throw new Error(uiText("mediaServerIsNotReadyTryAgain"));
		const entries = await fs.readdir(root, { withFileTypes: true });
		for (const entry of entries) {
			const staged = path.join(root, entry.name);
			if (
				entry.isDirectory() &&
				/^\.(?:leadcut|recordly)-trash-[A-Za-z0-9]{6}$/.test(entry.name) &&
				![...undoBatches.values()].some((batch) => batch.bundle === staged)
			) {
				await shell.trashItem(staged);
			}
		}
		const result: RecordingLibraryEntry[] = [];
		for (const entry of entries) {
			if (!entry.isFile() || !(includeSources ? /\.(mp4|mov|webm|mkv|m4v|wav|m4a|mp3|ogg|flac)$/i.test(entry.name) : isRecording(entry.name))) continue;
			const filePath = path.join(root, entry.name);
			const stat = await fs.stat(filePath);
			if (!stat.size) continue;
			await rememberApprovedLocalReadPath(filePath);
			result.push({
				path: filePath,
				name: entry.name,
				bytes: stat.size,
				createdAt: stat.mtimeMs,
				url: buildMediaUrl(server, filePath),
			});
		}
		return result.sort((a, b) => b.createdAt - a.createdAt);
	});
	mutation = task.then(
		() => undefined,
		() => undefined,
	);
	return task;
}

// Only capture sidecars belonging to this exact recording, never adjacent recordings or projects.
function belongsToRecording(name: string, video: string) {
	const stem = video.slice(0, -path.extname(video).length);
	return (
		name === video ||
		name === `${video}.cursor.json` ||
		name === getMarkersPathForVideo(video) ||
		name === getKeysPathForVideo(video) ||
		(name.startsWith(`${stem}.`) &&
			/^\.(?:system|mic|microphone|audio|webcam)\.(?:wav|webm|mp4|m4a)(?:\.json)?$/i.test(
				name.slice(stem.length),
			)) ||
		[RECORDING_SESSION_MANIFEST_SUFFIX, ...LEGACY_RECORDING_SESSION_MANIFEST_SUFFIXES].some(suffix => name === `${stem}${suffix}`) ||
		name === `${stem}.recording-session.json` ||
		(name.startsWith(`${stem}-webcam.`) && /^-webcam\.(?:mp4|webm|mov|mkv|avi)$/i.test(name.slice(stem.length)))
	);
}

export async function deleteRecordingBundle(videoPath: string) {
	const video = path.basename(videoPath);
	if (!isRecording(video)) throw new Error(uiText("invalidRecordingSelection"));
	const directory = path.dirname(videoPath);
	const filenames = await fs.readdir(directory);
	const unlink = async (file: string) => {
		try {
			await fs.unlink(file);
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
		}
	};
	await unlink(videoPath);
	await Promise.all(filenames.filter(name => name !== video && belongsToRecording(name, video))
		.map(name => unlink(path.join(directory, name))));
}

/** Stage a bundle by rename for Undo; the next removal or app exit sends it to Trash. */
export function setRecordingsRemoved(paths: string[], removed: boolean): Promise<void> {
	const task = mutation.then(async () => {
		if (
			typeof removed !== "boolean" ||
			!Array.isArray(paths) ||
			!paths.length ||
			paths.some((value) => typeof value !== "string")
		)
			throw new Error(uiText("invalidRecordingSelection"));
		const root = await fs.realpath(await getRecordingsDir());
		const selected = [...new Set(paths)];
		for (const candidate of selected) {
			if (path.dirname(candidate) !== root || !isRecording(path.basename(candidate)))
				throw new Error(uiText("recordingIsOutsideTheVideosLibrary"));
		}
		const key = batchKey(selected);
		if (!removed) {
			const batch = undoBatches.get(key);
			if (!batch)
				throw new Error(
					uiText("thisRemovalCanNoLongerBeUndoneRestoreTheFilesFromTrash"),
				);
			// Check every destination before restoring any file; never overwrite newer media.
			for (const file of batch.files) {
				if (
					await fs.lstat(file).then(
						() => true,
						(error) => {
							if (error.code === "ENOENT") return false;
							throw error;
						},
					)
				)
					throw new Error(
						uiText("aFileWithThisNameAlreadyExistsRestoreItFromTrashInstead"),
					);
			}
			const restored: string[] = [];
			try {
				for (const file of batch.files) {
					const staged = path.join(batch.bundle, path.basename(file));
					try {
						await fs.link(staged, file);
					} catch (error) {
						if (
							!["EPERM", "ENOTSUP", "EOPNOTSUPP", "EXDEV"].includes(
								(error as NodeJS.ErrnoException).code ?? "",
							)
						)
							throw error;
						await fs.copyFile(staged, file, constants.COPYFILE_EXCL);
					}
					restored.push(file);
				}
			} catch (error) {
				await Promise.all(restored.map((file) => fs.unlink(file)));
				throw error;
			}
			undoBatches.delete(key);
			await fs.rm(batch.bundle, { recursive: true, force: true });
			return;
		}
		const available = await fs.readdir(root, { withFileTypes: true });
		for (const file of selected) {
			if (!available.some((entry) => entry.name === path.basename(file) && entry.isFile()))
				throw new Error(uiText("recordingIsMissingOrIsNotARegularFile"));
		}
		const files = available
			.filter(
				(entry) =>
					entry.isFile() &&
					selected.some((file) => belongsToRecording(entry.name, path.basename(file))),
			)
			.map((entry) => path.join(root, entry.name));
		await finishPendingTrash();
		const bundle = await fs.mkdtemp(path.join(root, ".leadcut-trash-"));
		const moved: string[] = [];
		try {
			for (const file of files) {
				await fs.rename(file, path.join(bundle, path.basename(file)));
				moved.push(file);
			}
			undoBatches.set(key, { bundle, files });
		} catch (error) {
			for (const file of moved) await fs.rename(path.join(bundle, path.basename(file)), file);
			await fs.rmdir(bundle);
			throw error;
		}
	});
	mutation = task.catch(() => undefined);
	return task;
}

async function finishPendingTrash() {
	for (const [key, batch] of undoBatches) {
		await shell.trashItem(batch.bundle);
		undoBatches.delete(key);
	}
}
export function clearRecordingTrashUndo() {
	const task = mutation.then(finishPendingTrash);
	mutation = task.catch(() => undefined);
	return task;
}
