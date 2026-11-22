import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "@/components/ui/toast";
import { useUiText } from "@/i18n/useUiText";
import type { useProjectState } from "../state/useProjectState";
import type { useProjectLifecycle } from "./useProjectLifecycle";
import type { useProjectSaveActions } from "./useProjectSaveActions";

type Change = { path: string; diskRevision: string | null };
type Inputs = {
	project: ReturnType<typeof useProjectState>;
	applyLoadedProject: ReturnType<typeof useProjectLifecycle>["applyLoadedProject"];
	openProjectSaveDialog: ReturnType<typeof useProjectLifecycle>["openProjectSaveDialog"];
	saveActions: ReturnType<typeof useProjectSaveActions>;
	projectDisplayName: string;
	hasUnsavedChanges: boolean;
};

export function useExternalProjectChange(input: Inputs) {
	const uiText = useUiText();
	const current = useRef(input);
	current.current = input;
	const [change, setChange] = useState<Change | null>(null);
	const [reloadFailed, setReloadFailed] = useState(false);
	const [resolving, setResolving] = useState(false);
	const resolvingRef = useRef(false);

	useEffect(() => window.electronAPI.onProjectFileChanged?.(update => {
		const { project, saveActions } = current.current;
		if (update.path !== project.currentProjectPath ||
			update.diskRevision === project.currentProjectRevisionRef.current) return;
		saveActions.blockCurrentProjectOverwrite();
		setReloadFailed(false);
		setChange(update);
	}), []);

	const resolve = useCallback(async (update: Change, makeCopy: boolean) => {
		if (resolvingRef.current) return;
		resolvingRef.current = true;
		setResolving(true);
		const state = current.current;
		try {
			if (makeCopy && !(await state.openProjectSaveDialog(uiText("externalProjectCopyName", { name: state.projectDisplayName })))) return;
			let loadedRevision: string | undefined;
			await state.saveActions.withSavesSuspended(async () => {
				const result = await window.electronAPI.openProjectFileAtPath(update.path);
				if (!result.success || !result.project || !(await state.applyLoadedProject(
					result.project, result.path ?? update.path, result.revision, { preservePlayhead: true },
				))) throw new Error(result.message || uiText("couldNotLoadProjectInvalidProjectFileFormat"));
				loadedRevision = result.revision;
			});
			setChange(pending => pending === update || pending?.diskRevision === loadedRevision ? null : pending);
			setReloadFailed(false);
			toast.success(uiText("projectUpdatedOnDisk"));
		} catch (error) {
			setReloadFailed(true);
			toast.error(error instanceof Error ? error.message : String(error));
		} finally {
			resolvingRef.current = false;
			setResolving(false);
		}
	}, [uiText]);

	const activeChange = change?.path === input.project.currentProjectPath ? change : null;
	const conflictOpen = Boolean(activeChange && !resolving && !input.saveActions.previewReadOnly &&
		(input.hasUnsavedChanges || reloadFailed || activeChange.diskRevision === null));
	useEffect(() => {
		if (resolving || !change || input.saveActions.previewReadOnly) return;
		if (!activeChange) {
			setChange(null);
			return;
		}
		if (activeChange.diskRevision === input.project.currentProjectRevisionRef.current) {
			setChange(null);
			return;
		}
		if (!conflictOpen && !input.project.loading && !input.saveActions.saveFeedback.saving) {
			void resolve(activeChange, false);
		}
	}, [activeChange, change, conflictOpen, input.project.currentProjectRevisionRef, input.project.loading, input.saveActions.previewReadOnly, input.saveActions.saveFeedback.saving, resolve, resolving]);

	return {
		conflictOpen,
		loadDiskVersion: () => activeChange && resolve(activeChange, false),
		saveCopy: () => activeChange && resolve(activeChange, true),
	};
}
