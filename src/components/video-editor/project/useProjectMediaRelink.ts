import { useCallback, useState } from "react";
import { toast } from "@/components/ui/toast";
import { useUiText } from "@/i18n/useUiText";
import type { MediaRelinkMapping, ProjectMediaReference } from "../projectRelink";
import type { useProjectState } from "../state/useProjectState";
import { notifyProjectFormat } from "./projectFormatNotice";
import type { useProjectLifecycle } from "./useProjectLifecycle";
import type { useProjectSaveActions } from "./useProjectSaveActions";

type MissingRequest = {
	path: string;
	revision: string;
	references: ProjectMediaReference[];
	onApplied?: () => void;
};

export function useProjectMediaRelink({
	project,
	applyLoadedProject,
	withSavesSuspended,
	refreshProjectLibrary,
}: {
	project: ReturnType<typeof useProjectState>;
	applyLoadedProject: ReturnType<typeof useProjectLifecycle>["applyLoadedProject"];
	withSavesSuspended: ReturnType<typeof useProjectSaveActions>["withSavesSuspended"];
	refreshProjectLibrary: () => Promise<void>;
}) {
	const uiText = useUiText();
	const [request, setRequest] = useState<MissingRequest | null>(null);
	const offerRelink = useCallback((result: ProjectLoadResult, onApplied?: () => void) => {
		if (result.code !== "media-missing" || !result.path || !result.revision || !result.missing?.length) return false;
		setRequest({ path: result.path, revision: result.revision, references: result.missing, onApplied });
		return true;
	}, []);
	const cancel = useCallback(() => {
		setRequest(null);
		if (!project.videoPath) project.setProjectBrowserOpen(true);
	}, [project]);
	const confirm = useCallback(async (mapping: MediaRelinkMapping) => {
		if (!request) return;
		await withSavesSuspended(async () => {
			const result = await window.electronAPI.relinkProjectMedia(request.path, request.revision, mapping);
			if (!result.success || !result.path) throw new Error(result.message || uiText("relinkSaveFailed"));
			if (!(await applyLoadedProject(result.project, result.path, result.revision))) {
				throw new Error(uiText("invalidProjectFileFormat"));
			}
			notifyProjectFormat(result, uiText);
			request.onApplied?.();
			project.setProjectBrowserOpen(false);
			setRequest(null);
			const skipped = request.references.filter(({ path }) => mapping[path] === null).length;
			if (skipped > 0) toast.warning(uiText("relinkRemovedMissingMedia", { value0: skipped }));
			else toast.success(uiText("relinkMediaRestored"));
			await refreshProjectLibrary();
		});
	}, [applyLoadedProject, project, refreshProjectLibrary, request, uiText, withSavesSuspended]);

	return { request, offerRelink, cancel, confirm };
}
