import { useUiText } from "@/i18n/useUiText";
import { logError, logWarn } from "@/lib/appLog";
import { moveProjectFolderReferences } from "../dashboard/useProjectFolders";
import { type RefObject, useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { toast } from "@/components/ui/toast";
import { createProjectData, type EditorProjectData } from "../projectPersistence";
import type { useProjectState } from "../state/useProjectState";
import { cloneStructured, getErrorMessage } from "../videoEditorUtils";

const PROJECT_AUTOSAVE_DELAY_MS = 500;

type SaveProjectOptions = {
	silent?: boolean;
	remountPreviewAfterSave?: boolean;
	refreshLibraryAfterSave?: boolean;
	captureThumbnail?: boolean;
};

type UseProjectSaveActionsInput = {
	project: ReturnType<typeof useProjectState>;
	currentSourcePath: string | null;
	currentProjectSnapshot: EditorProjectData | null;
	currentPersistedEditorState: Parameters<typeof createProjectData>[1];
	projectDisplayName: string;
	hasUnsavedChanges: boolean;
	projectSaveDialogInputRef: RefObject<HTMLInputElement | null>;
	projectNameInputRef: RefObject<HTMLInputElement | null>;
	openProjectSaveDialog: (initialName: string) => Promise<boolean>;
	resolveProjectSaveDialog: (saved: boolean) => void;
	captureProjectThumbnail: () => Promise<string | null>;
	refreshProjectLibrary: () => Promise<void>;
	remountPreview: () => void;
};

export function useProjectSaveActions({
	project,
	currentSourcePath,
	currentProjectSnapshot,
	currentPersistedEditorState,
	projectDisplayName,
	hasUnsavedChanges,
	projectSaveDialogInputRef,
	projectNameInputRef,
	resolveProjectSaveDialog,
	captureProjectThumbnail,
	refreshProjectLibrary,
	remountPreview,
}: UseProjectSaveActionsInput) {
	const uiText = useUiText();
	const {
		currentProjectPath,
		currentProjectRevisionRef,
		lastSavedSnapshot,
		projectSaveDialogDraft,
		projectNameDraft,
		setCurrentProjectPath,
		setLastSavedSnapshot,
		setIsSavingProjectDialog,
		setProjectNameDraft,
		setIsEditingProjectName,
		setIsSavingProjectName,
		setProjectBrowserOpen,
	} = project;
	const [saveFeedback, setSaveFeedback] = useState<{ saving: boolean; error: string | null; savedAt: number | null }>({ saving: false, error: null, savedAt: null });
	const savingNameRef = useRef(false);
	const activePathRef = useRef(currentProjectPath);
	const activeSourceRef = useRef(currentSourcePath);
	useLayoutEffect(() => {
		if (activePathRef.current !== currentProjectPath) {
			saveGenerationRef.current += 1;
			setSaveFeedback({ saving: false, error: null, savedAt: null });
		}
		activePathRef.current = currentProjectPath;
	}, [currentProjectPath]);
	useLayoutEffect(() => {
		if (activeSourceRef.current !== currentSourcePath) {
			saveGenerationRef.current += 1;
			setSaveFeedback({ saving: false, error: null, savedAt: null });
		}
		activeSourceRef.current = currentSourcePath;
	}, [currentSourcePath]);
	const autosaveTimeoutRef = useRef<number | null>(null);
	const saveQueueRef = useRef<Promise<unknown>>(Promise.resolve());
	const saveGenerationRef = useRef(0);
	const savesSuspendedRef = useRef(false);
	const previewReadOnlyRef = useRef(false);
	const [previewReadOnly, setPreviewReadOnly] = useState(false);
	const conflictedProjectRef = useRef<{ path: string; revision: string | null } | null>(null);
	const [saveResumeRevision, setSaveResumeRevision] = useState(0);
	const clearPendingAutosave = useCallback(() => {
		if (autosaveTimeoutRef.current !== null) {
			window.clearTimeout(autosaveTimeoutRef.current);
			autosaveTimeoutRef.current = null;
		}
	}, []);
	const isPreviewReadOnly = useCallback(() => previewReadOnlyRef.current, []);
	const setVersionPreviewReadOnly = useCallback((readOnly: boolean) => {
		previewReadOnlyRef.current = readOnly;
		setPreviewReadOnly(readOnly);
		clearPendingAutosave();
	}, [clearPendingAutosave]);
	const isOverwriteBlocked = useCallback((path: string | null) => {
		const conflict = conflictedProjectRef.current;
		return Boolean(conflict && conflict.path === path && conflict.revision === currentProjectRevisionRef.current);
	}, [currentProjectRevisionRef]);
	const blockCurrentProjectOverwrite = useCallback(() => {
		const path = activePathRef.current;
		if (path) conflictedProjectRef.current = { path, revision: currentProjectRevisionRef.current };
		clearPendingAutosave();
	}, [clearPendingAutosave, currentProjectRevisionRef]);
	const reportSaveConflict = useCallback((path: string | null, revision: string | null, message?: string) => {
		if (path) conflictedProjectRef.current = { path, revision };
		clearPendingAutosave();
		const error = message || uiText("projectChangedOnDisk");
		logWarn("project-save", error);
		setSaveFeedback(previous => ({ ...previous, error }));
		toast.error(error);
	}, [clearPendingAutosave, uiText]);
	const queueSave = useCallback((task: () => Promise<boolean>) => {
		const generation = saveGenerationRef.current;
		const run = saveQueueRef.current.catch(() => undefined).then(async () => {
			if (generation !== saveGenerationRef.current || savesSuspendedRef.current || isPreviewReadOnly()) return false;
			setSaveFeedback((previous) => ({ ...previous, saving: true }));
			try {
				const saved = await task();
				if (saved && generation === saveGenerationRef.current)
					setSaveFeedback({ saving: false, error: null, savedAt: Date.now() });
				return saved;
			} catch (error) {
				logError("project-save", error);
				if (generation === saveGenerationRef.current)
					setSaveFeedback((previous) => ({ ...previous, error: getErrorMessage(error) }));
				throw error;
			} finally {
				if (generation === saveGenerationRef.current)
					setSaveFeedback((previous) => ({ ...previous, saving: false }));
			}
		});
		saveQueueRef.current = run.catch(() => undefined);
		return run;
	}, [isPreviewReadOnly]);

	const withSavesSuspended = useCallback(async <T,>(action: () => Promise<T>): Promise<T> => {
		savesSuspendedRef.current = true;
		setSaveFeedback((previous) => ({ ...previous, saving: false }));
		saveGenerationRef.current += 1;
		clearPendingAutosave();
		try {
			// Finish an already dispatched disk write before deleting its file.
			await saveQueueRef.current;
			return await action();
		} finally {
			clearPendingAutosave();
			savesSuspendedRef.current = false;
			setSaveResumeRevision((revision) => revision + 1);
		}
	}, [clearPendingAutosave]);

	const saveProject = useCallback(
		async (forceSaveAs: boolean, options?: SaveProjectOptions) => {
			clearPendingAutosave();
			const generation = saveGenerationRef.current;
			if (savesSuspendedRef.current || isPreviewReadOnly() || (!forceSaveAs && isOverwriteBlocked(activePathRef.current))) return false;
			return queueSave(async () => {
				if (savesSuspendedRef.current || generation !== saveGenerationRef.current) return false;
				if (activeSourceRef.current !== currentSourcePath) return false;
				if (!currentSourcePath) {
					if (!options?.silent) toast.error(uiText("noVideoLoaded11795f"));
					return false;
				}

				const captureThumbnail = options?.captureThumbnail ?? true;
				const refreshLibrary = options?.refreshLibraryAfterSave ?? true;
				const remount = options?.remountPreviewAfterSave ?? true;
				try {
					let projectData =
						currentProjectSnapshot?.videoPath === currentSourcePath
							? currentProjectSnapshot
							: createProjectData(
									currentSourcePath,
									currentPersistedEditorState,
									lastSavedSnapshot?.projectId ?? null,
									lastSavedSnapshot,
								);
					const fileNameBase =
						currentSourcePath
							.split(/[\\/]/)
							.pop()
							?.replace(/\.[^.]+$/, "") || `project-${Date.now()}`;
					const targetPath = forceSaveAs
						? undefined
						: (activePathRef.current ?? undefined);
					if (targetPath && isOverwriteBlocked(targetPath)) return false;
					const expectedRevision = currentProjectRevisionRef.current;
					if (forceSaveAs) projectData = { ...projectData, projectId: crypto.randomUUID() };

					const thumbnail = captureThumbnail
						? ((await captureProjectThumbnail()) ?? undefined)
						: undefined;
					if (savesSuspendedRef.current || generation !== saveGenerationRef.current) return false;
					const result = forceSaveAs
						? await window.electronAPI.saveProjectFile(
								projectData,
								projectDisplayName || fileNameBase,
								undefined,
								thumbnail,
								expectedRevision ?? undefined,
							)
						: !targetPath
						? await window.electronAPI.createProjectFile(projectData, thumbnail)
						: await window.electronAPI.saveProjectFile(
								projectData,
								fileNameBase,
								targetPath,
								thumbnail,
								expectedRevision ?? undefined,
							);
					if (result.canceled) {
						if (!options?.silent) toast.info(uiText("projectSaveCanceled"));
						return false;
					}
					if (!result.success) {
						if ("conflict" in result && result.conflict && generation === saveGenerationRef.current) {
							reportSaveConflict(targetPath ?? activePathRef.current, expectedRevision, result.message);
							return false;
						}
						logError("project-save", result.message || "Could not save project.");
						if (generation === saveGenerationRef.current)
							setSaveFeedback((previous) => ({ ...previous, error: result.message || uiText("failedToSaveProject") }));
						toast.error(result.message || uiText("failedToSaveProject"));
						return false;
					}

					if (generation !== saveGenerationRef.current || activeSourceRef.current !== currentSourcePath) return true;
					if (result.path) {
						activePathRef.current = result.path;
						setCurrentProjectPath(result.path, result.revision);
						conflictedProjectRef.current = null;
					}
					setLastSavedSnapshot(
						cloneStructured({ ...projectData, projectId: result.projectId ?? projectData.projectId }),
					);
					if (refreshLibrary) await refreshProjectLibrary();

					return true;
				} catch (error) {
					logError("project-save", error);
					if (generation === saveGenerationRef.current)
						setSaveFeedback((previous) => ({ ...previous, error: getErrorMessage(error) }));
					toast.error(uiText("couldNotSaveProjectValue", { value0: getErrorMessage(error) }));
					return false;
				} finally {
					if (remount) remountPreview();
				}
			});
		},
		[uiText,
			clearPendingAutosave,
			queueSave,
			isPreviewReadOnly,
			isOverwriteBlocked,
			currentProjectRevisionRef,
			reportSaveConflict,
			currentSourcePath,
			currentProjectSnapshot,
			currentPersistedEditorState,
			lastSavedSnapshot,
			setCurrentProjectPath,
			setLastSavedSnapshot,
			projectDisplayName,
			captureProjectThumbnail,
			refreshProjectLibrary,
			remountPreview,
		],
	);

	useEffect(() => {
		window.electronAPI.setHasUnsavedChanges(!previewReadOnly && hasUnsavedChanges);
	}, [hasUnsavedChanges, previewReadOnly]);
	useEffect(
		() => window.electronAPI.onRequestSaveBeforeClose(() => saveProject(false)),
		[saveProject],
	);
	// biome-ignore lint/correctness/useExhaustiveDependencies: resuming a failed deletion must re-arm autosave even if the document did not change.
	useEffect(() => {
		if (previewReadOnly || savesSuspendedRef.current || isOverwriteBlocked(currentProjectPath) || project.projectBrowserOpen || project.loading || !currentSourcePath || !hasUnsavedChanges) {
			clearPendingAutosave();
			return;
		}
		autosaveTimeoutRef.current = window.setTimeout(() => {
			autosaveTimeoutRef.current = null;
			void saveProject(false, {
				silent: true,
				remountPreviewAfterSave: false,
				refreshLibraryAfterSave: false,
				captureThumbnail: false,
			});
		}, PROJECT_AUTOSAVE_DELAY_MS);
		return clearPendingAutosave;
	}, [clearPendingAutosave, hasUnsavedChanges, saveProject, project.loading, project.projectBrowserOpen, currentProjectPath, currentSourcePath, saveResumeRevision, isOverwriteBlocked, previewReadOnly]);
	useEffect(() => clearPendingAutosave, [clearPendingAutosave]);

	const saveProjectWithName = useCallback(
		async (name: string, mode: "rename" | "copy" = "rename") => {
			const trimmedName = name.trim();
			if (!trimmedName) {
				toast.error(uiText("projectNameIsRequired"));
				return false;
			}
			if (!currentSourcePath) {
				toast.error(uiText("noVideoLoaded11795f"));
				return false;
			}
			clearPendingAutosave();
			const generation = saveGenerationRef.current;
			if (savesSuspendedRef.current || isPreviewReadOnly() || (mode === "rename" && isOverwriteBlocked(activePathRef.current))) return false;
			return queueSave(async () => {
				if (savesSuspendedRef.current || generation !== saveGenerationRef.current) return false;
				if (activeSourceRef.current !== currentSourcePath) return false;
				try {
					const projectData =
						currentProjectSnapshot?.videoPath === currentSourcePath
							? currentProjectSnapshot
							: createProjectData(
									currentSourcePath,
									currentPersistedEditorState,
									lastSavedSnapshot?.projectId ?? null,
									lastSavedSnapshot,
								);
					const previousPath = activePathRef.current;
					if (mode === "rename" && isOverwriteBlocked(previousPath)) return false;
					const expectedRevision = currentProjectRevisionRef.current;
					const thumbnail = await captureProjectThumbnail();
					if (savesSuspendedRef.current || generation !== saveGenerationRef.current) return false;
					const result = await window.electronAPI.saveProjectFileNamed(
						projectData,
						trimmedName,
						thumbnail,
						mode,
						expectedRevision ?? undefined,
					);
					if (result.conversion && generation === saveGenerationRef.current && activeSourceRef.current === currentSourcePath) {
						const { from, path, revision } = result.conversion;
						const convertedPath = result.success && result.path ? result.path : path;
						activePathRef.current = convertedPath;
						setCurrentProjectPath(convertedPath, result.success ? result.revision : revision);
						notifyProjectFormat({ convertedFrom: from, path: convertedPath }, uiText);
					}
					if (result.canceled) {
						toast.info(uiText("projectSaveCanceled"));
						return false;
					}
					if (!result.success) {
						if (result.conflict && generation === saveGenerationRef.current) {
							reportSaveConflict(activePathRef.current, expectedRevision, result.message);
							return false;
						}
						logError("project-save", result.message || "Could not save named project.");
						if (generation === saveGenerationRef.current)
							setSaveFeedback((previous) => ({ ...previous, error: result.message || uiText("failedToSaveProject") }));
						toast.error(result.message || uiText("failedToSaveProject"));
						return false;
					}
					if (generation !== saveGenerationRef.current || activeSourceRef.current !== currentSourcePath) return true;
					if (
						mode === "rename" &&
						!result.conversion &&
						previousPath &&
						result.path &&
						previousPath !== result.path
					) {
						try {
							moveProjectFolderReferences(previousPath, result.path);
						} catch {
							toast.error(
								uiText("projectRenamedButLibraryPreferencesCouldNotBeUpdated"),
							);
						}
					}
					if (result.path) {
						activePathRef.current = result.path;
						setCurrentProjectPath(result.path, result.revision);
						conflictedProjectRef.current = null;
					}
					setLastSavedSnapshot(
						cloneStructured({ ...projectData, projectId: result.projectId ?? projectData.projectId }),
					);
					await refreshProjectLibrary();

					return true;
				} finally {
					remountPreview();
				}
			});
		},
		[uiText,
			clearPendingAutosave,
			queueSave,
			isPreviewReadOnly,
			isOverwriteBlocked,
			currentProjectRevisionRef,
			reportSaveConflict,
			currentSourcePath,
			currentProjectSnapshot,
			currentPersistedEditorState,
			lastSavedSnapshot,
			setCurrentProjectPath,
			setLastSavedSnapshot,
			captureProjectThumbnail,
			refreshProjectLibrary,
			remountPreview,
		],
	);

	const handleProjectSaveDialogSubmit = useCallback(
		async (event?: React.FormEvent<HTMLFormElement>) => {
			event?.preventDefault();
			const name = projectSaveDialogDraft.trim();
			if (!name) {
				toast.error(uiText("projectNameIsRequired"));
				projectSaveDialogInputRef.current?.focus();
				return;
			}
			setIsSavingProjectDialog(true);
			let saved = false;
			try {
				saved = await saveProjectWithName(name, "copy");
			} catch (error) {
				toast.error(getErrorMessage(error));
			} finally {
				setIsSavingProjectDialog(false);
			}
			if (saved) resolveProjectSaveDialog(true);
			else {
				projectSaveDialogInputRef.current?.focus();
				projectSaveDialogInputRef.current?.select();
			}
		},
		[uiText,
			projectSaveDialogDraft,
			setIsSavingProjectDialog,
			projectSaveDialogInputRef,
			resolveProjectSaveDialog,
			saveProjectWithName,
		],
	);

	const closeProjectNameEditor = useCallback(() => {
		setProjectNameDraft(projectDisplayName);
		setIsEditingProjectName(false);
	}, [setProjectNameDraft, setIsEditingProjectName, projectDisplayName]);
	const handleProjectNameSubmit = useCallback(
		async (event?: React.FormEvent<HTMLFormElement>) => {
			event?.preventDefault();
			const name = projectNameDraft.trim();
			if (savingNameRef.current) return;
			if (!name || name === projectDisplayName) return closeProjectNameEditor();
			savingNameRef.current = true;
			setIsSavingProjectName(true);
			let saved = false;
			try {
				saved = await saveProjectWithName(name, "rename");
			} catch (error) {
				toast.error(getErrorMessage(error));
			} finally {
				setIsSavingProjectName(false);
				savingNameRef.current = false;
			}
			if (saved) setIsEditingProjectName(false);
			else {
				projectNameInputRef.current?.focus();
				projectNameInputRef.current?.select();
			}
		},
		[
			projectNameDraft,
			projectDisplayName,
			setIsSavingProjectName,
			setIsEditingProjectName,
			projectNameInputRef,
			closeProjectNameEditor,
			saveProjectWithName,
		],
	);
	const handleSaveProject = useCallback(() => saveProject(false), [saveProject]);
	const handleSaveProjectAs = useCallback(async () => {
		if (await saveProject(true)) setProjectBrowserOpen(false);
	}, [saveProject, setProjectBrowserOpen]);

	return {
		saveFeedback,
		previewReadOnly,
		isPreviewReadOnly,
		setVersionPreviewReadOnly,
		blockCurrentProjectOverwrite,
		withSavesSuspended,
		saveProject,
		handleSaveProject,
		handleSaveProjectAs,
		handleProjectSaveDialogSubmit,
		closeProjectNameEditor,
		handleProjectNameSubmit,
	};
}
import { notifyProjectFormat } from "./projectFormatNotice";
