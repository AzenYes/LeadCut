import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { constants } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { appLog } from "../../logger";
import { uiText } from "../../uiI18n";
import { getFfmpegBinaryPath } from "../ffmpeg/binary";
import { rememberApprovedLocalReadPath } from "../project/manager";
import { persistRecordingSessionManifest } from "../project/session";
import { setCurrentRecordingSession } from "../state";
import { getRecordingsDir } from "../utils";
import { validateRecordedVideo } from "./diagnostics";
import { finalizeStoredVideo } from "./mac";
import { resolveRecordedVideoStoragePath } from "./storagePath";

const run = promisify(execFile);
const MAX_CHUNK_BYTES = 4 * 1024 * 1024;
const recordingName = /^recording-[0-9]+\.(?:webm|mp4)$/;
type Stream = { file: Promise<string>; writes: Promise<void> };

async function publishRecoveredVideo(temporary: string, file: string) {
	try {
		await fs.link(temporary, file);
	} catch (error) {
		const code = (error as NodeJS.ErrnoException).code;
		if (!code || !["EPERM", "EACCES", "ENOSYS", "ENOTSUP"].includes(code)) throw error;
		await fs.copyFile(temporary, file, constants.COPYFILE_EXCL);
	}
}

export async function findBrowserRecordingPartial() {
	const directory = await getRecordingsDir();
	const entries = await fs.readdir(directory, { withFileTypes: true });
	let latest: { path: string; modified: number } | null = null;
	for (const entry of entries) {
		if (!entry.isFile() || !entry.name.endsWith(".partial")) continue;
		const name = entry.name.slice(0, -".partial".length);
		if (!recordingName.test(name)) continue;
		const file = resolveRecordedVideoStoragePath(directory, name);
		if (await fs.lstat(file).catch(() => null)) continue;
		const partial = `${file}.partial`;
		const stat = await fs.lstat(partial).catch(() => null);
		if (stat?.isFile() && stat.size > 0 && (!latest || latest.modified < stat.mtimeMs)) {
			latest = { path: partial, modified: stat.mtimeMs };
		}
	}
	return latest?.path ?? null;
}

async function recoverPartialToVideo(file: string) {
	const partial = `${file}.partial`;
	const extension = path.extname(file);
	const remuxed = `${file}.${randomUUID()}.remux${extension}`;
	try {
		if (!(await fs.lstat(partial)).isFile()) throw new Error("Invalid recording partial file.");
		await run(getFfmpegBinaryPath(), [
			"-nostdin", "-v", "error", "-n", "-fflags", "+genpts", "-i", partial,
			"-map", "0:v:0", "-map", "0:a?", "-c", "copy",
			...(extension === ".mp4" ? ["-movflags", "+faststart"] : []), remuxed,
		], { windowsHide: true, timeout: 15 * 60_000 });
		await validateRecordedVideo(remuxed);
		await publishRecoveredVideo(remuxed, file);
		const result = await finalizeStoredVideo(file);
		await fs.rm(partial, { force: true }).catch(error => appLog("warn", "browser-recording", "Could not remove the recording partial file.", error));
		return { ...result, success: true as const };
	} catch (error) {
		appLog("error", "browser-recording", `Could not finalize recording. Partial file: ${partial}`, error);
		return { success: false as const, message: uiText("failedToStoreVideo"), error: String(error), partialPath: partial };
	} finally {
		await fs.rm(remuxed, { force: true }).catch(() => undefined);
	}
}

export async function recoverBrowserRecordingPartial(partial: string) {
	const file = resolveRecordedVideoStoragePath(
		await getRecordingsDir(),
		path.basename(partial).slice(0, -".partial".length),
	);
	if (path.resolve(partial) !== `${file}.partial`) return { success: false, path: partial };
	const result = await recoverPartialToVideo(file);
	if (!result.success) return result;
	const stem = file.slice(0, -path.extname(file).length);
	for (const extension of [".webm", ".mp4"]) {
		const webcamPath = `${stem}-webcam${extension}`;
		try {
			if (!(await fs.lstat(webcamPath).catch(() => null))?.isFile()) {
				if (!(await fs.lstat(`${webcamPath}.partial`).catch(() => null))?.isFile()) continue;
				await finalizeWebcamRecording(webcamPath);
			}
			const session = { videoPath: file, webcamPath, timeOffsetMs: 0 };
			await rememberApprovedLocalReadPath(webcamPath);
			await persistRecordingSessionManifest(session);
			setCurrentRecordingSession(session);
			return { ...result, webcamPath };
		} catch (error) {
			appLog("warn", "browser-recording", "Could not recover the camera recording.", error);
		}
	}
	return result;
}

export async function finalizeWebcamRecording(file: string) {
	const partial = `${file}.partial`;
	const remuxed = `${file}.${randomUUID()}.remux${path.extname(file)}`;
	try {
		await run(getFfmpegBinaryPath(), [
			"-nostdin", "-v", "error", "-n", "-i", partial, "-map", "0:v:0", "-c", "copy", remuxed,
		], { windowsHide: true, timeout: 5 * 60_000 });
		await validateRecordedVideo(remuxed);
		await publishRecoveredVideo(remuxed, file);
	} finally {
		await fs.rm(remuxed, { force: true }).catch(() => undefined);
	}
	await fs.rm(partial, { force: true }).catch(error => appLog("warn", "browser-recording", "Could not remove the camera partial file.", error));
	return file;
}

export function createBrowserRecordingStreamStore() {
	const streams = new Map<string, Stream>();
	return {
		hasActiveStreams: () => streams.size > 0,
		async append(owner: number, name: string, data: ArrayBuffer, first: boolean) {
			if (!recordingName.test(name) || !(data instanceof ArrayBuffer) || data.byteLength === 0 || data.byteLength > MAX_CHUNK_BYTES) {
				throw new Error(uiText("failedToStoreVideo"));
			}
			const key = `${owner}:${name}`;
			const existing = streams.get(key);
			if (first) {
				if (existing) throw new Error(uiText("failedToStoreVideo"));
				const file = getRecordingsDir().then(directory => resolveRecordedVideoStoragePath(directory, name));
				const writes = file.then(target => fs.writeFile(`${target}.partial`, Buffer.from(data), { flag: "wx" }));
				streams.set(key, { file, writes });
				try { await writes; }
				catch (error) { streams.delete(key); throw error; }
				return;
			}
			if (!existing) throw new Error(uiText("failedToStoreVideo"));
			existing.writes = existing.writes.then(async () => fs.appendFile(`${await existing.file}.partial`, Buffer.from(data)));
			await existing.writes;
		},
		async finish(owner: number, name: string, discard: boolean) {
			const key = `${owner}:${name}`;
			const stream = streams.get(key);
			if (!stream) return discard ? null : { success: false, message: uiText("failedToStoreVideo") };
			streams.delete(key);
			await stream.writes.catch(() => undefined);
			const file = await stream.file;
			const partial = `${file}.partial`;
			if (discard) {
				await fs.rm(partial, { force: true });
				return null;
			}
			return recoverPartialToVideo(file);
		},
		releaseOwner(owner: number) {
			for (const key of streams.keys()) if (key.startsWith(`${owner}:`)) streams.delete(key);
		},
	};
}
