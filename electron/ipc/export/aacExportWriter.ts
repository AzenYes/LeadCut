import { spawn } from "node:child_process";
import { getFfmpegBinaryPath } from "../ffmpeg/binary";

export function openAacExportWriter(tempPath: string) {
	const child = spawn(getFfmpegBinaryPath(), [
		"-v", "error", "-xerror", "-nostdin", "-y", "-f", "wav", "-i", "pipe:0",
		"-map", "0:a:0", "-c:a", "aac", "-b:a", "192k", tempPath,
	], { stdio: ["pipe", "ignore", "pipe"], windowsHide: true });
	let stderr = "";
	let processError: Error | undefined;
	let receivedBytes = 0;
	child.stderr.setEncoding("utf8");
	child.stderr.on("data", (chunk: string) => { stderr = (stderr + chunk).slice(-16_384); });
	child.stdin.on("error", () => { /* The write callback reports a failed write. */ });
	child.on("error", error => { processError = error; });
	const completion = new Promise<Error | undefined>(resolve => {
		child.once("close", (code, signal) => {
			resolve(processError ?? (code === 0 ? undefined : new Error(
				stderr.trim() || `AAC encoder exited (${signal ?? code}).`,
			)));
		});
	});

	return {
		async write(position: number, data: Buffer) {
			if (position !== receivedBytes) throw new Error("AAC export requires sequential audio input.");
			try {
				await new Promise<void>((resolve, reject) => {
					child.stdin.write(data, error => { if (error) reject(error); else resolve(); });
				});
			} catch (error) {
				throw (await completion) ?? error;
			}
			receivedBytes += data.byteLength;
		},
		async close() {
			if (!child.stdin.destroyed && !child.stdin.writableEnded) child.stdin.end();
			const failure = await completion;
			if (failure) throw failure;
		},
		abort() {
			child.stdin.destroy();
			child.kill("SIGKILL");
		},
	};
}
