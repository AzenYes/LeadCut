import fs from "node:fs/promises";
import path from "node:path";
import {
	hasLegacyProjectExtension,
	PROJECT_FILE_EXTENSION,
	stripProjectExtension,
} from "../../../src/lib/projectFileExtensions";
import { getProjectBackupPath } from "./atomicSave";
import { computeProjectRevision } from "./projectRevision";

const exclusiveCopy = fs.constants.COPYFILE_EXCL;
const conversions = new Map<string, Promise<LegacyProjectConversion>>();

type LegacyProjectConversion = { path: string; convertedFrom: string };
type Options = {
	expectedRevision?: string;
	finalize?: (target: string, reused: boolean) => Promise<void>;
};

function hasCode(error: unknown, code: string) {
	return (error as NodeJS.ErrnoException)?.code === code;
}

function readProjectId(contents: string) {
	const parsed: unknown = JSON.parse(contents.replace(/^\uFEFF/, ""));
	if (!parsed || typeof parsed !== "object" || !("projectId" in parsed)) return null;
	return typeof parsed.projectId === "string" && parsed.projectId.trim() ? parsed.projectId : null;
}

async function exists(file: string) {
	try {
		await fs.lstat(file);
		return true;
	} catch (error) {
		if (!hasCode(error, "ENOENT")) throw error;
		return false;
	}
}

async function chooseTarget(source: string, projectId: string | null) {
	const base = stripProjectExtension(source);
	for (let index = 0; ; index++) {
		const target = `${base}${index ? `_${index}` : ""}.${PROJECT_FILE_EXTENSION}`;
		try {
			await fs.copyFile(source, target, exclusiveCopy);
			return { target, reused: false };
		} catch (error) {
			if (!hasCode(error, "EEXIST")) throw error;
			if (!projectId) continue;
		}
		const targetId = await fs.lstat(target).then(async (stats) =>
			stats.isFile() ? readProjectId(await fs.readFile(target, "utf8")) : null,
		).catch(() => null);
		if (targetId === projectId) return { target, reused: true };
	}
}

async function archivePaths(source: string) {
	const directory = path.join(path.dirname(source), "旧工程备份");
	await fs.mkdir(directory, { recursive: true });
	if (!(await fs.lstat(directory)).isDirectory()) throw new Error("Invalid project backup directory.");
	const suffix = path.extname(source);
	const base = path.basename(source, suffix);
	for (let index = 0; ; index++) {
		const archive = path.join(directory, `${base}${index ? `_${index}` : ""}${suffix}`);
		const archiveBackup = getProjectBackupPath(archive);
		if (!(await exists(archive)) && !(await exists(archiveBackup))) return { archive, archiveBackup };
	}
}

async function convert(source: string, options: Options): Promise<LegacyProjectConversion> {
	const contents = await fs.readFile(source, "utf8");
	const sourceRevision = computeProjectRevision(contents);
	if (options.expectedRevision !== undefined && options.expectedRevision !== sourceRevision) {
		throw new Error("Legacy project changed on disk.");
	}
	const sourceBackup = getProjectBackupPath(source);
	const { target, reused } = await chooseTarget(source, readProjectId(contents));
	const archivedFiles: { from: string; to: string; removed: boolean }[] = [];
	try {
		const { archive, archiveBackup } = await archivePaths(source);
		await fs.copyFile(source, archive, exclusiveCopy);
		archivedFiles.push({ from: source, to: archive, removed: false });
		if (await exists(sourceBackup)) {
			await fs.copyFile(sourceBackup, archiveBackup, exclusiveCopy);
			archivedFiles.push({ from: sourceBackup, to: archiveBackup, removed: false });
		}
		if (computeProjectRevision(await fs.readFile(source, "utf8")) !== sourceRevision ||
			computeProjectRevision(await fs.readFile(archive, "utf8")) !== sourceRevision ||
			(!reused && computeProjectRevision(await fs.readFile(target, "utf8")) !== sourceRevision)) {
			throw new Error("Legacy project changed on disk.");
		}
		for (const file of archivedFiles) {
			await fs.unlink(file.from);
			file.removed = true;
		}
		await options.finalize?.(target, reused);
		return { path: target, convertedFrom: source };
	} catch (error) {
		for (const file of archivedFiles.reverse()) {
			const restored = !file.removed ||
				await fs.copyFile(file.to, file.from, exclusiveCopy).then(() => true, () => false);
			// Preserve the archived bytes if the original path cannot be restored.
			if (restored) await fs.rm(file.to, { force: true }).catch(() => undefined);
		}
		if (!reused) await fs.rm(target, { force: true }).catch(() => undefined);
		throw error;
	}
}

export function convertLegacyProjectFile(legacyPath: string, options: Options = {}): Promise<LegacyProjectConversion> {
	const source = path.resolve(legacyPath);
	if (!hasLegacyProjectExtension(source)) return Promise.reject(new Error("Unknown legacy project format."));
	const key = process.platform === "win32" ? source.toLowerCase() : source;
	const pending = conversions.get(key);
	if (pending) return pending;
	const task = convert(source, options).finally(() => conversions.delete(key));
	conversions.set(key, task);
	return task;
}
