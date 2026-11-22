import { uiText } from "../../uiI18n";
import { appLog } from "../../logger";
import { hasKnownProjectExtension, hasLegacyProjectExtension, stripProjectExtension } from "../../../src/lib/projectFileExtensions";
import { assertProjectNotOpen } from "../../../services/leadcut-mcp/src/editorLock";
import { acquireEditorLock, releaseEditorLock } from "./editorLock";
import { convertLegacyProjectFile } from "./convertLegacyProject";
import { createHash, randomUUID } from "node:crypto";
import { decodeProjectThumbnail, readEmbeddedThumbnail, serializeProjectWithThumbnail } from "./embeddedThumbnail";
import { createProjectFirstFrameThumbnail } from "./firstFrameThumbnail";
import { createUntitledProject } from "./createUntitledProject";
import { computeProjectRevision } from "./projectRevision";
import { collectMissingProjectMedia } from "./relinkMediaFiles";
import { guardedSaveProject } from "./guardedSave";
import { snapshotAppVersionIfDue } from "./versionHistory";
import { relinkProjectMedia, type MediaRelinkMapping } from "../../../src/components/video-editor/projectRelink";
import { buildMediaUrl, getMediaServerBaseUrl } from "../../mediaServer";
import type { ProjectPreviewData } from "../../../src/types/projectPreview";
import { hasFreshProjectThumbnail } from "./thumbnailFreshness";
import { type Stats, existsSync, constants as fsConstants, realpathSync } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { app } from "electron";
import { RECORDINGS_DIR, USER_DATA_PATH } from "../../appPaths";
import { isSupportedLocalMediaPath } from "../../mediaTypes";
import {
	MAX_RECENT_PROJECTS,
	PROJECTS_DIRECTORY_NAME,
	RECENT_PROJECTS_FILE,
} from "../constants";
import { recordingPreferencesStore } from "../settings/recordingPreferencesStore";
import {
	approvedLocalReadPaths,
	currentProjectPath,
	setCurrentProjectPath,
	setCurrentRecordingSession,
	setCurrentVideoPath,
	setCustomRecordingsDir,
	setRecordingsDirLoaded,
} from "../state";
import type { ProjectLibraryEntry, RecordingSessionData } from "../types";
import {
	getRecordingsDir,
	normalizePath,
	normalizeVideoSourcePath,
	parseJsonWithByteOrderMark,
} from "../utils";

export { normalizePath, normalizeVideoSourcePath };
export { collectMissingProjectMedia };

export function getAssetRootPath() {
	if (app.isPackaged) {
		return path.join(process.resourcesPath, "assets");
	}

	return path.join(app.getAppPath(), "public");
}

export function isPathInsideDirectory(candidatePath: string, directoryPath: string) {
	const normalizedCandidatePath = normalizePath(candidatePath);
	const normalizedDirectoryPath = normalizePath(directoryPath);
	return (
		normalizedCandidatePath === normalizedDirectoryPath ||
		normalizedCandidatePath.startsWith(`${normalizedDirectoryPath}${path.sep}`)
	);
}

export function isAllowedLocalReadPath(candidatePath: string) {
	const allowedPrefixes = [
		RECORDINGS_DIR,
		USER_DATA_PATH,
		getAssetRootPath(),
		app.getPath("temp"),
	];
	const normalizedCandidatePath = normalizePath(candidatePath);

	// Canonicalize so a symlink placed under an allowed prefix can't smuggle in a
	// target that lives outside it. realpathSync throws when the path doesn't
	// exist yet (e.g. a pending export approved before the file is written) — in
	// that case fall back to the lexical path, which can only succeed via the
	// approvedLocalReadPaths check below since no symlink target exists yet.
	let canonicalCandidatePath = normalizedCandidatePath;
	try {
		canonicalCandidatePath = normalizePath(realpathSync(normalizedCandidatePath));
	} catch {
		// File may not exist yet; keep the lexical path.
	}

	// Security: only allow paths under app-managed directories or paths the user
	// has explicitly opted into (recording session sources, files chosen via
	// dialog, app-produced exports). The lexical path must satisfy the policy
	// AND the canonical (real) path must satisfy it too, so a symlink under an
	// allowed prefix that points outside the allowlist is rejected. Previously
	// this returned true for any existing file, which made the allowlist a no-op
	// for read-local-file and the local media URL handler.
	const lexicalAllowed =
		allowedPrefixes.some((prefix) => isPathInsideDirectory(normalizedCandidatePath, prefix)) ||
		approvedLocalReadPaths.has(normalizedCandidatePath);
	if (!lexicalAllowed) {
		return false;
	}

	if (canonicalCandidatePath === normalizedCandidatePath) {
		return true;
	}

	return (
		allowedPrefixes.some((prefix) => isPathInsideDirectory(canonicalCandidatePath, prefix)) ||
		approvedLocalReadPaths.has(canonicalCandidatePath)
	);
}

// Keep loopback media-server access restricted to allowlisted or explicitly
// approved files. Direct renderer-side read-local-file calls can be more
// permissive, but URL-based serving must stay scoped so arbitrary paths do not
// become fetchable inside the app.
export async function isAllowedLocalMediaPath(candidatePath: string) {
	const normalizedCandidatePath = normalizePath(candidatePath);
	return isAllowedLocalReadPath(normalizedCandidatePath);
}

async function collectApprovedLocalReadPaths(filePath?: string | null): Promise<string[]> {
	const normalizedPath = normalizeVideoSourcePath(filePath);
	if (!normalizedPath) {
		return [];
	}

	const approvedPaths = [normalizePath(normalizedPath)];

	try {
		const realPath = await fs.realpath(approvedPaths[0]);
		const normalizedRealPath = normalizePath(realPath);
		if (!approvedPaths.includes(normalizedRealPath)) {
			approvedPaths.push(normalizedRealPath);
		}
	} catch {
		// Ignore missing files; the eventual read will surface the real error.
	}

	return approvedPaths;
}

export async function rememberApprovedLocalReadPath(filePath?: string | null) {
	const normalizedPath = normalizeVideoSourcePath(filePath);
	if (!normalizedPath) {
		return;
	}

	const approvedPaths = await collectApprovedLocalReadPaths(normalizedPath);
	for (const approvedPath of approvedPaths) {
		approvedLocalReadPaths.add(approvedPath);
	}
}

export async function resolveApprovedLocalMediaPath(candidatePath: string): Promise<string | null> {
	const normalizedCandidatePath = normalizePath(candidatePath);
	const realPath = await fs.realpath(normalizedCandidatePath).catch(() => null);

	if (!realPath) {
		return null;
	}

	const stat = await fs.stat(realPath).catch(() => null);
	if (!stat?.isFile() || !isSupportedLocalMediaPath(realPath)) {
		return null;
	}

	if (!(await isAllowedLocalMediaPath(realPath))) {
		return null;
	}

	await rememberApprovedLocalReadPath(candidatePath);
	return realPath;
}

export async function replaceApprovedSessionLocalReadPaths(
	filePaths: Array<string | null | undefined>,
) {
	const nextApprovedPaths = new Set<string>();
	const approvedPathLists = await Promise.all(
		filePaths.map((filePath) => collectApprovedLocalReadPaths(filePath)),
	);

	for (const approvedPathList of approvedPathLists) {
		for (const approvedPath of approvedPathList) {
			nextApprovedPaths.add(approvedPath);
		}
	}

	approvedLocalReadPaths.clear();
	for (const approvedPath of nextApprovedPaths) {
		approvedLocalReadPaths.add(approvedPath);
	}
}

export async function resolveProjectMediaSources(
	project: unknown,
): Promise<
	| { success: true; videoPath: string; webcamPath: string | null }
	| { success: false; message: string }
> {
	if (!project || typeof project !== "object") {
		return { success: false, message: uiText("invalidProjectFileFormat") };
	}

	const rawVideoPath = (project as { videoPath?: unknown }).videoPath;
	if (typeof rawVideoPath !== "string") {
		return { success: false, message: uiText("projectFileIsMissingAVideoPath") };
	}

	const normalizedVideoPath = normalizeVideoSourcePath(rawVideoPath);
	if (!normalizedVideoPath) {
		return { success: false, message: uiText("projectFileIsMissingAValidVideoPath") };
	}

	try {
		await fs.access(normalizedVideoPath, fsConstants.F_OK);
	} catch {
		return {
			success: false,
			message: uiText("projectVideoFileNotFoundValue", { value0: normalizedVideoPath }),
		};
	}

	const rawWebcamPath =
		typeof (project as { editor?: { webcam?: { sourcePath?: unknown } } }).editor?.webcam
			?.sourcePath === "string"
			? ((project as { editor?: { webcam?: { sourcePath?: string } } }).editor?.webcam
					?.sourcePath ?? null)
			: null;
	const normalizedWebcamPath = normalizeVideoSourcePath(rawWebcamPath);

	if (!normalizedWebcamPath) {
		return {
			success: true,
			videoPath: normalizedVideoPath,
			webcamPath: null,
		};
	}

	try {
		await fs.access(normalizedWebcamPath, fsConstants.F_OK);
		return {
			success: true,
			videoPath: normalizedVideoPath,
			webcamPath: normalizedWebcamPath,
		};
	} catch {
		return {
			success: true,
			videoPath: normalizedVideoPath,
			webcamPath: null,
		};
	}
}

export async function getProjectsDir() {
	const projectsDir = path.join(await getRecordingsDir(), PROJECTS_DIRECTORY_NAME);
	await fs.mkdir(projectsDir, { recursive: true });
	return projectsDir;
}

export async function persistRecordingsDirectorySetting(nextDir: string) {
	const recordingsDir = path.resolve(nextDir);
	await recordingPreferencesStore.update({ recordingsDir });
	setCustomRecordingsDir(recordingsDir);
	setRecordingsDirLoaded(true);
}

export const hasProjectFileExtension = hasKnownProjectExtension;

export function getProjectThumbnailPath(projectPath: string) {
	const key = process.platform === "win32" ? path.resolve(projectPath).toLowerCase() : path.resolve(projectPath);
	return path.join(USER_DATA_PATH, "project-thumbnails", `${createHash("sha256").update(key).digest("hex")}.png`);
}

export async function saveProjectThumbnail(projectPath: string, thumbnailDataUrl?: string | null) {
	const thumbnailPath = getProjectThumbnailPath(projectPath);
	if (thumbnailDataUrl === undefined) {
		const embedded = await readEmbeddedThumbnail(projectPath);
		if (!embedded) return existsSync(thumbnailPath) ? thumbnailPath : null;
		thumbnailDataUrl = `data:image/png;base64,${embedded.toString("base64")}`;
	}

	if (!thumbnailDataUrl) {
		await fs.rm(thumbnailPath, { force: true }).catch(() => undefined);
		await fs.rm(`${projectPath}.preview.png`, { force: true }).catch(() => undefined);
		return null;
	}

	const png = decodeProjectThumbnail(thumbnailDataUrl);
	if (!png) {
		throw new Error("Project thumbnail must be a PNG data URL.");
	}

	await fs.mkdir(path.dirname(thumbnailPath), { recursive: true });
	const temporary = `${thumbnailPath}.${randomUUID()}.tmp`;
	try {
		await fs.writeFile(temporary, png, { flag: "wx" });
		await fs.rename(temporary, thumbnailPath);
	} finally { await fs.rm(temporary, { force: true }).catch(() => undefined); }
	// Remove the old adjacent image only after the preview is safely embedded.
	if (await readEmbeddedThumbnail(projectPath)) await fs.rm(`${projectPath}.preview.png`, { force: true }).catch(() => undefined);
	return thumbnailPath;
}

export async function loadRecentProjectPaths() {
	try {
		const content = await fs.readFile(RECENT_PROJECTS_FILE, "utf-8");
		const parsed = parseJsonWithByteOrderMark<{ paths?: unknown }>(content);
		return Array.isArray(parsed.paths)
			? parsed.paths.filter(
					(value): value is string =>
						typeof value === "string" && value.trim().length > 0,
				)
			: [];
	} catch {
		return [];
	}
}

export async function saveRecentProjectPaths(paths: string[]) {
	const normalizedPaths = Array.from(new Set(paths.map((value) => normalizePath(value)))).slice(
		0,
		MAX_RECENT_PROJECTS,
	);
	await fs.writeFile(
		RECENT_PROJECTS_FILE,
		JSON.stringify({ paths: normalizedPaths }, null, 2),
		"utf-8",
	);
}

export async function rememberRecentProject(projectPath: string) {
	if (!hasProjectFileExtension(projectPath)) {
		return;
	}

	const existingPaths = await loadRecentProjectPaths();
	await saveRecentProjectPaths([projectPath, ...existingPaths]);
}

export type ProjectThumbnailReady = { path: string; thumbnailPath: string; updatedAt: number };
const thumbnailJobs = new Map<string, Promise<ProjectThumbnailReady | null>>();

function sameProjectRevision(left: Stats, right: Stats) {
	return (
		left.mtimeMs === right.mtimeMs &&
		left.ctimeMs === right.ctimeMs &&
		left.size === right.size &&
		left.ino === right.ino &&
		left.dev === right.dev
	);
}

async function generateProjectSourceThumbnail(project: unknown) {
	if (!isLoadableProjectData(project)) return null;
	const media = await resolveProjectMediaSources(project);
	return media.success ? createProjectFirstFrameThumbnail(path.resolve(media.videoPath)) : null;
}

export function serializeProjectForSave(project: unknown, previousPath?: string, thumbnail?: string | null) {
	return serializeProjectWithThumbnail(project, previousPath, thumbnail, async () => {
		try {
			return await generateProjectSourceThumbnail(project);
		} catch (error) {
			// A missing/undecodable frame should never prevent saving the edit.
			appLog("warn", "project-thumbnail", "Could not generate a preview frame for a saved project", String(error));
			return null;
		}
	});
}

export async function createProjectFromRecording(directory: string, project: unknown, thumbnail?: string | null) {
	const content = await serializeProjectForSave(project, undefined, thumbnail);
	const target = await createUntitledProject(directory, content);
	return { target, revision: computeProjectRevision(content) };
}

export function refreshProjectThumbnail(projectPath: string, revision: Stats) {
	const pending = thumbnailJobs.get(projectPath);
	if (pending) return pending;
	const task = (async (): Promise<ProjectThumbnailReady | null> => {
		const thumbnailPath = getProjectThumbnailPath(projectPath);
		let temporary: string | undefined;
		try {
			if (!sameProjectRevision(revision, await fs.stat(projectPath))) return null;
			const project = parseJsonWithByteOrderMark(await fs.readFile(projectPath, "utf-8"));
			if (!isLoadableProjectData(project)) return null;
			let thumbnail = decodeProjectThumbnail((project as Record<string, unknown>).thumbnailPng);
			thumbnail ??= await generateProjectSourceThumbnail(project);
			if (!thumbnail) return null;
			if (!sameProjectRevision(revision, await fs.stat(projectPath))) return null;
			if (!(await hasFreshProjectThumbnail(thumbnailPath, revision.mtimeMs))) {
				temporary = `${thumbnailPath}.${randomUUID()}.tmp`;
				await fs.mkdir(path.dirname(thumbnailPath), { recursive: true });
				await fs.writeFile(temporary, thumbnail, { flag: "wx" });
				// Stamp the source revision, rather than generation time, so a later edit invalidates it.
				await fs.utimes(temporary, new Date(), Math.ceil(revision.mtimeMs) / 1000);
				if (!sameProjectRevision(revision, await fs.stat(projectPath))) return null;
				// Rename replaces a sidecar symlink itself; it never writes through its target.
				await fs.rename(temporary, thumbnailPath);
			}
			return { path: projectPath, thumbnailPath, updatedAt: revision.mtimeMs };
		} catch {
			// Offline, corrupt or deleted media must not hold up the library.
			return null;
		} finally {
			if (temporary) await fs.rm(temporary, { force: true }).catch(() => undefined);
		}
	})().finally(() => thumbnailJobs.delete(projectPath));
	thumbnailJobs.set(projectPath, task);
	return task;
}

export async function buildProjectLibraryEntry(
	projectPath: string,
	projectsDir: string,
	onThumbnailReady?: (ready: ProjectThumbnailReady) => void,
): Promise<ProjectLibraryEntry | null> {
	try {
		const normalizedPath = normalizePath(projectPath);
		if (!hasProjectFileExtension(normalizedPath)) {
			return null;
		}

		const stats = await fs.stat(normalizedPath);
		if (!stats.isFile()) {
			return null;
		}

		const thumbnailPath = getProjectThumbnailPath(normalizedPath);
		const thumbnailExists = await hasFreshProjectThumbnail(thumbnailPath, stats.mtimeMs);
		if (!thumbnailExists) {
			void refreshProjectThumbnail(normalizedPath, stats)
				.then((ready) => {
					if (ready) onThumbnailReady?.(ready);
				})
				.catch(() => undefined);
		}

		return {
			path: normalizedPath,
			name: stripProjectExtension(path.basename(normalizedPath)),
			isLegacyFormat: hasLegacyProjectExtension(normalizedPath),
			updatedAt: stats.mtimeMs,
			createdAt: stats.birthtimeMs || stats.ctimeMs,
			thumbnailPath: thumbnailExists ? thumbnailPath : null,
			isCurrent: Boolean(
				currentProjectPath && normalizePath(currentProjectPath) === normalizedPath,
			),
			isInProjectsDirectory: path.dirname(normalizedPath) === normalizePath(projectsDir),
		};
	} catch {
		return null;
	}
}

export async function listProjectLibraryEntries(
	onThumbnailReady?: (ready: ProjectThumbnailReady) => void,
) {
	const projectsDir = await getProjectsDir();
	const projectPaths: string[] = [];

	try {
		const entries = await fs.readdir(projectsDir, { withFileTypes: true });
		for (const entry of entries) {
			if (!entry.isFile()) {
				continue;
			}

			const entryPath = path.join(projectsDir, entry.name);
			if (hasProjectFileExtension(entryPath)) {
				projectPaths.push(entryPath);
			}
		}
	} catch {
		// Ignore directory read failures and fall back to recent files.
	}

	const recentProjectPaths = await loadRecentProjectPaths();
	const candidatePaths = Array.from(new Set([...projectPaths, ...recentProjectPaths]));
	const entries = (
		await Promise.all(
			candidatePaths.map((candidatePath) =>
				buildProjectLibraryEntry(candidatePath, projectsDir, onThumbnailReady),
			),
		)
	)
		.filter((entry): entry is ProjectLibraryEntry => entry != null)
		.sort((left, right) => right.updatedAt - left.updatedAt);

	await saveRecentProjectPaths(entries.map((entry) => entry.path));

	return {
		projectsDir,
		entries,
	};
}

function isLoadableProjectData(projectData: unknown) {
	if (!projectData || typeof projectData !== "object" || Array.isArray(projectData)) {
		return false;
	}

	const candidate = projectData as {
		version?: unknown;
		projectId?: unknown;
		videoPath?: unknown;
		editor?: unknown;
	};

	return (
		typeof candidate.version === "number" &&
		(candidate.projectId === undefined || typeof candidate.projectId === "string") &&
		typeof candidate.videoPath === "string" &&
		candidate.videoPath.trim().length > 0 &&
		candidate.editor != null &&
		typeof candidate.editor === "object" &&
		!Array.isArray(candidate.editor)
	);
}

/** Read a listed project's preview without changing the active project or recording session. */
export async function readProjectPreview(projectPath: string): Promise<ProjectPreviewData> {
	if (typeof projectPath !== "string") throw new Error(uiText("invalidProjectPath"));
	const normalizedPath = normalizePath(projectPath);
	const { entries } = await listProjectLibraryEntries();
	if (!entries.some((entry) => entry.path === normalizedPath))
		throw new Error(uiText("projectIsNotInTheLibrary"));
	const project = parseJsonWithByteOrderMark(await fs.readFile(normalizedPath, "utf-8"));
	if (!isLoadableProjectData(project)) throw new Error(uiText("invalidProjectFileFormat"));
	const media = await resolveProjectMediaSources(project);
	if (!media.success) throw new Error(media.message);
	const baseUrl = getMediaServerBaseUrl();
	if (!baseUrl) throw new Error(uiText("mediaServerIsNotReady"));
	await rememberApprovedLocalReadPath(media.videoPath);
	if (media.webcamPath) await rememberApprovedLocalReadPath(media.webcamPath);
	return {
		project: project as ProjectPreviewData["project"],
		videoUrl: buildMediaUrl(baseUrl, media.videoPath),
		webcamUrl: media.webcamPath ? buildMediaUrl(baseUrl, media.webcamPath) : null,
	};
}

async function readValidatedProject(normalizedPath: string, checkMissing = false) {
	let project: unknown;
	let revision: string;
	try {
		const content = await fs.readFile(normalizedPath, "utf-8");
		project = parseJsonWithByteOrderMark(content);
		revision = computeProjectRevision(content);
	} catch (error) {
		appLog("error", "project-open", "Could not read project file.",
			error instanceof SyntaxError ? normalizedPath : error);
		return {
			success: false as const,
			canceled: false,
			message: uiText("failedToReadProjectFileValue", { value0: error instanceof Error ? error.message : String(error) }),
		};
	}
	if (checkMissing && isLoadableProjectData(project)) {
		const missing = await collectMissingProjectMedia(project);
		if (missing.length > 0) {
			return {
				success: false as const,
				code: "media-missing" as const,
				path: normalizedPath,
				project,
				revision,
				missing,
				message: uiText("relinkMissingMedia"),
			};
		}
	}
	return validateProjectMedia(project, revision);
}

async function validateProjectMedia(project: unknown, revision: string) {
	if (!isLoadableProjectData(project)) {
		return { success: false as const, message: uiText("invalidProjectFileFormat") };
	}
	const mediaSources = await resolveProjectMediaSources(project);

	if (!mediaSources.success) {
		return {
			success: false as const,
			canceled: false,
			message: mediaSources.message,
		};
	}
	return { success: true as const, project, revision, mediaSources };
}

type ValidatedProject = Extract<Awaited<ReturnType<typeof readValidatedProject>>, { success: true }>;

export async function convertLegacyLibraryProject(
	projectPath: string,
	options: { source?: ValidatedProject; expectedRevision?: string; requireSameRevision?: boolean } = {},
) {
	const normalizedPath = normalizePath(projectPath);
	const source = options.source ?? await readValidatedProject(normalizedPath);
	if (!source.success) throw new Error(source.message);
	const active = currentProjectPath && normalizePath(currentProjectPath) === normalizedPath;
	await acquireEditorLock(normalizedPath);
	let loaded = source;
	try {
		const converted = await convertLegacyProjectFile(normalizedPath, {
			expectedRevision: options.expectedRevision ?? source.revision,
			finalize: async (target, reused) => {
				await assertProjectNotOpen(target, false);
				if (reused) {
					const existing = await readValidatedProject(target);
					if (!existing.success) throw new Error(existing.message);
					if (options.requireSameRevision && existing.revision !== source.revision) {
						throw new Error(uiText("projectChangedOnDisk"));
					}
					loaded = existing;
				}
				const thumbnail = await saveProjectThumbnail(target);
				if (!thumbnail) await refreshProjectThumbnail(target, await fs.stat(target));
				try {
					const recent = await loadRecentProjectPaths();
					await saveRecentProjectPaths([
						target,
						...recent.filter(previous => normalizePath(previous) !== normalizedPath),
					]);
				} catch (error) {
					if (!reused) await fs.rm(getProjectThumbnailPath(target), { force: true }).catch(() => undefined);
					throw error;
				}
			},
		});
		await Promise.all([
			fs.rm(getProjectThumbnailPath(normalizedPath), { force: true }).catch(() => undefined),
			fs.rm(`${normalizedPath}.preview.png`, { force: true }).catch(() => undefined),
		]);
		return { ...loaded, ...converted };
	} finally {
		if (!active) await releaseEditorLock(normalizedPath).catch(error => console.warn("Could not release legacy project lock", error));
	}
}

async function approveProjectMedia({ project, mediaSources }: ValidatedProject) {
	const projectObj = project as Record<string, unknown>;
	const editorObj = projectObj?.editor as Record<string, unknown> | undefined;
	const audioTracks = editorObj?.audioTracks as { sourcePath?: unknown }[] | undefined;
	const audioRegions = editorObj?.audioRegions as { audioPath?: unknown }[] | undefined;
	const videoRegions = editorObj?.videoRegions as { sourcePath?: unknown }[] | undefined;
	const approvedProjectPaths: Array<string | null | undefined> = [
		mediaSources.videoPath,
		mediaSources.webcamPath,
	];
	if (Array.isArray(audioTracks)) {
		for (const track of audioTracks) {
			if (typeof track?.sourcePath === "string") {
				approvedProjectPaths.push(track.sourcePath);
			}
		}
	}
	if (Array.isArray(audioRegions)) {
		for (const region of audioRegions) {
			if (typeof region?.audioPath === "string") {
				approvedProjectPaths.push(region.audioPath);
			}
		}
	}
	await replaceApprovedSessionLocalReadPaths(approvedProjectPaths);
	if (Array.isArray(videoRegions)) {
		for (const region of videoRegions) {
			if (typeof region?.sourcePath === "string") await rememberApprovedLocalReadPath(region.sourcePath);
		}
	}
}

export async function prepareProjectVersion(project: unknown, approveMedia: boolean) {
	const result = await validateProjectMedia(project, "");
	if (!result.success) throw new Error(result.message);
	if (approveMedia) await approveProjectMedia(result);
}

export async function loadProjectFromPath(projectPath: string) {
	let normalizedPath = normalizePath(projectPath);
	const source = await readValidatedProject(normalizedPath, true);
	if (!source.success) return source;
	let loaded = source;
	let convertedFrom: string | undefined;
	let conversionFailed = false;
	if (hasLegacyProjectExtension(normalizedPath)) {
		try {
			const converted = await convertLegacyLibraryProject(normalizedPath, { source });
			loaded = converted;
			normalizedPath = converted.path;
			convertedFrom = converted.convertedFrom;
		} catch (error) {
			conversionFailed = true;
			console.warn("Could not convert legacy project:", error);
		}
	}
	const { project, revision, mediaSources } = loaded;
	await approveProjectMedia(loaded);
	if (!convertedFrom) await rememberRecentProject(normalizedPath);

	setCurrentProjectPath(normalizedPath, revision);
	setCurrentVideoPath(mediaSources.videoPath);
	setCurrentRecordingSession({
		videoPath: mediaSources.videoPath,
		webcamPath: mediaSources.webcamPath,
		timeOffsetMs: 0,
	} as RecordingSessionData);

	return {
		success: true,
		path: normalizedPath,
		revision,
		project,
		convertedFrom,
		conversionFailed,
	};
}

export async function saveRelinkedProjectMedia(
	projectPath: string,
	expectedRevision: string,
	mapping: MediaRelinkMapping,
	isPickedPath: (path: string) => boolean,
) {
	const originalPath = normalizePath(projectPath);
	const source = await readValidatedProject(originalPath, true);
	if (!("code" in source) || source.code !== "media-missing") {
		return { success: false as const, message: uiText("relinkReopenProject") };
	}
	if (source.revision !== expectedRevision) {
		return { success: false as const, message: uiText("projectChangedOnDisk") };
	}
	const missingPaths = new Set(source.missing.map(({ path }) => path));
	const mainPath = source.missing.find(({ kind }) => kind === "video")?.path;
	for (const [previous, replacement] of Object.entries(mapping)) {
		if (!missingPaths.has(previous) ||
			(replacement === null ? previous === mainPath : typeof replacement !== "string" || !isPickedPath(replacement))) {
			return { success: false as const, message: uiText("relinkChooseFile") };
		}
	}
	const project = relinkProjectMedia(source.project, mapping);
	if ((await collectMissingProjectMedia(project)).length > 0) {
		return { success: false as const, message: uiText("relinkMissingMediaDescription") };
	}

	let destination = originalPath;
	const locks = new Set<string>();
	const save = async (target: string) => {
		if (!locks.has(target)) {
			await acquireEditorLock(target);
			locks.add(target);
		}
		const result = await guardedSaveProject({
			projectPath: target,
			content: await serializeProjectForSave(project, target),
			expectedRevision,
			beforeCommit: () => snapshotAppVersionIfDue(target),
		});
		if (!result.success) throw new Error(uiText("projectChangedOnDisk"));
	};
	try {
		if (hasLegacyProjectExtension(originalPath)) {
			await acquireEditorLock(originalPath);
			locks.add(originalPath);
			const converted = await convertLegacyProjectFile(originalPath, {
				expectedRevision,
				finalize: save,
			});
			destination = converted.path;
		} else {
			await save(originalPath);
		}
		const result = await loadProjectFromPath(destination);
		return result.success && destination !== originalPath ? { ...result, convertedFrom: originalPath } : result;
	} finally {
		await Promise.all([...locks].filter(file => file !== currentProjectPath).map(file =>
			releaseEditorLock(file).catch(error => console.warn("Could not release relink project lock:", error)),
		));
	}
}

export function isTrustedProjectPath(filePath?: string | null): boolean {
	if (!filePath || !currentProjectPath) return false;
	return normalizePath(filePath) === normalizePath(currentProjectPath);
}
