import { execFile } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { app } from "electron";
import { getFfmpegBinaryPath } from "../ffmpeg/binary";

const run = promisify(execFile);
const pending = new Map<string, Promise<string>>();

/** Read box headers only; never scan the recording's multi-gigabyte media payload. */
export async function isFragmentedMp4(filePath: string): Promise<boolean> {
	if (!/\.(mp4|mov|m4v)$/i.test(filePath)) return false;
	const file = await fs.open(filePath, "r");
	try {
		const { size: fileSize } = await file.stat();
		const header = Buffer.alloc(16);
		let offset = 0;
		for (let boxes = 0; boxes < 128 && offset + 8 <= fileSize; boxes++) {
			const { bytesRead } = await file.read(header, 0, 16, offset);
			if (bytesRead < 8) return false;
			const type = header.toString("ascii", 4, 8);
			if (type === "moof") return true;
			if (type === "mdat") return false;
			const shortSize = header.readUInt32BE(0);
			if (shortSize === 1 && bytesRead < 16) return false;
			const size = shortSize === 1 ? Number(header.readBigUInt64BE(8)) : shortSize;
			if (!Number.isSafeInteger(size) || size < (shortSize === 1 ? 16 : 8) || offset + size > fileSize) return false;
			offset += size;
		}
		return false;
	} finally { await file.close(); }
}

/** Prepare a lossless indexed copy for HTML media, optionally publishing it over app-owned recordings. */
export async function prepareSeekableMedia(filePath: string, { replaceOriginal = false } = {}): Promise<string> {
	const stat = await fs.stat(filePath);
	const key = createHash("sha256").update(JSON.stringify([filePath, stat.size, stat.mtimeMs])).digest("hex");
	const taskKey = replaceOriginal ? `${key}:replace` : key;
	const previous = pending.get(taskKey);
	if (previous) return previous;
	const task = (async () => {
		if (!(await isFragmentedMp4(filePath))) return filePath;
		const root = replaceOriginal ? path.dirname(filePath) : path.join(app.getPath("userData"), "preview-media");
		const output = replaceOriginal ? filePath : path.join(root, `${key}.mp4`);
		if (!replaceOriginal && (await fs.stat(output).catch(() => null))?.size) return output;
		await fs.mkdir(root, { recursive: true });
		const temporary = path.join(root, `.leadcut-seekable-${randomUUID()}.mp4`);
		try {
			await run(getFfmpegBinaryPath(), ["-hide_banner", "-loglevel", "error", "-nostdin", "-y", "-i", filePath, "-map", "0", "-c", "copy", "-movflags", "+faststart", temporary], { windowsHide: true, timeout: 300000, maxBuffer: 1024 * 1024 });
			await fs.rename(temporary, output);
			return output;
		} finally { await fs.unlink(temporary).catch(() => undefined); }
	})();
	pending.set(taskKey, task);
	try { return await task; } finally { pending.delete(taskKey); }
}
