import { useUiText } from "@/i18n/useUiText";
import { Export } from "@phosphor-icons/react";
import { useLayoutEffect, useRef, useState } from "react";
import { Card } from "@heroui/react";
import { motion, useReducedMotion } from "motion/react";
import { BackgroundTaskStatus } from "@/components/ui/BackgroundTaskStatus";

import { toast } from "@/components/ui/toast";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import type { useI18n } from "@/contexts/I18nContext";
import { ExportSettingsMenu } from "../ExportSettingsMenu";
import type { useExportDimensions } from "../export/useExportDimensions";
import type { useExportPreflight } from "../export/useExportPreflight";
import type { useExportSession } from "../export/useExportSession";
import type { useExportSettings } from "../export/useExportSettings";
import { useExportStatusViewModel } from "../export/useExportStatusViewModel";
import { useExportMessages } from "../export/useExportMessages";
import { ExportPreflightPanel } from "./ExportPreflightPanel";

type Props = {
	projectPath?: string | null;
	t: ReturnType<typeof useI18n>["t"];
	exportSettings: ReturnType<typeof useExportSettings>;
	exportSession: ReturnType<typeof useExportSession>;
	preflight: ReturnType<typeof useExportPreflight>;
	exportDimensions: ReturnType<typeof useExportDimensions>;
	timelineDuration: number;
	hasCaptionsForSidecar: boolean;
	nvidiaCudaExportAvailable: boolean;
	experimentalNvidiaCudaExport: boolean;
	setExperimentalNvidiaCudaExport: (enabled: boolean) => void;
	handleOpenExportDropdown: () => void;
	handleExportDropdownClose: () => void;
	handleCancelExport: () => void;
	handleRetrySaveExport: () => void;
	handleStartExportFromDropdown: () => void;
	revealExportedFile: () => void;
	projectTitle: string;
};

export function EditorExportMenu(props: Props) {
	const uiText = useUiText();
	const reducedMotion = useReducedMotion();
	const contentRef = useRef<HTMLDivElement>(null);
	const [contentHeight, setContentHeight] = useState<number>();
	const [exportingDiagnostics, setExportingDiagnostics] = useState(false);
	const exportDiagnostics = async () => {
		setExportingDiagnostics(true);
		try {
			const result = await window.electronAPI.exportDiagnosticsBundle();
			if (result.success) toast.success(uiText("diagnosticsBundleExported"));
			else if (!result.canceled) toast.error(result.message || uiText("diagnosticsBundleFailed"));
		} catch {
			toast.error(uiText("diagnosticsBundleFailed"));
		} finally {
			setExportingDiagnostics(false);
		}
	};
	useLayoutEffect(() => {
		if (!props.exportSession.showExportDropdown) return;
		const content = contentRef.current;
		if (!content) return;
		// The popover scales in on entry. Its bounding rect includes that scale,
		// so measuring it would lock the wrapper to a height smaller than its content.
		const measure = () => setContentHeight(content.offsetHeight);
		measure();
		const observer = new ResizeObserver(measure);
		observer.observe(content);
		return () => observer.disconnect();
	}, [props.exportSession.showExportDropdown]);

	const {
		t,
		exportSettings,
		exportSession,
		preflight,
		exportDimensions,
		hasCaptionsForSidecar,
		nvidiaCudaExportAvailable,
		experimentalNvidiaCudaExport,
		setExperimentalNvidiaCudaExport,
		handleOpenExportDropdown,
		handleExportDropdownClose,
		handleCancelExport,
		handleRetrySaveExport,
		handleStartExportFromDropdown,
		revealExportedFile,
	} = props;
	const {
		exportQuality,
		setExportQuality,
		exportBitrateMbps,
		setExportBitrateMbps,
		exportEncodingMode,
		setExportEncodingMode,
		exportPipelineModel,
		mp4FrameRate,
		setMp4FrameRate,
		exportFormat,
		setExportFormat,
		gifFrameRate,
		setGifFrameRate,
		gifLoop,
		setGifLoop,
		gifSizePreset,
		setGifSizePreset,
		includeCaptionSidecar,
		setIncludeCaptionSidecar,
		revealAfterExport,
		setRevealAfterExport,
	} = exportSettings;
	const {
		isExporting,
		exportError,
		showExportDropdown,
		setShowExportDropdown,
		preflightIssues,
		exportedFilePath,
		hasPendingExportSave,
	} = exportSession;
	const { gifOutputDimensions, mp4OutputDimensions } = exportDimensions;
	const exportStatus = useExportStatusViewModel({ t, session: exportSession, settings: exportSettings });
	const exportMessage = useExportMessages({ t, active: exportStatus.isLightningExportInProgress });
	const {
		exportProgress,
		isExportPreparing,
		isExportSaving,
		isRenderingAudio,
		isExportFinalSaveIndeterminate,
		isLightningExportInProgress,
		isLegacyExportInProgress,
		exportFinalizingProgress,
		exportRenderSpeedLabel,
		exportPercentLabel,
		runtimeLabel: exportRuntimeLabel,
		nativeSkipLabel: exportNativeSkipLabel,
	} = exportStatus;

	const settingsForm = (
		<ExportSettingsMenu
			exportFormat={exportFormat}
			onExportFormatChange={setExportFormat}
			exportEncodingMode={exportEncodingMode}
			onExportEncodingModeChange={setExportEncodingMode}
			mp4FrameRate={mp4FrameRate}
			onMp4FrameRateChange={setMp4FrameRate}
			exportPipelineModel={exportPipelineModel}
			experimentalNvidiaCudaExport={experimentalNvidiaCudaExport && nvidiaCudaExportAvailable}
			onExperimentalNvidiaCudaExportChange={setExperimentalNvidiaCudaExport}
			nvidiaCudaExportAvailable={nvidiaCudaExportAvailable}
			exportQuality={exportQuality}
			onExportQualityChange={setExportQuality}
			exportBitrateMbps={exportBitrateMbps}
			onExportBitrateMbpsChange={setExportBitrateMbps}
			timelineDuration={props.timelineDuration}
			gifFrameRate={gifFrameRate}
			onGifFrameRateChange={setGifFrameRate}
			gifLoop={gifLoop}
			onGifLoopChange={setGifLoop}
			gifSizePreset={gifSizePreset}
			onGifSizePresetChange={setGifSizePreset}
			showCaptionSidecarOption={hasCaptionsForSidecar && exportFormat === "mp4"}
			includeCaptionSidecar={includeCaptionSidecar}
			onIncludeCaptionSidecarChange={setIncludeCaptionSidecar}
			revealAfterExport={revealAfterExport}
			onRevealAfterExportChange={setRevealAfterExport}
			mp4OutputDimensions={mp4OutputDimensions}
			gifOutputDimensions={gifOutputDimensions}
			onExport={handleStartExportFromDropdown}
			exportDisabled={preflight.isChecking}
			hideHeading
			className="rounded-none bg-transparent px-5 pb-5 pt-0 shadow-none"
		/>
	);

	return (
		<>
			<Popover
				open={showExportDropdown}
				onOpenChange={(open) => {
					if (open) {
						handleOpenExportDropdown();
					} else {
						preflight.reset();
						setShowExportDropdown(false);
					}
				}}
				modal={true}
			>
				<PopoverTrigger asChild>
					<Button
						type="button"
						data-onboarding-target="export"
						className="inline-flex h-9 min-w-[104px] items-center justify-center gap-2 px-4.5 data-[onboarding-active]:ring-2 data-[onboarding-active]:ring-accent"
					>
						<Export className="h-4 w-4" />
						<span className="text-sm font-semibold tracking-tight">
							{t("editor.actions.exportVideo", "Export video")}
						</span>
					</Button>
				</PopoverTrigger>
				<PopoverContent
					data-export-menu
					aria-label={t("editor.actions.exportVideo", "Export video")}
					align="end"
					sideOffset={10}
					className="w-[360px] max-h-[calc(100dvh-88px)] overflow-y-auto p-0"
				>
					<motion.div
						initial={false}
						animate={{ height: contentHeight ?? "auto" }}
						transition={{ duration: reducedMotion ? 0 : 0.22, ease: "easeInOut" }}
						className="overflow-hidden"
					>
						<div ref={contentRef}>
							<div className="p-5 space-y-3">
								<h2 className="text-sm font-semibold">
									{t("editor.actions.exportVideo", "Export video")}
								</h2>
							</div>
							<div>
								{isExporting ? (
									<Card className="rounded-none bg-transparent p-5 text-foreground shadow-none">
										<BackgroundTaskStatus
											title={t("editor.exportStatus.exporting", "Exporting")}
											detail={exportPercentLabel}
											progress={isExportPreparing || isExportSaving || isExportFinalSaveIndeterminate
												? null : Math.min(100, isRenderingAudio ? (exportProgress?.audioProgress ?? 0) * 100
													: exportFinalizingProgress ?? exportProgress?.percentage ?? 8)}
											action={<Button type="button" variant="outline" onClick={handleCancelExport} className="h-8 px-3 text-xs">
												{t("common.actions.cancel")}
											</Button>}
										/>
										{isLightningExportInProgress && exportMessage && <p className="mt-1 text-[11px] text-muted-foreground">{exportMessage}</p>}
										{isLegacyExportInProgress && <p className="mt-1 text-[11px] text-muted-foreground">{uiText("exportTooSlowCancelAndTryLightningExport")}</p>}
										{isRenderingAudio ? (
											<p className="mt-1 text-[11px] text-muted-foreground/70">
												{t(
													"editor.export.processingAudioEdits",
													"Processing audio with speed/overlay edits",
												)}
											</p>
										) : exportRenderSpeedLabel ? (
											<p className="mt-1 text-[11px] text-muted-foreground/70">
												{exportRenderSpeedLabel}
											</p>
										) : null}
										{exportRuntimeLabel ? (
											<p className="mt-1 text-[11px] text-muted-foreground/70">
												{uiText("path")}{exportRuntimeLabel}
											</p>
										) : null}
										{exportNativeSkipLabel ? (
											<p className="mt-1 text-[11px] text-amber-500/80">
												{exportNativeSkipLabel}
											</p>
										) : null}
									</Card>
								) : exportError ? (
									<Card className="rounded-none bg-transparent p-5 text-foreground shadow-none">
										<p className="text-sm font-semibold text-foreground">
											{t("editor.exportStatus.issue", "Export issue")}
										</p>
										{exportRuntimeLabel ? (
											<p className="mt-1 text-[11px] text-muted-foreground/70">
												{uiText("path")}{exportRuntimeLabel}
											</p>
										) : null}
										<p className="mt-1 select-text whitespace-pre-wrap break-words text-xs leading-relaxed text-muted-foreground">
											{exportError}
										</p>
										<div className="mt-4 flex flex-wrap gap-2">
											<Button
												type="button"
												variant="outline"
												className="h-8 text-xs"
												onClick={async () => {
													try {
														await navigator.clipboard.writeText(
															exportError,
														);
														toast.success(
															t(
																"editor.exportStatus.errorCopied",
																"Error copied",
															),
														);
													} catch {
														toast.error(
															t(
																"editor.exportStatus.errorCopyFailed",
																"Couldn't copy. Select the error text and copy it manually.",
															),
														);
													}
												}}
											>
												{t("editor.exportStatus.copyError", "Copy error")}
											</Button>
											<Button
												type="button"
												variant="outline"
												className="h-8 text-xs"
												disabled={exportingDiagnostics}
												onClick={() => void exportDiagnostics()}
											>
												{uiText("exportDiagnosticsBundle")}
											</Button>
											{hasPendingExportSave ? (
												<Button
													type="button"
													onClick={handleRetrySaveExport}
													className="h-8 flex-1 text-xs"
												>
													{t("editor.actions.saveAgain", "Save Again")}
												</Button>
											) : null}
											<Button
												type="button"
												variant="outline"
												onClick={handleExportDropdownClose}
												className="h-8 flex-1 text-xs"
											>
												{t("common.actions.close", "Close")}
											</Button>
										</div>
									</Card>
								) : exportedFilePath ? (
									<Card className="rounded-none bg-transparent p-5 text-foreground shadow-none">
										<p className="text-sm font-semibold text-foreground">
											{t("editor.exportStatus.complete", "Export complete")}
										</p>
										<p className="mt-1 text-xs text-muted-foreground">
											{t(
												"editor.exportStatus.savedSuccessfully",
												"Your file was saved successfully.",
											)}
										</p>
										{exportRuntimeLabel ? (
											<p className="mt-1 text-[11px] text-muted-foreground/70">
												{uiText("path")}{exportRuntimeLabel}
											</p>
										) : null}
										<p className="mt-3 truncate text-xs text-muted-foreground/70">
											{exportedFilePath.split(/[\\/]/).pop()}
										</p>
										<div className="mt-4 flex gap-2">
											<Button
												type="button"
												onClick={revealExportedFile}
												className="h-8 flex-1 text-xs"
											>
												{t("editor.actions.showInFolder", "Show In Folder")}
											</Button>
											<Button
												type="button"
												variant="outline"
												onClick={handleExportDropdownClose}
												className="h-8 flex-1 text-xs"
											>
												{t("common.actions.done", "Done")}
											</Button>
										</div>
									</Card>
								) : preflightIssues.length > 0 ? (
									<ExportPreflightPanel issues={preflightIssues} preflight={preflight} onCancel={handleExportDropdownClose} />
								) : (
									<>{settingsForm}</>
								)}
							</div>
						</div>
					</motion.div>
				</PopoverContent>
			</Popover>
		</>
	);
}
