import { OPEN_DASHBOARD_STORAGE_KEY } from "@/lib/storageKeys";
import { notifyProjectFormat } from "./projectFormatNotice";
import { useUiText } from "@/i18n/useUiText";
import {
	type Dispatch,
	type MutableRefObject,
	type RefObject,
	type SetStateAction,
	useCallback,
	useEffect,
	useRef,
} from "react";
import type { useProjectSaveActions } from "./useProjectSaveActions";
import { toast } from "@/components/ui/toast";
import { logError } from "@/lib/appLog";
import { fromFileUrl, resolveVideoUrl } from "../projectPersistence";
import type { useAppearanceState } from "../state/useAppearanceState";
import type { useProjectState } from "../state/useProjectState";
import { DEFAULT_WEBCAM_TIME_OFFSET_MS } from "../types";
import type { VideoPlaybackRef } from "../VideoPlayback";

type Set<T> = Dispatch<SetStateAction<T>>;

type UseProjectOpenActionsInput = {
	project: ReturnType<typeof useProjectState>;
	appearance: ReturnType<typeof useAppearanceState>;
	videoPlaybackRef: RefObject<VideoPlaybackRef | null>;
	pendingFreshRecordingAutoZoomPathRef: MutableRefObject<string | null>;
	hasUnsavedChanges: boolean;
	setIsPlaying: Set<boolean>;
	setCurrentTime: Set<number>;
	setDuration: Set<number>;
	applyLoadedProject: (candidate: unknown, path?: string | null, revision?: string) => Promise<boolean>;
	offerRelink: (result: ProjectLoadResult, onApplied?: () => void) => boolean;
	openUnsavedChangesDialog: (actionLabel: string) => Promise<"save" | "discard" | "cancel">;
	saveProject: ReturnType<typeof useProjectSaveActions>["saveProject"];
	withSavesSuspended: ReturnType<typeof useProjectSaveActions>["withSavesSuspended"];
	isPreviewReadOnly: ReturnType<typeof useProjectSaveActions>["isPreviewReadOnly"];
	refreshProjectLibrary: () => Promise<void>;
	resetSourceScopedEditorState: () => void;
	applySessionPresentation: (session: null) => void;
	handleSaveProject: () => Promise<unknown>;
	handleSaveProjectAs: () => Promise<unknown>;
};

export function useProjectOpenActions({
	project,
	appearance,
	videoPlaybackRef,
	pendingFreshRecordingAutoZoomPathRef,
	hasUnsavedChanges,
	setIsPlaying,
	setCurrentTime,
	setDuration,
	applyLoadedProject,
	offerRelink,
	withSavesSuspended,
	isPreviewReadOnly,
	saveProject,
	refreshProjectLibrary,
	resetSourceScopedEditorState,
	applySessionPresentation,
	handleSaveProject,
	handleSaveProjectAs,
}: UseProjectOpenActionsInput) {
	const uiText = useUiText();
	const releasedProjectPathRef = useRef<string | null>(null);
	const offerMediaRelink = useCallback((result: ProjectLoadResult) => offerRelink(result, () => {
		releasedProjectPathRef.current = null;
	}), [offerRelink]);
	const enteringLibraryRef = useRef(false);
	const clearActiveProject = useCallback(() => {
		videoPlaybackRef.current?.pause();
		setIsPlaying(false);
		setCurrentTime(0);
		setDuration(0);
		project.setCurrentProjectPath(null);
		project.setLastSavedSnapshot(null);
		project.setVideoPath(null);
		project.setVideoSourcePath(null);
		project.setError(null);
		pendingFreshRecordingAutoZoomPathRef.current = null;
		appearance.setWebcam(previous => ({ ...previous, enabled: false, sourcePath: null }));
		applySessionPresentation(null);
		resetSourceScopedEditorState();
	}, [videoPlaybackRef, setIsPlaying, setCurrentTime, setDuration, project, pendingFreshRecordingAutoZoomPathRef, appearance.setWebcam, applySessionPresentation, resetSourceScopedEditorState]);
	const confirmReplaceSourceWithUnsavedChanges = useCallback(
		async (_actionLabel: string) => {
			if (isPreviewReadOnly()) return false;
			if (!hasUnsavedChanges) return true;
			return saveProject(false, { remountPreviewAfterSave: false });
		},
		[hasUnsavedChanges, isPreviewReadOnly, saveProject],
	);

	const handleOpenProjectFromLibrary = useCallback(
		async (projectPath: string) => {
			if (!(await confirmReplaceSourceWithUnsavedChanges("open another project"))) return;
			try {
				const result = await window.electronAPI.openProjectFileAtPath(projectPath);
				if (result.canceled) return;
				if (offerMediaRelink(result)) return;
				if (!result.success) {
					logError("project-open", "Could not load project from the library.");
					toast.error(result.error || result.message || uiText("failedToLoadProject"));
					return;
				}
				if (!(await applyLoadedProject(result.project, result.path ?? null, result.revision))) {
					logError("project-open", "Invalid project format.");
					toast.error(uiText("couldNotLoadProjectInvalidProjectFileFormat"));
					return;
				}
				notifyProjectFormat(result, uiText);
				releasedProjectPathRef.current = null;
				project.setProjectBrowserOpen(false);
				await refreshProjectLibrary();
				return true;
			} catch (error) {
				logError("project-open", error);
				toast.error(
					uiText("couldNotLoadProjectValue", { value0: error instanceof Error ? error.message : String(error) }),
				);
			}
		},
		[uiText,
			applyLoadedProject,
			confirmReplaceSourceWithUnsavedChanges,
			offerMediaRelink,
			project,
			refreshProjectLibrary,
		],
	);

	const externalProjectOpenRef = useRef(handleOpenProjectFromLibrary);
	externalProjectOpenRef.current = handleOpenProjectFromLibrary;
	useEffect(() => {
		if (project.loading) return;
		return window.electronAPI.onExternalProjectOpen?.(async (filePath) => {
			await externalProjectOpenRef.current(filePath);
			// Let React commit the new project before accepting another shell request.
			await new Promise((resolve) => setTimeout(resolve, 0));
		});
	}, [project.loading]);

	const handleImportMediaOrProject = useCallback(async () => {
		if (!(await confirmReplaceSourceWithUnsavedChanges("import a file"))) return;
		try {
			const result = await window.electronAPI.openVideoFilePicker({ includeProjects: true });
			if (result.canceled) return;
			if (offerMediaRelink(result)) return;
			if (!result.success) {
				logError("project-open", "Could not import file.");
				toast.error(result.message || uiText("failedToImportFile"));
				return;
			}
			if (result.kind === "project" || result.project) {
				if (!(await applyLoadedProject(result.project, result.path ?? null, result.revision))) {
					logError("project-open", "Invalid imported project format.");
					toast.error(uiText("couldNotLoadProjectInvalidProjectFileFormat"));
					return;
				}
				notifyProjectFormat(result, uiText);
				releasedProjectPathRef.current = null;
				project.setProjectBrowserOpen(false);
				await refreshProjectLibrary();
				toast.success(
					result.path ? uiText("projectLoadedFromValue", { value0: result.path }) : uiText("projectLoaded"),
				);
				return;
			}
			if (!result.path) {
				toast.error(uiText("noMediaFileSelected"));
				return;
			}

			const sourcePath = fromFileUrl(result.path);
			const setPathResult = await window.electronAPI.setCurrentVideoPath(sourcePath, {
				preserveProjectPath: false,
			});
			if (!setPathResult.success) throw new Error(uiText("couldNotLoadMedia"));
			const sourceVideoUrl = await resolveVideoUrl(sourcePath);
			try {
				videoPlaybackRef.current?.pause();
			} catch {
				// The preview may already be tearing down.
			}
			setIsPlaying(false);
			setCurrentTime(0);
			setDuration(0);
			project.setVideoSourcePath(sourcePath);
			project.setVideoPath(sourceVideoUrl);
			project.setCurrentProjectPath(null);
			project.setLastSavedSnapshot(null);
			resetSourceScopedEditorState();
			pendingFreshRecordingAutoZoomPathRef.current =
				appearance.autoApplyFreshRecordingAutoZooms ? sourceVideoUrl : null;
			appearance.setWebcam((previous) => ({
				...previous,
				visibleRanges: undefined,
				enabled: false,
				sourcePath: null,
				timeOffsetMs: DEFAULT_WEBCAM_TIME_OFFSET_MS,
			}));
			applySessionPresentation(null);
			releasedProjectPathRef.current = null;
			project.setProjectBrowserOpen(false);
			await refreshProjectLibrary();
			toast.success(uiText("mediaImported"));
		} catch (error) {
			logError("project-open", error);
			toast.error(
				uiText("couldNotLoadFileValue", { value0: error instanceof Error ? error.message : String(error) }),
			);
		}
	}, [uiText,
		confirmReplaceSourceWithUnsavedChanges,
		offerMediaRelink,
		applyLoadedProject,
		project,
		appearance,
		videoPlaybackRef,
		setIsPlaying,
		setCurrentTime,
		setDuration,
		resetSourceScopedEditorState,
		pendingFreshRecordingAutoZoomPathRef,
		applySessionPresentation,
		refreshProjectLibrary,
	]);

	const handleProjectBrowserOpenChange = useCallback((open: boolean) => {
		if (enteringLibraryRef.current && !open) return;
		const releasedPath = releasedProjectPathRef.current;
		if (!open && releasedPath) {
			void handleOpenProjectFromLibrary(releasedPath);
			return;
		}
		project.setProjectBrowserOpen(open);
	}, [handleOpenProjectFromLibrary, project.setProjectBrowserOpen]);

	const handleOpenProjectBrowser = useCallback(async () => {
		if (enteringLibraryRef.current || isPreviewReadOnly()) return;
		if (project.projectBrowserOpen) {
			handleProjectBrowserOpenChange(false);
			return;
		}
		enteringLibraryRef.current = true;
		videoPlaybackRef.current?.pause();
		setIsPlaying(false);
		project.setProjectLibraryLoading(true);
		project.setProjectBrowserOpen(true);
		try {
			if (project.videoPath && hasUnsavedChanges) {
				const saved = await saveProject(false, {
					remountPreviewAfterSave: false,
					refreshLibraryAfterSave: false,
				});
				if (!saved) {
					project.setProjectBrowserOpen(false);
					return;
				}
			}
			if (project.currentProjectPath || project.videoPath) {
				await withSavesSuspended(async () => {
					const released = await window.electronAPI.releaseCurrentProject();
					if (!released.success) throw new Error(uiText("failedToLoadProject"));
					releasedProjectPathRef.current = released.path ?? project.currentProjectPath;
					clearActiveProject();
				});
			}
		} catch (error) {
			project.setProjectBrowserOpen(false);
			toast.error(error instanceof Error ? error.message : String(error));
		} finally {
			try {
				await refreshProjectLibrary();
			} finally {
				enteringLibraryRef.current = false;
			}
		}
	}, [
		project.projectBrowserOpen,
		handleProjectBrowserOpenChange,
		project.setProjectBrowserOpen,
		project.setProjectLibraryLoading,
		refreshProjectLibrary,
		videoPlaybackRef,
		setIsPlaying,
		saveProject,
		hasUnsavedChanges,
		isPreviewReadOnly,
		withSavesSuspended,
		clearActiveProject,
		uiText,
		project.videoPath,
		project.currentProjectPath,
	]);

	const handleOpenProjectFile = useCallback(async () => {
		if (!(await confirmReplaceSourceWithUnsavedChanges("open a project file"))) return;
		try {
			const result = await window.electronAPI.loadProjectFile();
			if (result.canceled) return;
			if (offerMediaRelink(result)) return;
			if (!result.success) {
				logError("project-open", "Could not load project from the file picker.");
				toast.error(uiText("couldNotOpenProjectValue", { value0: result.error || result.message || uiText("failedToOpenProject") }));
				return;
			}
			if (!(await applyLoadedProject(result.project, result.path ?? null, result.revision))) {
				throw new Error(uiText("invalidProjectFileFormat"));
			}
			notifyProjectFormat(result, uiText);
			releasedProjectPathRef.current = null;
			project.setProjectBrowserOpen(false);
			await refreshProjectLibrary();
		} catch (error) {
			logError("project-open", error);
			toast.error(uiText("couldNotOpenProjectValue", { value0: error instanceof Error ? error.message : String(error) }));
		}
	}, [uiText, confirmReplaceSourceWithUnsavedChanges, offerMediaRelink, applyLoadedProject, project, refreshProjectLibrary]);

	useEffect(() => {
		const openRequestedDashboard = () => {
			if (!localStorage.getItem(OPEN_DASHBOARD_STORAGE_KEY)) return;
			localStorage.removeItem(OPEN_DASHBOARD_STORAGE_KEY);
			if (!project.projectBrowserOpen) void handleOpenProjectBrowser();
		};
		openRequestedDashboard();
		window.addEventListener("storage", openRequestedDashboard);
		return () => window.removeEventListener("storage", openRequestedDashboard);
	}, [handleOpenProjectBrowser, project.projectBrowserOpen]);

	useEffect(() => {
		const removeLoad = window.electronAPI.onMenuLoadProject(
			() => void handleOpenProjectFile(),
		);
		const removeSave = window.electronAPI.onMenuSaveProject(handleSaveProject);
		const removeSaveAs = window.electronAPI.onMenuSaveProjectAs(handleSaveProjectAs);
		return () => {
			removeLoad?.();
			removeSave?.();
			removeSaveAs?.();
		};
	}, [handleOpenProjectFile, handleSaveProject, handleSaveProjectAs]);

	const handleDeleteProjects = useCallback(
		async (paths: string[]) => withSavesSuspended(async () => {
			const result = await window.electronAPI.trashProjectFiles(paths);
			if (releasedProjectPathRef.current && result.deleted.includes(releasedProjectPathRef.current)) {
				releasedProjectPathRef.current = null;
			}
			if (project.currentProjectPath && result.deleted.includes(project.currentProjectPath)) {
				clearActiveProject();
				project.setProjectBrowserOpen(true);
			}
			await refreshProjectLibrary();
			if (result.errors.length) toast.error(result.errors.join("\n"));
			return result.deleted;
		}),
		[project, refreshProjectLibrary, withSavesSuspended, clearActiveProject],
	);
	const handleRenameLibraryProject = useCallback(
		async (path: string, name: string) => {
			const result = await window.electronAPI.renameLibraryProject(path, name);
			if (!result.success || !result.path)
				throw new Error(result.error || uiText("couldNotRenameProject"));
			if (project.currentProjectPath === path) project.setCurrentProjectPath(result.path, project.currentProjectRevisionRef.current);
			if (releasedProjectPathRef.current === path) releasedProjectPathRef.current = result.path;
			await refreshProjectLibrary();
			return result.path;
		},
		[uiText, project, refreshProjectLibrary],
	);

	return {
		handleOpenProjectFile,
		handleRenameLibraryProject,
		handleOpenProjectFromLibrary,
		handleImportMediaOrProject,
		handleOpenProjectBrowser,
		handleProjectBrowserOpenChange,
		handleDeleteProjects,
	};
}
