import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import { promisify } from "node:util";
import { getFfmpegBinaryPath } from "../ffmpeg/binary";
import { getBrowserMicSidecarFilters } from "./audioFilters";

const run = promisify(execFile);

export function getBrowserMicrophonePartial(videoPath: string) {
	return `${videoPath.replace(/\.[^.]+$/, "")}.mic.source.webm.partial`;
}

export async function convertBrowserMicrophone(
	partial: string,
	destination: string,
	profile?: string,
) {
	const temporary = `${destination}.${randomUUID()}.wav`;
	try {
		await run(getFfmpegBinaryPath(), [
			"-hide_banner", "-loglevel", "error", "-nostdin", "-n", "-i", partial,
			"-vn", "-ac", "1", "-ar", "48000", "-af",
			[...getBrowserMicSidecarFilters(profile), "aresample=async=1:first_pts=0"].join(","),
			"-c:a", "pcm_s16le", temporary,
		], { windowsHide: true, timeout: 120_000, maxBuffer: 4 * 1024 * 1024 });
		await fs.rename(temporary, destination);
	} finally {
		await fs.rm(temporary, { force: true }).catch(() => undefined);
	}
}

export function createBrowserMicrophoneStreams() {
	const streams = new Map<string, {
		owner: number;
		partial: string;
		videoPath: string;
		recordingId: number | null;
		writes: Promise<void>;
		hasData: boolean;
	}>();
	return {
		create(owner: number, videoPath: string, recordingId: number | null) {
			if ([...streams.values()].some(stream => stream.owner === owner && stream.videoPath === videoPath)) {
				throw new Error("A microphone stream is already active for this recording.");
			}
			const id = randomUUID();
			streams.set(id, {
				owner, partial: getBrowserMicrophonePartial(videoPath), videoPath, recordingId,
				writes: Promise.resolve(), hasData: false,
			});
			return id;
		},
		append(owner: number, id: string, data: ArrayBuffer) {
			const stream = streams.get(id);
			if (stream?.owner !== owner || !(data instanceof ArrayBuffer) || data.byteLength === 0 || data.byteLength > 4 * 1024 * 1024) {
				throw new Error("Invalid recording microphone chunk.");
			}
			const flag = stream.hasData ? "a" : "wx";
			stream.hasData = true;
			stream.writes = stream.writes.then(() => fs.writeFile(stream.partial, Buffer.from(data), { flag }));
			return stream.writes;
		},
		hasRecording(recordingId: number | null) {
			return recordingId !== null && [...streams.values()].some(stream => stream.recordingId === recordingId);
		},
		async finish(owner: number, id: string, videoPath?: string) {
			const stream = streams.get(id);
			if (stream?.owner !== owner || (videoPath !== undefined && videoPath !== stream.videoPath)) {
				throw new Error("Unknown recording microphone stream.");
			}
			streams.delete(id);
			await stream.writes;
			return stream;
		},
		releaseOwner(owner: number) {
			for (const [id, stream] of streams) {
				if (stream.owner === owner) streams.delete(id);
			}
		},
	};
}
