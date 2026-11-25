import { constants } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { chapterSequenceDuration, type ChapterSequence } from "../../../services/leadcut-mcp/src/chapterModel";
import { agentBackupLinkPath, PROJECT_HISTORY_RETENTION, pruneHistoryFiles } from "../../../services/leadcut-mcp/src/projectHistoryRetention";
import {
	hasKnownProjectExtension,
	LEGACY_PROJECT_FILE_EXTENSIONS,
	PROJECT_FILE_EXTENSION,
	stripProjectExtension,
} from "../../../src/lib/projectFileExtensions";
import type { ProjectVersionEntry } from "../../../src/types/projectVersion";
import { guardedSaveProject } from "./guardedSave";

export type { ProjectVersionEntry } from "../../../src/types/projectVersion";

type VersionFile = Omit<ProjectVersionEntry, "durationMs" | "sizeBytes">;
const HISTORY_DIRECTORIES = [".mcp-backups", ".leadcut-history"] as const;
const APP_SNAPSHOT_INTERVAL_MS = 10 * 60_000;

function filesystemKey(filePath: string) {
	return process.platform === "win32" ? filePath.toLowerCase() : filePath;
}

async function historyDirectory(projectPath: string, directory: string, create = false) {
	try {
		const projectDirectory = await fs.realpath(path.dirname(path.resolve(projectPath)));
		const expected = path.join(projectDirectory, directory);
		if (create) await fs.mkdir(expected, { recursive: true });
		const actual = await fs.realpath(expected);
		if (filesystemKey(actual) !== filesystemKey(expected)) {
			throw new Error("Invalid project history directory.");
		}
		return actual;
	} catch (error) {
		if (!create && (error as NodeJS.ErrnoException).code === "ENOENT") return null;
		throw error;
	}
}

function parseVersionFile(projectNames: Set<string>, directory: string, filePath: string): VersionFile | null {
	const id = path.basename(filePath);
	const match = /^(.+)\.(\d{13})-([\w-]+)\.([a-z]+)$/i.exec(id);
	if (!match || !hasKnownProjectExtension(match[1]) || !hasKnownProjectExtension(id)) return null;
	if (!projectNames.has(filesystemKey(match[1]))) return null;
	const source = directory === HISTORY_DIRECTORIES[0] ? "agent" : match[3];
	if (source !== "agent" && source !== "app" && source !== "before-restore") return null;
	if (directory === HISTORY_DIRECTORIES[1] && source === "agent") return null;
	return { id, path: filePath, source, createdAt: Number(match[2]) };
}

async function listVersionFiles(projectPath: string, directories: readonly string[] = HISTORY_DIRECTORIES) {
	const projectName = path.basename(projectPath);
	const extensions = [PROJECT_FILE_EXTENSION, ...LEGACY_PROJECT_FILE_EXTENSIONS];
	const projectNames = new Set([filesystemKey(projectName)]);
	for (const extension of extensions) {
		const alias = `${stripProjectExtension(projectName)}.${extension}`;
		if (filesystemKey(alias) === filesystemKey(projectName)) continue;
		try {
			// A surviving legacy sibling can belong to a different project.
			await fs.lstat(path.join(path.dirname(projectPath), alias));
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
			projectNames.add(filesystemKey(alias));
		}
	}
	const entries: VersionFile[] = [];
	for (const directory of directories) {
		const fullPath = await historyDirectory(projectPath, directory);
		if (!fullPath) continue;
		for (const entry of await fs.readdir(fullPath, { withFileTypes: true })) {
			if (!entry.isFile()) continue;
			const version = parseVersionFile(projectNames, directory, path.join(fullPath, entry.name));
			if (version) entries.push(version);
		}
	}
	return entries.sort((a, b) => b.createdAt - a.createdAt || a.id.localeCompare(b.id));
}

async function verifiedVersionPath(projectPath: string, versionPath: string) {
	const input = path.resolve(versionPath);
	const paths = await listVersionFiles(projectPath);
	const version = paths.find(entry => filesystemKey(entry.path) === filesystemKey(input));
	if (!version || !(await fs.lstat(version.path)).isFile() ||
		filesystemKey(await fs.realpath(version.path)) !== filesystemKey(version.path)) {
		throw new Error("Invalid project version path.");
	}
	return version.path;
}

function parseProject(contents: string) {
	const candidate = JSON.parse(contents.replace(/^\uFEFF/, ""));
	if (!candidate || typeof candidate.version !== "number" ||
		typeof candidate.videoPath !== "string" || !candidate.videoPath.trim() ||
		!candidate.editor || typeof candidate.editor !== "object" || Array.isArray(candidate.editor)) {
		throw new Error("Invalid project version.");
	}
	return candidate as { editor: ChapterSequence };
}

export async function listProjectVersions(projectPath: string): Promise<ProjectVersionEntry[]> {
	const files = await listVersionFiles(projectPath);
	const versions: ProjectVersionEntry[] = [];
	for (const entry of files) {
		try {
			const contents = await fs.readFile(entry.path, "utf8");
			const durationMs = chapterSequenceDuration(parseProject(contents).editor);
			if (Number.isFinite(durationMs)) {
				versions.push({ ...entry, durationMs, sizeBytes: Buffer.byteLength(contents) });
			}
		} catch (error) {
			// A partial MCP write or a corrupted old copy must not hide the other versions.
			console.warn("Could not read project version metadata:", entry.path, error);
		}
	}
	return versions;
}

export async function snapshotProjectVersion(projectPath: string, source: "app" | "before-restore") {
	const dir = await historyDirectory(projectPath, HISTORY_DIRECTORIES[1], true);
	if (!dir) throw new Error("Could not create project history.");
	let createdAt = Date.now();
	while (true) {
		const snapshot = path.join(dir, `${path.basename(projectPath)}.${createdAt}-${source}${path.extname(projectPath)}`);
		try {
			await fs.copyFile(projectPath, snapshot, constants.COPYFILE_EXCL);
			return snapshot;
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
			createdAt++;
		}
	}
}

export async function pruneProjectVersions(
	projectPath: string,
	options: Parameters<typeof pruneHistoryFiles>[1] = PROJECT_HISTORY_RETENTION,
) {
	return pruneHistoryFiles(await listVersionFiles(projectPath, [HISTORY_DIRECTORIES[1]]), options);
}

export async function snapshotAppVersionIfDue(projectPath: string) {
	try {
		const versions = await listVersionFiles(projectPath, [HISTORY_DIRECTORIES[1]] as const);
		const latest = versions.find(entry => entry.source === "app");
		if (latest && Date.now() - latest.createdAt < APP_SNAPSHOT_INTERVAL_MS) return;
		await snapshotProjectVersion(projectPath, "app");
		await pruneProjectVersions(projectPath);
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
			console.warn("Could not create automatic project snapshot:", error);
		}
	}
}

export async function readProjectVersion(projectPath: string, versionPath: string) {
	return parseProject(await fs.readFile(await verifiedVersionPath(projectPath, versionPath), "utf8"));
}

export async function restoreProjectVersion(
	projectPath: string,
	versionPath: string,
	expectedRevision: string,
	verifyContents?: (project: unknown) => Promise<void>,
) {
	const content = await fs.readFile(await verifiedVersionPath(projectPath, versionPath), "utf8");
	const project = parseProject(content);
	await verifyContents?.(project);
	const result = await guardedSaveProject({
		projectPath,
		content,
		expectedRevision,
		beforeCommit: async () => { await snapshotProjectVersion(projectPath, "before-restore"); },
	});
	if (result.success) await pruneProjectVersions(projectPath).catch(error => console.warn("Could not prune project history:", error));
	return result;
}

export async function deleteProjectVersion(
	projectPath: string,
	versionPath: string,
	remove: (file: string) => Promise<void>,
) {
	const version = await verifiedVersionPath(projectPath, versionPath);
	await remove(version);
	const link = agentBackupLinkPath(version);
	if (link) {
		try {
			if ((await fs.lstat(link)).isFile()) await remove(link);
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
		}
	}
}

export async function projectVersionPaths(projectPath: string) {
	return (await listVersionFiles(projectPath)).map(entry => entry.path);
}

export async function withProjectVersionRename<T>(projectPath: string, targetPath: string, rename: () => Promise<T>) {
	if (filesystemKey(stripProjectExtension(projectPath)) === filesystemKey(stripProjectExtension(targetPath))) return rename();
	const versions = await projectVersionPaths(projectPath);
	const copied: string[] = [];
	let result: T;
	try {
		for (const version of versions) {
			const suffix = path.basename(version).slice(stripProjectExtension(path.basename(projectPath)).length);
			const destination = path.join(path.dirname(version), stripProjectExtension(path.basename(targetPath)) + suffix);
			await fs.copyFile(version, destination, constants.COPYFILE_EXCL);
			copied.push(destination);
		}
		result = await rename();
	} catch (error) {
		await Promise.allSettled(copied.map(file => fs.unlink(file)));
		throw error;
	}
	for (const version of versions) {
		await fs.unlink(version).catch(error => console.warn("Could not remove renamed history entry:", error));
	}
	return result;
}
