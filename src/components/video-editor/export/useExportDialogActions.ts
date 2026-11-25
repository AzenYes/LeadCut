import { useUiText } from "@/i18n/useUiText";
import { type RefObject, useCallback } from "react";
import { toast } from "@/components/ui/toast";
import { logError } from "@/lib/appLog";
import type { ExportFormat } from "@/lib/exporter";
import { resolveExportStartSettings } from "../exportStartSettings";
import type { VideoPlaybackRef } from "../VideoPlayback";
import type { useExportSession } from "./useExportSession";
import type { useExportSettings } from "./useExportSettings";
import type { useExportPreflight } from "./useExportPreflight";
import { capturePausedExportPreview } from "./pausedExportPreview";

type ExportSession = ReturnType<typeof useExportSession>;
type ExportSettingsState = ReturnType<typeof useExportSettings>;

type UseExportDialogActionsInput = {
	videoPath: string | null;
	videoPlaybackRef: RefObject<VideoPlaybackRef | null>;
	hasCaptionsForSidecar: boolean;
	settings: ExportSettingsState;
	session: ExportSession;
	preflight: ReturnType<typeof useExportPreflight>;
	showExportSuccessToast: (filePath: string, revealAfterSave?: boolean) => void;
};

export function useExportDialogActions({
	videoPath,
	videoPlaybackRef,
	hasCaptionsForSidecar,
	settings,
	session,
	preflight,
	showExportSuccessToast,
}: UseExportDialogActionsInput) {
	const uiText = useUiText();
	const handleOpenExportDropdown = useCallback(() => {
		if (!videoPath) {
			toast.error(uiText("noVideoLoaded11795f"));
			return;
		}

		if (session.hasPendingExportSave) {
			session.setShowExportDropdown(true);
			session.setExportError(
				uiText("saveDialogCanceledClickSaveAgainToSaveWithoutReRendering"),
			);
			return;
		}
		const open = () => {
			session.setShowExportDropdown(true);
			session.setExportProgress(null);
			session.setExportError(null);
			session.setExportedFilePath(undefined);
		};
		const playback = videoPlaybackRef.current;
		if (!session.isExporting && playback && /^win/i.test(navigator.platform) &&
			settings.exportFormat === "mp4" && settings.exportPipelineModel === "modern") {
			const capture = capturePausedExportPreview(playback);
			session.preparedPreviewRef.current = capture;
			void capture.then(() => {
				if (session.preparedPreviewRef.current === capture) open();
			});
			return;
		}
		session.preparedPreviewRef.current = null;
		open();
	}, [uiText, videoPath, videoPlaybackRef, settings.exportFormat, settings.exportPipelineModel, session]);

	const resolveCurrentSettings = useCallback(
		(exportFormat: ExportFormat = settings.exportFormat) => {
			const video = videoPlaybackRef.current?.video;
			if (!videoPath) {
				toast.error(uiText("noVideoLoaded11795f"));
				return null;
			}
			if (!video) {
				toast.error(uiText("videoNotReady"));
				return null;
			}
			if (video.videoWidth <= 0 || video.videoHeight <= 0) {
				toast.error(uiText("videoMetadataIsStillLoading"));
				return null;
			}

			return resolveExportStartSettings({
				sourceWidth: video.videoWidth,
				sourceHeight: video.videoHeight,
				exportFormat,
				includeCaptionSidecar: hasCaptionsForSidecar && settings.includeCaptionSidecar,
				exportEncodingMode: settings.exportEncodingMode,
				exportQuality: settings.exportQuality,
				exportBitrateMbps: settings.exportBitrateMbps,
				mp4FrameRate: settings.mp4FrameRate,
				exportBackendPreference: settings.exportBackendPreference,
				exportPipelineModel: settings.exportPipelineModel,
				gifFrameRate: settings.gifFrameRate,
				gifLoop: settings.gifLoop,
				gifSizePreset: settings.gifSizePreset,
			});
		},
		[uiText, videoPath, videoPlaybackRef, hasCaptionsForSidecar, settings],
	);

	const handleStartExportFromDropdown = useCallback(() => {
		if (session.isExporting) return;
		const resolvedSettings = resolveCurrentSettings();
		if (!resolvedSettings) return;
		session.setExportError(null);
		session.setExportedFilePath(undefined);
		session.setShowExportDropdown(true);
		preflight.start(resolvedSettings);
	}, [resolveCurrentSettings, session, preflight]);

	const handleCancelExport = useCallback(() => {
		if (!session.isExporting || session.cancelledExportRunIdRef.current !== null) return;
		const cancelledRun = session.exportRunIdRef.current;
		session.cancelledExportRunIdRef.current = cancelledRun;
		session.exportRunIdRef.current += 1;
		session.exporterRef.current?.cancel();
		session.exporterRef.current = null;
		toast.info(uiText("exportCanceled"));
		session.clearPendingExportSave();
		session.setShowExportDropdown(false);
		window.setTimeout(() => {
			if (session.cancelledExportRunIdRef.current === cancelledRun) session.setIsExporting(false);
		}, 5000);
		session.setExportProgress(null);
		session.setExportError(null);
		session.setExportedFilePath(undefined);
	}, [uiText, session]);

	const handleExportDropdownClose = useCallback(() => {
		session.preparedPreviewRef.current = null;
		preflight.reset();
		session.clearPendingExportSave();
		session.setShowExportDropdown(false);
		session.setExportProgress(null);
		session.setExportError(null);
	}, [session, preflight]);

	const handleRetrySaveExport = useCallback(async () => {
		const pendingSave = session.pendingExportSaveRef.current;
		if (!pendingSave) return;

		const saveResult = pendingSave.tempFilePath
			? await window.electronAPI.finalizeExportedVideo({
					tempPath: pendingSave.tempFilePath,
					fileName: pendingSave.fileName,
					outputPath: null,
					captionSidecar: pendingSave.captionSidecar,
				})
			: pendingSave.arrayBuffer
				? await window.electronAPI.saveExportedVideo(
						pendingSave.arrayBuffer,
						pendingSave.fileName,
						pendingSave.captionSidecar,
					)
				: { success: false, message: uiText("noPendingExportToSave") };

		if (saveResult.canceled) {
			session.setExportError(
				uiText("saveDialogCanceledClickSaveAgainToSaveWithoutReRendering"),
			);
			toast.info(uiText("saveCanceledYouCanTryAgain"));
			return;
		}
		if (saveResult.success && saveResult.path) {
			session.pendingExportSaveRef.current = null;
			session.setHasPendingExportSave(false);
			session.setExportError(null);
			session.setExportedFilePath(saveResult.path);
			showExportSuccessToast(saveResult.path, settings.revealAfterExport);
			session.setShowExportDropdown(true);
			return;
		}

		const errorMessage = saveResult.message || uiText("failedToSaveVideo");
		logError("export", errorMessage, saveResult.error);
		session.setExportError(errorMessage);
		toast.error(errorMessage);
	}, [uiText, session, showExportSuccessToast, settings.revealAfterExport]);

	const revealExportedFile = useCallback(async () => {
		if (!session.exportedFilePath) return;
		try {
			const result = await window.electronAPI.revealInFolder(session.exportedFilePath);
			if (!result.success) {
				toast.error(result.error || result.message || uiText("failedToRevealItemInFolder"));
			}
		} catch (error) {
			toast.error(uiText("failedToRevealItemInFolderValue", { value0: String(error) }));
		}
	}, [uiText, session.exportedFilePath]);

	return {
		handleOpenExportDropdown,
		handleStartExportFromDropdown,
		handleCancelExport,
		handleExportDropdownClose,
		handleRetrySaveExport,
		revealExportedFile,
	};
}
