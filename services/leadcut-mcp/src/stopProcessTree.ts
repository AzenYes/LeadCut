import { execFile, type ChildProcess } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export async function stopProcessTree(child: ChildProcess | null | undefined) {
	if (!child?.pid || child.exitCode !== null || child.signalCode !== null) return;
	if (process.platform === "win32") {
		try {
			await execFileAsync("taskkill.exe", ["/PID", String(child.pid), "/T", "/F"], {
				windowsHide: true,
				timeout: 1500,
			});
			return;
		} catch {
			// The process may already have exited.
		}
	}
	try {
		child.kill("SIGKILL");
	} catch {
		// The process may already have exited.
	}
}
