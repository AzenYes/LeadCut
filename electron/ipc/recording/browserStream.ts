import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { constants } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { appLog } from "../../logger";
import { uiText } from "../../uiI18n";
import { getFfmpegBinaryPath } from "../ffmpeg/binary";
import { getRecordingsDir } from "../utils";
import { validateRecordedVideo } from "./diagnostics";
import { finalizeStoredVideo } from "./mac";
import { resolveRecordedVideoStoragePath } from "./storagePath";

const run = promisify(execFile);
const MAX_CHUNK_BYTES = 4 * 1024 * 1024;
const recordingName = /^recording-[0-9]+\.(?:webm|mp4)$/;
type Stream = { file: Promise<string>; writes: Promise<void> };

export function createBrowserRecordingStreamStore() {
	const streams = new Map<string, Stream>();
	return {
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
			const extension = path.extname(file);
			const remuxed = `${file}.${randomUUID()}.remux${extension}`;
			try {
				await run(getFfmpegBinaryPath(), [
					"-nostdin", "-v", "error", "-n", "-fflags", "+genpts", "-i", partial,
					"-map", "0:v:0", "-map", "0:a?", "-c", "copy",
					...(extension === ".mp4" ? ["-movflags", "+faststart"] : []), remuxed,
				], { windowsHide: true });
				await validateRecordedVideo(remuxed);
				try { await fs.link(remuxed, file); }
				catch (error) {
					const code = (error as NodeJS.ErrnoException).code;
					if (!code || !["EPERM", "EACCES", "ENOSYS", "ENOTSUP"].includes(code)) throw error;
					await fs.copyFile(remuxed, file, constants.COPYFILE_EXCL);
				}
				const result = await finalizeStoredVideo(file);
				await fs.rm(partial, { force: true }).catch(error => appLog("warn", "browser-recording", "Could not remove the recording partial file.", error));
				return result;
			} catch (error) {
				appLog("error", "browser-recording", `Could not finalize recording. Partial file: ${partial}`, error);
				return { success: false, message: uiText("failedToStoreVideo"), error: String(error), partialPath: partial };
			} finally {
				await fs.rm(remuxed, { force: true }).catch(() => undefined);
			}
		},
		releaseOwner(owner: number) {
			for (const key of streams.keys()) if (key.startsWith(`${owner}:`)) streams.delete(key);
		},
	};
}
