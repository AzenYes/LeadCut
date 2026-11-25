import { useRef, useState } from "react";
import { toast } from "@/components/ui/toast";
import { useI18n } from "@/contexts/I18nContext";
import type { ProjectVersionEntry } from "@/types/projectVersion";
import type { useProjectState } from "../state/useProjectState";
import type { useProjectLifecycle } from "./useProjectLifecycle";
import type { useProjectSaveActions } from "./useProjectSaveActions";

export function useProjectVersionHistory({
	project,
	hasUnsavedChanges,
	saveActions,
	applyLoadedProject,
}: {
	project: ReturnType<typeof useProjectState>;
	hasUnsavedChanges: boolean;
	saveActions: ReturnType<typeof useProjectSaveActions>;
	applyLoadedProject: ReturnType<typeof useProjectLifecycle>["applyLoadedProject"];
}) {
	const { t } = useI18n();
	const text = (key: string) => t(`common.interface.${key}`);
	const [open, setOpen] = useState(false);
	const [versions, setVersions] = useState<ProjectVersionEntry[]>([]);
	const [selected, setSelected] = useState<ProjectVersionEntry | null>(null);
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const working = useRef(false);

	async function run(action: () => Promise<void>) {
		if (working.current) return;
		working.current = true;
		setBusy(true);
		setError(null);
		try {
			await action();
		} catch (cause) {
			const message = cause instanceof Error ? cause.message : String(cause);
			setError(message);
			toast.error(message);
		} finally {
			working.current = false;
			setBusy(false);
		}
	}

	async function show() {
		if (!project.currentProjectPath) return;
		setVersions([]);
		setOpen(true);
		await run(async () => {
			const result = await window.electronAPI.listProjectVersions();
			if (!result.success || !result.versions) throw new Error(result.message || text("versionHistoryLoadFailed"));
			setVersions(result.versions);
		});
	}

	async function preserveCurrentEdits() {
		if (selected || !hasUnsavedChanges) return;
		if (!(await saveActions.saveProject(false))) {
			throw new Error(text("versionHistorySaveFailed"));
		}
	}

	async function loadCurrent() {
		const result = await window.electronAPI.loadCurrentProjectFile();
		if (!result.success || !(await applyLoadedProject(
			result.project,
			result.path ?? project.currentProjectPath,
			result.revision,
		))) throw new Error(result.message || text("versionHistoryLoadFailed"));
		setSelected(null);
		saveActions.setVersionPreviewReadOnly(false);
	}

	function preview(version: ProjectVersionEntry) {
		return run(async () => {
			await preserveCurrentEdits();
			saveActions.setVersionPreviewReadOnly(true);
			setSelected(version);
			await saveActions.withSavesSuspended(async () => {
				try {
					const result = await window.electronAPI.readProjectVersion(version.path);
					if (!result.success || !(await applyLoadedProject(
						result.project, project.currentProjectPath, project.currentProjectRevisionRef.current ?? undefined,
					))) throw new Error(result.message || text("versionHistoryLoadFailed"));
					setOpen(false);
				} catch (cause) {
					await loadCurrent();
					throw cause;
				}
			});
		});
	}

	function restore(version: ProjectVersionEntry) {
		return run(async () => {
			await preserveCurrentEdits();
			await saveActions.withSavesSuspended(async () => {
				const result = await window.electronAPI.restoreProjectVersion(
					version.path, project.currentProjectRevisionRef.current ?? undefined,
				);
				if (!result.success) throw new Error(result.message || text("versionHistoryRestoreFailed"));
				setOpen(false);
				setSelected(version);
				saveActions.setVersionPreviewReadOnly(true);
				await loadCurrent();
				toast.success(text("versionHistoryRestored"));
			});
		});
	}

	function remove(version: ProjectVersionEntry) {
		return run(async () => {
			const result = await window.electronAPI.deleteProjectVersion(version.path);
			if (!result.success) throw new Error(result.message || text("versionHistoryDeleteFailed"));
			setVersions(current => current.filter(entry => entry.path !== version.path));
		});
	}

	return {
		open, versions, selected, busy, error, show, preview, restore, remove,
		close: () => { if (!working.current) setOpen(false); },
		returnToCurrent: () => run(() => saveActions.withSavesSuspended(loadCurrent)),
	};
}
