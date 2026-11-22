import { useUiText } from "@/i18n/useUiText";
import { notifyProjectFormat } from "@/components/video-editor/project/projectFormatNotice";
import { useCallback, useState } from "react";
import type { ProjectLibraryEntry } from "@/components/video-editor/ProjectBrowserDialog";
import type { DesktopSource } from "../popovers/launchPopoverTypes";

export function useLaunchWindowActions() {
	const uiText = useUiText();
	const [selectedSource, setSelectedSource] = useState(uiText("screen"));
	const [hasSelectedSource, setHasSelectedSource] = useState(false);
	const [projectLibraryEntries, setProjectLibraryEntries] = useState<ProjectLibraryEntry[]>([]);

	const handleSourceSelect = useCallback(async (source: DesktopSource) => {
		await window.electronAPI.selectSource(source);
		setSelectedSource(source.name);
		setHasSelectedSource(true);
		window.electronAPI.showSourceHighlight?.({
			...source,
			name: source.appName ? `${source.appName} — ${source.name}` : source.name,
			appName: source.appName,
		});
	}, []);

	const openVideoFile = useCallback(async () => {
		const result = await window.electronAPI.openVideoFilePicker({ includeProjects: true });
		if (result.canceled) return;
		if (result.success && result.kind === "project") {
			notifyProjectFormat(result, uiText);
			await window.electronAPI.switchToEditor();
			return;
		}
		if (result.success && result.path) {
			await window.electronAPI.setCurrentVideoPath(result.path);
			await window.electronAPI.switchToEditor();
		}
	}, [uiText]);

	const refreshProjectLibrary = useCallback(async () => {
		try {
			const result = await window.electronAPI.listProjectFiles();
			if (!result.success) return;
			setProjectLibraryEntries(result.entries);
		} catch (error) {
			console.error("Failed to load project library:", error);
		}
	}, []);
	const openProjectFromLibrary = useCallback(async (projectPath: string) => {
		try {
			const result = await window.electronAPI.openProjectFileAtPath(projectPath);
			if (result.canceled || !result.success) {
				return;
			}
			notifyProjectFormat(result, uiText);
			await window.electronAPI.switchToEditor();
		} catch (error) {
			console.error("Failed to open project from library:", error);
		}
	}, [uiText]);

	const syncSelectedSource = useCallback((source: { name?: string } | null | undefined) => {
		if (source?.name) {
			setSelectedSource(source.name);
			setHasSelectedSource(true);
			return;
		}
		setSelectedSource(uiText("screen"));
		setHasSelectedSource(false);
	}, [uiText]);

	return {
		selectedSource,
		hasSelectedSource,
		projectLibraryEntries,
		handleSourceSelect,
		openVideoFile,
		openProjectFromLibrary,
		syncSelectedSource,
		refreshProjectLibrary,
	};
}
