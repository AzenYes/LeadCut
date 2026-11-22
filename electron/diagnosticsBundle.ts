import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { app, dialog, screen, shell, type BrowserWindow } from "electron";
import { USER_DATA_PATH } from "./appPaths";
import { appLog, flushAppLog, LAST_EXPORT_FAILURE_FILE, redactHomePaths } from "./logger";
import { getRecordingsDir } from "./ipc/utils";
import { uiText } from "./uiI18n";

const RECORDING_DIAGNOSTICS_SUFFIX = ".recording-diagnostics.json";

async function copyRedactedFile(source: string, destination: string) {
	try {
		if (!(await fs.lstat(source)).isFile()) return;
		await fs.writeFile(destination, redactHomePaths(await fs.readFile(source, "utf8")), "utf8");
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
	}
}

async function copyLogDirectory(source: string, destination: string, bundle: string) {
	await fs.mkdir(destination);
	const entries = await fs.readdir(source, { withFileTypes: true }).catch(error => {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
		throw error;
	});
	for (const item of entries) {
		const from = path.join(source, item.name);
		const to = path.join(destination, item.name);
		if (item.isDirectory() && path.relative(from, bundle) !== "") {
			await copyLogDirectory(from, to, bundle);
		}
		else if (item.isFile()) await copyRedactedFile(from, to);
	}
}

export async function latestRecordingDiagnostics(directory: string): Promise<string | null> {
	let latest: { path: string; modifiedAt: number } | null = null;
	try {
		for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
			if (!entry.isFile() || !entry.name.endsWith(RECORDING_DIAGNOSTICS_SUFFIX)) continue;
			const file = path.join(directory, entry.name);
			const stat = await fs.stat(file).catch(() => null);
			if (stat && (!latest || stat.mtimeMs > latest.modifiedAt)) latest = { path: file, modifiedAt: stat.mtimeMs };
		}
	} catch {
		// The recording directory can be a detached drive.
	}
	return latest?.path ?? null;
}

export async function createDiagnosticsBundle({
	userDataPath,
	destinationDirectory,
	environment,
	recordingDiagnosticsPath,
	now = new Date(),
}: {
	userDataPath: string;
	destinationDirectory: string;
	environment: unknown;
	recordingDiagnosticsPath?: string | null;
	now?: Date;
}) {
	const parent = await fs.realpath(destinationDirectory);
	const timestamp = now.toISOString().replace(/[:.]/g, "-");
	const basename = `LeadCut-诊断-${timestamp}`;
	const logs = path.join(userDataPath, "logs");
	let result: string;
	for (let index = 1; ; index++) {
		result = path.join(parent, index === 1 ? basename : `${basename}-${index}`);
		try {
			await fs.mkdir(result);
			break;
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
		}
	}
	try {
		const actualLogs = await fs.realpath(logs).catch(error => {
			if ((error as NodeJS.ErrnoException).code === "ENOENT") return logs;
			throw error;
		});
		await copyLogDirectory(actualLogs, path.join(result, "logs"), result);
		await copyRedactedFile(path.join(userDataPath, "updater.log"), path.join(result, "updater.log"));
		await copyRedactedFile(path.join(logs, LAST_EXPORT_FAILURE_FILE), path.join(result, LAST_EXPORT_FAILURE_FILE));
		if (recordingDiagnosticsPath) {
			await copyRedactedFile(recordingDiagnosticsPath, path.join(result, path.basename(recordingDiagnosticsPath)));
		}
		await fs.writeFile(path.join(result, "环境.json"), redactHomePaths(JSON.stringify(environment, null, 2)), "utf8");
		return result;
	} catch (error) {
		await fs.rm(result, { recursive: true, force: true }).catch(() => undefined);
		throw error;
	}
}

export async function showExportDiagnosticsBundleDialog(parent?: BrowserWindow | null) {
	try {
		const options = {
			title: uiText("exportDiagnosticsBundle"),
			properties: ["openDirectory", "createDirectory"] as Array<"openDirectory" | "createDirectory">,
		};
		const choice = parent ? await dialog.showOpenDialog(parent, options) : await dialog.showOpenDialog(options);
		if (choice.canceled || !choice.filePaths[0]) return { success: false, canceled: true };
		const recordingsDir = await getRecordingsDir().catch(() => null);
		const recordingDiagnosticsPath = recordingsDir ? await latestRecordingDiagnostics(recordingsDir) : null;
		const gpu = await app.getGPUInfo("complete").catch(error => ({ error: String(error) }));
		const environment = {
			appVersion: app.getVersion(),
			platform: os.platform(),
			arch: os.arch(),
			systemVersion: os.release(),
			versions: process.versions,
			gpu,
			displays: screen.getAllDisplays(),
		};
		await flushAppLog();
		const bundle = await createDiagnosticsBundle({
			userDataPath: USER_DATA_PATH,
			destinationDirectory: choice.filePaths[0],
			environment,
			recordingDiagnosticsPath,
		});
		shell.showItemInFolder(bundle);
		return { success: true, path: bundle };
	} catch (error) {
		appLog("error", "diagnostics", "Could not export diagnostics bundle.", error);
		return { success: false, message: uiText("diagnosticsBundleFailed") };
	}
}
