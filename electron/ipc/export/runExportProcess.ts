import { execFile, type ChildProcess, type ExecFileOptions } from "node:child_process";
import { promisify } from "node:util";

const run = promisify(execFile);

async function waitForProcessClose<T>(result: Promise<T> & { child: ChildProcess }): Promise<T> {
	const closed = new Promise<void>(resolve => result.child.once("close", () => resolve()));
	try {
		return await result;
	} finally {
		// Aborting execFile rejects before Windows has released its open files.
		await closed;
	}
}

export function runExportProcess(file: string, args: string[], options: ExecFileOptions) {
	return waitForProcessClose(run(file, args, { ...options, encoding: "utf8" }));
}

export function runBinaryExportProcess(file: string, args: string[], options: ExecFileOptions) {
	return waitForProcessClose(run(file, args, { ...options, encoding: "buffer" }));
}
