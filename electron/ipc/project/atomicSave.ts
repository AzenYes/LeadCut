import { randomUUID } from "node:crypto";
import { constants as fsConstants } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";

const pendingWrites = new Map<string, Promise<void>>();

const unsupportedDirectorySyncErrors = new Set([
	"EACCES",
	"EINVAL",
	"EISDIR",
	"ENOSYS",
	"ENOTSUP",
	"EOPNOTSUPP",
	"EPERM",
]);

export function getProjectBackupPath(projectPath: string): string {
	return `${projectPath}.bak`;
}

export async function withRenamedProjectBackup<T>(source: string, target: string, rename: () => Promise<T>): Promise<T> {
	const previous = getProjectBackupPath(source);
	const next = getProjectBackupPath(target);
	let copied = false;
	try {
		try {
			await fs.copyFile(previous, next, fsConstants.COPYFILE_EXCL);
			copied = true;
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
		}
		if (copied) await syncExistingFile(next);
		const renamed = await rename();
		if (copied) {
			await fs.rm(previous, { force: true }).catch(error => console.warn("Could not remove the old project backup:", error));
		}
		return renamed;
	} catch (error) {
		if (copied) await fs.rm(next, { force: true }).catch(() => undefined);
		throw error;
	}
}

function getQueueKey(projectPath: string): string {
	const resolvedPath = path.resolve(projectPath);
	return process.platform === "win32" ? resolvedPath.toLowerCase() : resolvedPath;
}

function createTemporaryPath(parentDir: string, label: string): string {
	return path.join(parentDir, `.leadcut-${label}-${process.pid}-${randomUUID()}.tmp`);
}

async function getExistingFileMode(filePath: string): Promise<number | undefined> {
	try {
		return (await fs.stat(filePath)).mode & 0o777;
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") {
			return undefined;
		}
		throw error;
	}
}

async function writeSyncedTemporaryFile(
	filePath: string,
	contents: string,
	mode?: number,
): Promise<void> {
	const handle = await fs.open(filePath, "wx", mode);
	try {
		await handle.writeFile(contents, "utf-8");
		if (mode !== undefined) {
			await handle.chmod(mode);
		}
		await handle.sync();
	} finally {
		await handle.close();
	}
}

async function syncExistingFile(filePath: string): Promise<void> {
	const handle = await fs.open(filePath, "r+");
	try {
		await handle.sync();
	} finally {
		await handle.close();
	}
}

async function syncParentDirectory(parentDir: string): Promise<void> {
	if (process.platform === "win32") {
		return;
	}

	try {
		const handle = await fs.open(parentDir, "r");
		try {
			await handle.sync();
		} finally {
			await handle.close();
		}
	} catch (error) {
		const code = (error as NodeJS.ErrnoException).code;
		if (!code || !unsupportedDirectorySyncErrors.has(code)) {
			throw error;
		}
	}
}

async function preservePreviousGeneration(
	targetPath: string,
	backupPath: string,
	backupTemporaryPath: string,
): Promise<void> {
	try {
		await fs.copyFile(targetPath, backupTemporaryPath, fsConstants.COPYFILE_EXCL);
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") {
			await fs.rm(backupPath, { force: true });
			return;
		}
		throw error;
	}

	await syncExistingFile(backupTemporaryPath);
	await fs.rename(backupTemporaryPath, backupPath);
}

async function commitProjectFile(
	projectPath: string,
	contents: string,
	verify?: () => Promise<void>,
	beforeCommit?: () => Promise<void>,
): Promise<void> {
	const targetPath = path.resolve(projectPath);
	const parentDir = path.dirname(targetPath);
	const backupPath = getProjectBackupPath(targetPath);
	const temporaryPath = createTemporaryPath(parentDir, "project");
	const backupTemporaryPath = createTemporaryPath(parentDir, "backup");
	await verify?.();
	const existingMode = await getExistingFileMode(targetPath);

	try {
		await writeSyncedTemporaryFile(temporaryPath, contents, existingMode);
		await verify?.();
		if (beforeCommit) {
			await beforeCommit();
			await verify?.();
		}
		await preservePreviousGeneration(targetPath, backupPath, backupTemporaryPath);
		await fs.rename(temporaryPath, targetPath);
		await syncParentDirectory(parentDir);
	} finally {
		await Promise.all([
			fs.rm(temporaryPath, { force: true }).catch(() => undefined),
			fs.rm(backupTemporaryPath, { force: true }).catch(() => undefined),
		]);
	}
}

export async function writeProjectFileAtomically(
	projectPath: string,
	contents: string,
	verify?: () => Promise<void>,
	beforeCommit?: () => Promise<void>,
): Promise<void> {
	const queueKey = getQueueKey(projectPath);
	const previousWrite = pendingWrites.get(queueKey) ?? Promise.resolve();
	const currentWrite = previousWrite
		.catch(() => undefined)
		.then(() => commitProjectFile(projectPath, contents, verify, beforeCommit));
	pendingWrites.set(queueKey, currentWrite);

	try {
		await currentWrite;
	} finally {
		if (pendingWrites.get(queueKey) === currentWrite) {
			pendingWrites.delete(queueKey);
		}
	}
}
