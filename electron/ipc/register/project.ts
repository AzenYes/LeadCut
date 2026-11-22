import { readAppEnv } from "../../envCompat";
import { uiText } from "../../uiI18n";
import { hasLegacyProjectExtension, stripProjectExtension } from "../../../src/lib/projectFileExtensions";
import { persistRecentMetadata } from "../project/recentMetadata";
import { registerProjectRelinkHandlers } from "./projectRelink";
import { prepareSeekableMedia } from "../project/seekableMedia";
import { renameLibraryProject } from "../project/renameLibraryProject";
import { trashLibraryProjects } from "../project/trashProjects";
import { getRecordingThumbnail } from "../recording/thumbnail";
import { deleteRecordingBundle, listRecordings, setRecordingsRemoved } from "../recording/library";
import { importRecording, discardRecordingImport } from "../recording/importRecording";
import { randomUUID } from "node:crypto";
import { constants as fsConstants } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { BrowserWindow, dialog, ipcMain, shell } from "electron";
import { RECORDINGS_DIR } from "../../appPaths";
import { buildMediaUrl, getMediaServerBaseUrl } from "../../mediaServer";
import { LEGACY_PROJECT_FILE_EXTENSIONS, PROJECT_FILE_EXTENSION } from "../constants";
import { getProjectBackupPath, withRenamedProjectBackup } from "../project/atomicSave";
import { acquireEditorLock, editorLockPath, releaseEditorLock } from "../project/editorLock";
import { assertProjectNotOpen } from "../../../services/leadcut-mcp/src/editorLock";
import { guardedSaveProject, ProjectRevisionConflict, verifyProjectRevision } from "../project/guardedSave";
import {
	deleteProjectVersion,
	listProjectVersions,
	pruneProjectVersions,
	readProjectVersion,
	restoreProjectVersion,
	snapshotAppVersionIfDue,
	withProjectVersionRename,
} from "../project/versionHistory";
import {
	getProjectsDir,
	createProjectFromRecording,
	convertLegacyLibraryProject,
	getProjectThumbnailPath,
	hasProjectFileExtension,
	isPathInsideDirectory,
	isTrustedProjectPath,
	listProjectLibraryEntries,
	loadProjectFromPath,
	readProjectPreview,
	loadRecentProjectPaths,
	persistRecordingsDirectorySetting,
	prepareProjectVersion,
	rememberApprovedLocalReadPath,
	rememberRecentProject,
	replaceApprovedSessionLocalReadPaths,
	resolveApprovedLocalMediaPath,
	saveProjectThumbnail,
	saveRecentProjectPaths,
	serializeProjectForSave,
} from "../project/manager";
import { persistRecordingSessionManifest, resolveRecordingSession } from "../project/session";
import {
	currentProjectPath,
	currentProjectRevision,
	currentRecordingSession,
	currentVideoPath,
	setCurrentProjectPath,
	setCurrentRecordingSession,
	setCurrentVideoPath,
} from "../state";
import {
	approveUserPath,
	getRecordingsDir,
	isAutoRecordingPath,
	normalizeVideoSourcePath,
	normalizePath,
	parseJsonWithByteOrderMark,
} from "../utils";

function projectSaveConflict(diskRevision: string | null) {
	return { success: false, conflict: true, diskRevision, message: uiText("projectChangedOnDisk") } as const;
}

function normalizeRecordingTimeOffsetMs(value: unknown): number {
	return typeof value === "number" && Number.isFinite(value) ? Math.round(value) : 0;
}

function normalizeBoolean(value: unknown, fallback = false): boolean {
	return typeof value === "boolean" ? value : fallback;
}

/**
 * Produces a filesystem-safe project base name without the project extension.
 */
function normalizeProjectSaveName(projectName?: string | null) {
	if (typeof projectName !== "string") {
		return null;
	}

	const trimmedName = projectName.trim();
	if (!trimmedName) {
		return null;
	}

	const withoutExtension = stripProjectExtension(trimmedName);
	const withoutInvalidFilesystemChars = withoutExtension.replace(/[<>:"/\\|?*]/g, "");
	const withoutControlChars = Array.from(withoutInvalidFilesystemChars)
		.filter((character) => character.charCodeAt(0) > 31)
		.join("");
	const sanitizedName = withoutControlChars
		.replace(/\s+/g, " ")
		.replace(/[. ]+$/g, "")
		.trim();

	return sanitizedName || null;
}

type NamedProjectSaveMode = "rename" | "copy";

function normalizeNamedProjectSaveMode(value: unknown): NamedProjectSaveMode {
	return value === "copy" ? "copy" : "rename";
}

/**
 * Extracts the persisted source video path from a saved project payload.
 */
function getProjectVideoPath(projectData: unknown) {
	if (!projectData || typeof projectData !== "object") {
		return null;
	}

	const candidate = projectData as { videoPath?: unknown };
	return typeof candidate.videoPath === "string" ? candidate.videoPath : null;
}

function getProjectId(projectData: unknown) {
	if (!projectData || typeof projectData !== "object") {
		return null;
	}

	const candidate = projectData as { projectId?: unknown };
	return typeof candidate.projectId === "string" && candidate.projectId.trim().length > 0
		? candidate.projectId
		: null;
}

function withProjectId(projectData: unknown, projectId: string) {
	if (!projectData || typeof projectData !== "object" || Array.isArray(projectData)) {
		return projectData;
	}

	return {
		...projectData,
		projectId,
	};
}

function ensureProjectDataHasProjectId(projectData: unknown) {
	const existingProjectId = getProjectId(projectData);
	if (existingProjectId) {
		return {
			projectId: existingProjectId,
			projectData,
		};
	}

	const projectId = randomUUID();
	return {
		projectId,
		projectData: withProjectId(projectData, projectId),
	};
}

async function resolveComparablePath(filePath: string) {
	return fs.realpath(filePath).catch(() => path.resolve(filePath));
}

/**
 * Prevents a named save from silently overwriting a different project file.
 */
async function ensureNamedProjectSaveDoesNotOverwriteDifferentProject(
	targetProjectPath: string,
	projectData: unknown,
	activeProjectPath?: string | null,
) {
	try {
		await fs.stat(targetProjectPath);
	} catch (error) {
		if ((error as NodeJS.ErrnoException)?.code === "ENOENT") {
			return { success: true };
		}
		throw error;
	}

	const targetResolvedPath = await resolveComparablePath(targetProjectPath);
	if (activeProjectPath) {
		const activeResolvedPath = await resolveComparablePath(activeProjectPath);
		if (activeResolvedPath === targetResolvedPath) {
			return { success: true };
		}
	}

	const incomingProjectId = getProjectId(projectData);
	const incomingVideoPath = getProjectVideoPath(projectData);

	try {
		const existingProjectRaw = await fs.readFile(targetProjectPath, "utf-8");
		const existingProjectData = parseJsonWithByteOrderMark(existingProjectRaw);
		const existingProjectId = getProjectId(existingProjectData);
		const existingVideoPath = getProjectVideoPath(existingProjectData);

		if (existingProjectId && incomingProjectId) {
			if (existingProjectId === incomingProjectId) {
				return { success: true };
			}

			return {
				success: false,
				message: uiText("aDifferentProjectAlreadyUsesThisName"),
			};
		}

		if (existingVideoPath && incomingVideoPath && existingVideoPath !== incomingVideoPath) {
			return {
				success: false,
				message: uiText("aDifferentProjectAlreadyUsesThisName"),
			};
		}

		if (!existingProjectId && !incomingProjectId && existingVideoPath && incomingVideoPath) {
			return {
				success: false,
				message: uiText("unableToVerifyProjectIdentityForTheChosenName"),
			};
		}

		return {
			success: false,
			message: uiText("unableToVerifyProjectIdentityForTheChosenName"),
		};
	} catch (error) {
		console.error("Failed to verify existing named project before overwrite:", error);
		return {
			success: false,
			message: uiText("unableToVerifyProjectIdentityForTheChosenName"),
		};
	}
}

export function registerProjectHandlers() {
	registerProjectRelinkHandlers();
	ipcMain.handle("save-cut-review-handoff", async (event, markdown: unknown, projectName: unknown) => {
		if (typeof markdown !== "string" || !markdown.trim()) return { success: false };
		try {
			const name = normalizeProjectSaveName(typeof projectName === "string" ? projectName : null) ?? "LeadCut";
			const parent = BrowserWindow.fromWebContents(event.sender);
			if (!parent) return { success: false };
			const result = await dialog.showSaveDialog(parent, {
				defaultPath: `${name.slice(0, 120)}-cut-review.md`,
				filters: [{ name: "Markdown", extensions: ["md"] }],
			});
			if (result.canceled || !result.filePath) return { success: false, canceled: true };
			if (path.extname(result.filePath).toLowerCase() === ".md") {
				await fs.writeFile(result.filePath, markdown, "utf8");
			} else {
				await fs.writeFile(`${result.filePath}.md`, markdown, { encoding: "utf8", flag: "wx" });
			}
			return { success: true };
		} catch {
			return { success: false };
		}
	});
	const handleProjectVersion = (channel: string, action: (projectPath: string, ...args: string[]) => Promise<object>) => {
		ipcMain.handle(channel, async (_, ...args: string[]) => {
			try {
				if (!currentProjectPath) throw new Error(uiText("noActiveProject"));
				return await action(currentProjectPath, ...args);
			} catch (error) {
				return { success: false, message: error instanceof Error ? error.message : String(error) };
			}
		});
	};
	handleProjectVersion("list-project-versions", async projectPath => ({
		success: true,
		versions: await listProjectVersions(projectPath),
	}));
	handleProjectVersion("read-project-version", async (projectPath, versionPath) => {
		const project = await readProjectVersion(projectPath, versionPath);
		await prepareProjectVersion(project, true);
		return { success: true, project };
	});
	handleProjectVersion("restore-project-version", async (projectPath, versionPath, expectedRevision) => {
		const revision = expectedRevision || currentProjectRevision;
		if (!revision) return projectSaveConflict(null);
		const result = await restoreProjectVersion(projectPath, versionPath, revision, project => prepareProjectVersion(project, false));
		if (!result.success) return projectSaveConflict(result.diskRevision);
		if (isTrustedProjectPath(projectPath)) setCurrentProjectPath(projectPath, result.revision);
		await saveProjectThumbnail(projectPath).catch(error => console.warn("Could not refresh restored project thumbnail:", error));
		return result;
	});
	handleProjectVersion("delete-project-version", async (projectPath, versionPath) => {
		await deleteProjectVersion(projectPath, versionPath, file => shell.trashItem(file));
		return { success: true };
	});
	handleProjectVersion("prune-project-versions", async projectPath => ({
		success: true,
		deleted: await pruneProjectVersions(projectPath),
	}));
	ipcMain.handle("convert-legacy-project-files", async () => {
		const converted: { from: string; to: string }[] = [];
		const errors: { path: string; message: string }[] = [];
		const { entries } = await listProjectLibraryEntries();
		for (const entry of entries) {
			if (!entry.isLegacyFormat) continue;
			try {
				if (entry.isCurrent) throw new Error(uiText("projectIsCurrentlyOpen"));
				const result = await convertLegacyLibraryProject(entry.path);
				converted.push({ from: result.convertedFrom, to: result.path });
			} catch (error) {
				errors.push({ path: entry.path, message: error instanceof Error ? error.message : String(error) });
			}
		}
		return { converted, errors };
	});
	ipcMain.handle("rename-library-project", async (_, source: string, name: string) => {
		try {
			const entries = await listProjectLibraryEntries();
			const projectPaths = entries.entries.map((entry) => entry.path);
			if (projectPaths.includes(source) && !isTrustedProjectPath(source)) await assertProjectNotOpen(source, false);
			const target = await renameLibraryProject(
				source,
				name,
				projectPaths,
				(value) => [getProjectThumbnailPath(value), getProjectBackupPath(value), editorLockPath(value)],
			);
			if (currentProjectPath && normalizePath(currentProjectPath) === normalizePath(source))
				setCurrentProjectPath(target, currentProjectRevision);
			const warning = await persistRecentMetadata(() => rememberRecentProject(target));
			return { success: true, path: target, warning };
		} catch (error) {
			return { success: false, error: String(error) };
		}
	});
	const imports = new Map<number, AbortController>();
	const pendingImports = new Map<number, Set<string>>();
	const watchedImportSenders = new WeakSet<Electron.WebContents>();
	const abandonImports = (owner: number) => {
		imports.get(owner)?.abort();
		const outputs = pendingImports.get(owner);
		pendingImports.delete(owner);
		void Promise.allSettled([...(outputs ?? [])].map(discardRecordingImport)).then(
			(results) => {
				for (const result of results)
					if (result.status === "rejected")
						console.warn("Could not discard abandoned import", result.reason);
			},
		);
	};
	ipcMain.handle("finish-recording-import", async (event, keepPath: string, commit = false) => {
		if (imports.has(event.sender.id))
			return { success: false, error: "Import is still running" };
		const outputs = pendingImports.get(event.sender.id);
		// Commit only after the renderer confirms that its project is still active.
		if (commit) outputs?.delete(keepPath);
		try {
			for (const output of outputs ?? []) {
				if (output === keepPath) continue;
				await discardRecordingImport(output);
				outputs?.delete(output);
			}
			if (!outputs?.size) pendingImports.delete(event.sender.id);
			return { success: true };
		} catch (error) {
			return { success: false, error: String(error) };
		}
	});
	ipcMain.handle("cancel-recording-import", (event) => {
		imports.get(event.sender.id)?.abort();
		return { success: true };
	});
	ipcMain.handle("get-recording-thumbnail", async (_, file: string) => {
		try {
			return { success: true, value: await getRecordingThumbnail(file) };
		} catch (error) {
			return { success: false, error: String(error) };
		}
	});
	ipcMain.handle("get-project-preview", async (_, projectPath: string) => {
		try {
			return { success: true, value: await readProjectPreview(projectPath) };
		} catch (error) {
			return { success: false, error: String(error) };
		}
	});
	ipcMain.handle("list-recordings", async (_, includeSources?: boolean) => {
		try {
			return { success: true, value: await listRecordings(includeSources === true) };
		} catch (error) {
			return { success: false, error: String(error) };
		}
	});
	ipcMain.handle("set-recordings-removed", async (_, paths: string[], removed: boolean) => {
		try {
			await setRecordingsRemoved(paths, removed);
			return { success: true, value: null };
		} catch (error) {
			return { success: false, error: String(error) };
		}
	});
	ipcMain.handle(
		"import-recording",
		async (
			event,
			currentPath: string,
			recordingPath: string,
			webcam?: import("../../../src/types/recordingLibrary").RecordingWebcamSource,
		) => {
			const owner = event.sender.id;
			if (!watchedImportSenders.has(event.sender)) {
				watchedImportSenders.add(event.sender);
				event.sender.once("destroyed", () => abandonImports(owner));
				event.sender.on("render-process-gone", () => abandonImports(owner));
				event.sender.on("did-start-navigation", (_event, _url, isInPlace, isMainFrame) => {
					if (isMainFrame && !isInPlace) abandonImports(owner);
				});
			}
			if (imports.has(owner))
				return { success: false, error: "An import is already running" };
			const controller = new AbortController();
			imports.set(owner, controller);
			try {
				const value = await importRecording(
					currentPath,
					recordingPath,
					webcam,
					controller.signal,
				);
				if (controller.signal.aborted || event.sender.isDestroyed()) {
					await discardRecordingImport(value.path);
					throw new Error("Import cancelled because its editor closed or reloaded");
				}
				const outputs = pendingImports.get(owner) ?? new Set<string>();
				outputs.add(value.path);
				pendingImports.set(owner, outputs);
				return { success: true, value };
			} catch (error) {
				return { success: false, error: String(error) };
			} finally {
				imports.delete(owner);
			}
		},
	);
	ipcMain.handle("reveal-in-folder", async (_, filePath: string) => {
		try {
			// shell.showItemInFolder doesn't return a value, it throws on error
			shell.showItemInFolder(filePath);
			return { success: true };
		} catch (error) {
			console.error(`Error revealing item in folder: ${filePath}`, error);
			// Fallback to open the directory if revealing the item fails
			// This might happen if the file was moved or deleted after export,
			// or if the path is somehow invalid for showItemInFolder
			try {
				const openPathResult = await shell.openPath(path.dirname(filePath));
				if (openPathResult) {
					// openPath returned an error message
					return { success: false, error: openPathResult };
				}
				return { success: true, message: uiText("couldNotRevealItemButOpenedDirectory") };
			} catch (openError) {
				console.error(`Error opening directory: ${path.dirname(filePath)}`, openError);
				return { success: false, error: String(error) };
			}
		}
	});

	ipcMain.handle("open-recordings-folder", async () => {
		try {
			const recordingsDir = await getRecordingsDir();
			const openPathResult = await shell.openPath(recordingsDir);
			if (openPathResult) {
				return {
					success: false,
					error: openPathResult,
					message: uiText("failedToOpenRecordingsFolder"),
				};
			}

			return { success: true };
		} catch (error) {
			console.error("Failed to open recordings folder:", error);
			return {
				success: false,
				error: String(error),
				message: uiText("failedToOpenRecordingsFolder"),
			};
		}
	});

	ipcMain.handle("get-recordings-directory", async () => {
		try {
			const recordingsDir = await getRecordingsDir();
			return {
				success: true,
				path: recordingsDir,
				isDefault: recordingsDir === RECORDINGS_DIR,
			};
		} catch (error) {
			return {
				success: false,
				path: RECORDINGS_DIR,
				isDefault: true,
				error: String(error),
			};
		}
	});

	ipcMain.handle("choose-recordings-directory", async () => {
		try {
			const current = await getRecordingsDir();
			const result = await dialog.showOpenDialog({
				title: uiText("chooseRecordingsFolder"),
				defaultPath: current,
				properties: ["openDirectory", "createDirectory", "promptToCreate"],
			});

			if (result.canceled || result.filePaths.length === 0) {
				return { success: false, canceled: true, path: current };
			}

			const selectedPath = path.resolve(result.filePaths[0]);
			await fs.mkdir(selectedPath, { recursive: true });
			await fs.access(selectedPath, fsConstants.W_OK);
			await persistRecordingsDirectorySetting(selectedPath);

			return {
				success: true,
				path: selectedPath,
				isDefault: selectedPath === RECORDINGS_DIR,
			};
		} catch (error) {
			return {
				success: false,
				error: String(error),
				message: uiText("failedToSetRecordingsFolder"),
			};
		}
	});

	ipcMain.handle(
		"save-project-file",
		async (
			_,
			projectData: unknown,
			suggestedName?: string,
			existingProjectPath?: string,
			thumbnailDataUrl?: string | null,
			expectedRevision?: string,
		) => {
			try {
				const projectsDir = await getProjectsDir();
				const preparedProject = ensureProjectDataHasProjectId(projectData);
				const trustedExistingProjectPath =
					existingProjectPath &&
					hasProjectFileExtension(existingProjectPath) &&
					(isTrustedProjectPath(existingProjectPath) ||
						isPathInsideDirectory(existingProjectPath, projectsDir))
						? path.resolve(existingProjectPath)
						: null;

				if (trustedExistingProjectPath) {
					const revision = expectedRevision ?? (isTrustedProjectPath(trustedExistingProjectPath) ? currentProjectRevision : null);
					if (!revision) return projectSaveConflict(null);
					const saved = await guardedSaveProject({
						projectPath: trustedExistingProjectPath,
						content: await serializeProjectForSave(preparedProject.projectData, trustedExistingProjectPath, thumbnailDataUrl),
						expectedRevision: revision,
						beforeCommit: () => snapshotAppVersionIfDue(trustedExistingProjectPath),
					});
					if (!saved.success) return projectSaveConflict(saved.diskRevision);
					setCurrentProjectPath(trustedExistingProjectPath, saved.revision);
					await saveProjectThumbnail(trustedExistingProjectPath, thumbnailDataUrl);
					await rememberRecentProject(trustedExistingProjectPath);
					return {
						success: true,
						path: trustedExistingProjectPath,
						revision: saved.revision,
						projectId: preparedProject.projectId,
						message: uiText("projectSavedSuccessfully"),
					};
				}

				if (existingProjectPath) {
					return {
						success: false,
						message:
							uiText("projectPathIsNoLongerTrustedUseSaveAsToChooseAProjectFile"),
					};
				}

				const safeName = normalizeProjectSaveName(suggestedName) || `project-${Date.now()}`;
				const defaultName = `${safeName}.${PROJECT_FILE_EXTENSION}`;

				const result = await dialog.showSaveDialog({
					title: uiText("saveLeadCutProject"),
					defaultPath: path.join(projectsDir, defaultName),
					filters: [
						{ name: uiText("leadcutProject"), extensions: [PROJECT_FILE_EXTENSION] },
						{ name: "JSON", extensions: ["json"] },
					],
					properties: ["createDirectory", "showOverwriteConfirmation"],
				});

				if (result.canceled || !result.filePath) {
					return {
						success: false,
						canceled: true,
						message: uiText("saveProjectCanceled"),
					};
				}

			const targetPath = result.filePath;
			const replacingActiveProject = currentProjectPath !== null &&
				await resolveComparablePath(targetPath) === await resolveComparablePath(currentProjectPath);
				const activeRevision = replacingActiveProject ? expectedRevision ?? currentProjectRevision : null;
				if (replacingActiveProject && !activeRevision) return projectSaveConflict(null);
				if (!replacingActiveProject) await assertProjectNotOpen(result.filePath, false);
				const saved = await guardedSaveProject({
					projectPath: result.filePath,
					content: await serializeProjectForSave(preparedProject.projectData, currentProjectPath ?? undefined, thumbnailDataUrl),
					expectedRevision: activeRevision,
				beforeCommit: hasProjectFileExtension(targetPath) ? () => snapshotAppVersionIfDue(targetPath) : undefined,
				});
				if (!saved.success) return projectSaveConflict(saved.diskRevision);
				setCurrentProjectPath(result.filePath, saved.revision);
				await saveProjectThumbnail(result.filePath, thumbnailDataUrl);
				await rememberRecentProject(result.filePath);

				return {
					success: true,
					path: result.filePath,
					revision: saved.revision,
					projectId: preparedProject.projectId,
					message: uiText("projectSavedSuccessfully"),
				};
			} catch (error) {
				console.error("Failed to save project file:", error);
				return {
					success: false,
					message: uiText("failedToSaveProjectFile"),
					error: String(error),
				};
			}
		},
	);

	ipcMain.handle(
		"save-project-file-named",
		async (
			_,
			projectData: unknown,
			projectName: string,
			thumbnailDataUrl?: string | null,
			mode?: unknown,
			expectedRevision?: string,
		) => {
			let destinationLock: string | null = null;
			let conversion: { from: string; path: string; revision: string } | undefined;
			try {
				const normalizedProjectName = normalizeProjectSaveName(projectName);
				if (!normalizedProjectName) {
					return {
						success: false,
						message: uiText("projectNameIsRequired"),
					};
				}

				const projectsDir = await getProjectsDir();
				const namedSaveMode = normalizeNamedProjectSaveMode(mode);
				let activeProjectPath = isTrustedProjectPath(currentProjectPath)
					? currentProjectPath
					: null;
				const targetProjectPath = path.join(
					namedSaveMode === "rename" && activeProjectPath
						? path.dirname(activeProjectPath)
						: projectsDir,
					`${normalizedProjectName}.${PROJECT_FILE_EXTENSION}`,
				);
				const activeRevision = expectedRevision ?? currentProjectRevision;
				if (activeProjectPath && namedSaveMode === "rename" && !activeRevision) return projectSaveConflict(null);
				if (activeProjectPath && namedSaveMode === "rename" && activeRevision && hasLegacyProjectExtension(activeProjectPath)) {
					await verifyProjectRevision(activeProjectPath, activeRevision);
					const converted = await convertLegacyLibraryProject(activeProjectPath, {
						expectedRevision: activeRevision,
						requireSameRevision: true,
					});
					conversion = { from: converted.convertedFrom, path: converted.path, revision: converted.revision };
					activeProjectPath = converted.path;
					setCurrentProjectPath(activeProjectPath, converted.revision);
				}
				const [activeResolvedPath, targetResolvedPath] = await Promise.all([
					activeProjectPath
						? resolveComparablePath(activeProjectPath)
						: Promise.resolve(null),
					resolveComparablePath(targetProjectPath),
				]);
				const isSavingToDifferentPath =
					!activeResolvedPath || activeResolvedPath !== targetResolvedPath;
				const preparedProject =
					namedSaveMode === "copy" && isSavingToDifferentPath
						? (() => {
								const projectId = randomUUID();
								return {
									projectId,
									projectData: withProjectId(projectData, projectId),
								};
							})()
						: ensureProjectDataHasProjectId(projectData);

				const overwriteCheck = await ensureNamedProjectSaveDoesNotOverwriteDifferentProject(
					targetProjectPath,
					preparedProject.projectData,
					activeProjectPath,
				);
				if (!overwriteCheck.success) {
					return { ...overwriteCheck, conversion };
				}

				const renamingFrom = namedSaveMode === "rename" && isSavingToDifferentPath ? activeProjectPath : null;
				if (renamingFrom && activeRevision) await verifyProjectRevision(renamingFrom, activeRevision);
				if (isSavingToDifferentPath) await assertProjectNotOpen(targetProjectPath, false);
				const saved = await guardedSaveProject({
					projectPath: targetProjectPath,
				content: await serializeProjectForSave(preparedProject.projectData, activeProjectPath ?? undefined, thumbnailDataUrl),
					expectedRevision: isSavingToDifferentPath ? null : activeRevision,
				beforeCommit: isSavingToDifferentPath ? undefined : () => snapshotAppVersionIfDue(targetProjectPath),
				});
				if (!saved.success) return { ...projectSaveConflict(saved.diskRevision), conversion };
				await saveProjectThumbnail(targetProjectPath, thumbnailDataUrl);
				await rememberRecentProject(targetProjectPath);

				if (renamingFrom && activeRevision) {
					await verifyProjectRevision(renamingFrom, activeRevision);
					if (readAppEnv("SMOKE_EXPORT") !== "1") {
						await acquireEditorLock(targetProjectPath);
						destinationLock = targetProjectPath;
					}
					await withRenamedProjectBackup(renamingFrom, targetProjectPath, () => withProjectVersionRename(renamingFrom, targetProjectPath, () => fs
						.unlink(renamingFrom)
						.catch((unlinkError: NodeJS.ErrnoException) => {
							if (unlinkError.code !== "ENOENT") {
								throw unlinkError;
							}
						})));
					await fs
						.rm(getProjectThumbnailPath(renamingFrom), { force: true })
						.catch(() => undefined);

					const recentProjectPaths = await loadRecentProjectPaths();
					const filteredRecentProjectPaths: string[] = [];
					for (const recentProjectPath of recentProjectPaths) {
						const recentResolvedPath = await resolveComparablePath(recentProjectPath);
						if (recentResolvedPath !== activeResolvedPath) {
							filteredRecentProjectPaths.push(recentProjectPath);
						}
					}
					await saveRecentProjectPaths(filteredRecentProjectPaths);
				}

				setCurrentProjectPath(targetProjectPath, saved.revision);
				destinationLock = null;

				return {
					success: true,
					path: targetProjectPath,
					revision: saved.revision,
					projectId: preparedProject.projectId,
					message: uiText("projectSavedSuccessfully"),
					conversion,
				};
			} catch (error) {
				if (destinationLock) await releaseEditorLock(destinationLock).catch(releaseError => console.warn("Could not release destination editor lock", releaseError));
				if (error instanceof ProjectRevisionConflict) return { ...projectSaveConflict(error.diskRevision), conversion };
				console.error("Failed to save named project file:", error);
				return {
					success: false,
					message: uiText("failedToSaveProjectFile"),
					error: String(error),
					conversion,
				};
			}
		},
	);

	ipcMain.handle("load-project-file", async () => {
		try {
			const projectsDir = await getProjectsDir();
			const result = await dialog.showOpenDialog({
				title: uiText("openLeadCutProject"),
				defaultPath: projectsDir,
				filters: [
					{
						name: uiText("leadcutProject"),
						extensions: [PROJECT_FILE_EXTENSION, ...LEGACY_PROJECT_FILE_EXTENSIONS],
					},
					{ name: "JSON", extensions: ["json"] },
					{ name: uiText("allFiles"), extensions: ["*"] },
				],
				properties: ["openFile"],
			});

			if (result.canceled || result.filePaths.length === 0) {
				return { success: false, canceled: true, message: uiText("openProjectCanceled") };
			}

			return await loadProjectFromPath(result.filePaths[0]);
		} catch (error) {
			console.error("Failed to load project file:", error);
			return {
				success: false,
				message: uiText("failedToLoadProjectFile"),
				error: String(error),
			};
		}
	});

	ipcMain.handle("load-current-project-file", async () => {
		try {
			if (!currentProjectPath) {
				return { success: false, message: uiText("noActiveProject") };
			}

			return await loadProjectFromPath(currentProjectPath);
		} catch (error) {
			console.error("Failed to load current project file:", error);
			return {
				success: false,
				message: uiText("failedToLoadCurrentProjectFile"),
				error: String(error),
			};
		}
	});

	ipcMain.handle("get-projects-directory", async () => {
		try {
			return {
				success: true,
				path: await getProjectsDir(),
			};
		} catch (error) {
			return {
				success: false,
				error: String(error),
			};
		}
	});

	ipcMain.handle(
		"create-project-file",
		async (_, projectData: unknown, thumbnailDataUrl?: string | null) => {
			try {
				const prepared = ensureProjectDataHasProjectId(projectData);
				const { target, revision } = await createProjectFromRecording(
					await getProjectsDir(),
					prepared.projectData,
					thumbnailDataUrl,
				);
				setCurrentProjectPath(target, revision);
				const warning = await persistRecentMetadata(() => rememberRecentProject(target));
				try {
					await saveProjectThumbnail(target, thumbnailDataUrl);
				} catch (error) {
					console.warn("Could not save project thumbnail", error);
				}
				return { success: true, path: target, projectId: prepared.projectId, revision, warning };
			} catch (error) {
				return { success: false, message: String(error) };
			}
		},
	);
	ipcMain.handle("trash-project-files", async (_, paths: unknown) => {
		try {
			const result = await trashLibraryProjects(paths, {
				list: listProjectLibraryEntries,
				trash: (filePath) => shell.trashItem(filePath),
				thumbnailPath: getProjectThumbnailPath,
			});
			if (currentProjectPath && result.deleted.includes(path.resolve(currentProjectPath))) {
				setCurrentProjectPath(null);
				setCurrentVideoPath(null);
				setCurrentRecordingSession(null);
			}
			const warning = await persistRecentMetadata(async () =>
				saveRecentProjectPaths(
					(await loadRecentProjectPaths()).filter(
						(p) => !result.deleted.includes(path.resolve(p)),
					),
				),
			);
			return { success: result.errors.length === 0, ...result, warning };
		} catch (error) {
			return { success: false, deleted: [], errors: [String(error)] };
		}
	});

	ipcMain.handle("list-project-files", async (event) => {
		try {
			const library = await listProjectLibraryEntries((ready) => {
				if (!event.sender.isDestroyed())
					event.sender.send("project-library-thumbnail-ready", ready);
			});
			return {
				success: true,
				projectsDir: library.projectsDir,
				entries: library.entries,
			};
		} catch (error) {
			return {
				success: false,
				projectsDir: null,
				entries: [],
				error: String(error),
			};
		}
	});

	ipcMain.handle("open-project-file-at-path", async (_, filePath: string) => {
		try {
			return await loadProjectFromPath(filePath);
		} catch (error) {
			console.error("Failed to open project file at path:", error);
			return {
				success: false,
				message: uiText("failedToOpenProjectFile"),
				error: String(error),
			};
		}
	});

	ipcMain.handle("open-projects-directory", async () => {
		try {
			const projectsDir = await getProjectsDir();
			const openPathResult = await shell.openPath(projectsDir);
			if (openPathResult) {
				return {
					success: false,
					error: openPathResult,
					message: uiText("failedToOpenProjectsFolder"),
				};
			}

			return { success: true, path: projectsDir };
		} catch (error) {
			console.error("Failed to open projects folder:", error);
			return {
				success: false,
				error: String(error),
				message: uiText("failedToOpenProjectsFolder"),
			};
		}
	});
	ipcMain.handle(
		"set-current-video-path",
		async (
			_,
			path: string,
			options?: { preserveProjectPath?: boolean; hideOverlayCursorByDefault?: boolean },
		) => {
			setCurrentVideoPath(normalizeVideoSourcePath(path) ?? path);
			approveUserPath(currentVideoPath);
			const resolvedSession = (await resolveRecordingSession(currentVideoPath)) ?? {
				videoPath: currentVideoPath!,
				webcamPath: null,
				timeOffsetMs: 0,
			};

			const nextSession = {
				...resolvedSession,
				hideOverlayCursorByDefault:
					normalizeBoolean(options?.hideOverlayCursorByDefault) ||
					normalizeBoolean(resolvedSession.hideOverlayCursorByDefault),
			};

			setCurrentRecordingSession(nextSession);
			if (options?.preserveProjectPath) {
				// Project loading already approved all independent video/audio sources.
				// Updating the primary recording must retain those project permissions.
				await rememberApprovedLocalReadPath(resolvedSession.videoPath);
				await rememberApprovedLocalReadPath(resolvedSession.webcamPath);
			} else {
				await replaceApprovedSessionLocalReadPaths([
					resolvedSession.videoPath,
					resolvedSession.webcamPath,
				]);
			}

			if (nextSession.webcamPath) {
				await persistRecordingSessionManifest(nextSession);
			}

			if (!options?.preserveProjectPath) {
				setCurrentProjectPath(null);
			}

			for (const window of BrowserWindow.getAllWindows()) {
				if (!window.isDestroyed()) {
					window.webContents.send("recording-session-changed", nextSession);
				}
			}

			return { success: true, webcamPath: nextSession.webcamPath ?? null };
		},
	);

	ipcMain.handle(
		"set-current-recording-session",
		async (
			_,
			session: {
				videoPath: string;
				webcamPath?: string | null;
				timeOffsetMs?: number;
				hideOverlayCursorByDefault?: boolean;
			},
			options?: { preserveProjectPath?: boolean },
		) => {
			const normalizedVideoPath =
				normalizeVideoSourcePath(session.videoPath) ?? session.videoPath;
			setCurrentVideoPath(normalizedVideoPath);
			setCurrentRecordingSession({
				videoPath: normalizedVideoPath,
				webcamPath: normalizeVideoSourcePath(session.webcamPath ?? null),
				timeOffsetMs: normalizeRecordingTimeOffsetMs(session.timeOffsetMs),
				hideOverlayCursorByDefault: normalizeBoolean(session.hideOverlayCursorByDefault),
			});
			await rememberApprovedLocalReadPath(currentRecordingSession!.videoPath);
			await rememberApprovedLocalReadPath(currentRecordingSession!.webcamPath);
			if (!options?.preserveProjectPath) {
				setCurrentProjectPath(null);
			}
			await persistRecordingSessionManifest(currentRecordingSession!);

			for (const window of BrowserWindow.getAllWindows()) {
				if (!window.isDestroyed()) {
					window.webContents.send("recording-session-changed", currentRecordingSession);
				}
			}

			return { success: true };
		},
	);

	ipcMain.handle("get-current-recording-session", () => {
		if (!currentRecordingSession) {
			return { success: false };
		}

		return {
			success: true,
			session: currentRecordingSession,
		};
	});

	ipcMain.handle("get-current-video-path", () => {
		return currentVideoPath ? { success: true, path: currentVideoPath } : { success: false };
	});

	ipcMain.handle("release-current-project", async () => {
		const releasedPath = currentProjectPath;
		if (releasedPath) await releaseEditorLock(releasedPath);
		setCurrentProjectPath(null);
		setCurrentVideoPath(null);
		setCurrentRecordingSession(null);
		return { success: true, path: releasedPath };
	});

	ipcMain.handle("clear-current-video-path", () => {
		setCurrentVideoPath(null);
		setCurrentRecordingSession(null);
		return { success: true };
	});

	ipcMain.handle("delete-recording-file", async (_, filePath: string) => {
		try {
			if (!filePath) {
				return { success: false, error: "Only auto-generated recordings can be deleted" };
			}
			const resolvedPath = await fs.realpath(filePath).catch(() => path.resolve(filePath));
			const recordingsDirRaw = await getRecordingsDir();
			const recordingsDir = await fs
				.realpath(recordingsDirRaw)
				.catch(() => path.resolve(recordingsDirRaw));
			if (
				!isPathInsideDirectory(resolvedPath, recordingsDir) ||
				!isAutoRecordingPath(resolvedPath)
			) {
				return { success: false, error: "Only auto-generated recordings can be deleted" };
			}
			await deleteRecordingBundle(resolvedPath);
			const currentResolved = currentVideoPath
				? await fs.realpath(currentVideoPath).catch(() => currentVideoPath)
				: null;
			if (currentResolved === resolvedPath) {
				setCurrentVideoPath(null);
				setCurrentRecordingSession(null);
			}
			return { success: true };
		} catch (error) {
			return { success: false, error: String(error) };
		}
	});

	ipcMain.handle("get-local-media-url", async (_, filePath: string) => {
		const baseUrl = getMediaServerBaseUrl();
		if (!baseUrl || !filePath) {
			return { success: false as const };
		}
		const resolved = await resolveApprovedLocalMediaPath(filePath);
		if (!resolved) {
			const normalized = path.resolve(filePath);
			console.warn(`[get-local-media-url] Blocked disallowed path: ${normalized}`);
			return { success: false as const };
		}
		const mediaPath = await prepareSeekableMedia(resolved).catch((error) => {
			console.warn("Could not index the preview copy, playing the original recording:", error);
			return resolved;
		});
		if (mediaPath !== resolved) await rememberApprovedLocalReadPath(mediaPath);
		return { success: true as const, url: buildMediaUrl(baseUrl, mediaPath) };
	});
}
