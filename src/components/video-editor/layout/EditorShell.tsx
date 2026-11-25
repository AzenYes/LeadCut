import { ChapterProgressPanel } from "../ChapterProgressPanel";
import { ChangeReviewPanel } from "../ChangeReviewPanel";
import { getCutReviewRange } from "../changeLogRestore";
import { sortClipRegions } from "../types";
import { CaptionOverviewPanel, type CaptionPanelMemory } from "../captionList/CaptionOverviewPanel";
import { useUiText } from "@/i18n/useUiText";
import { findStartupPreviewVideo } from "@/lib/startupEditorPreview";
import { OnboardingController } from "@/components/onboarding/OnboardingController";
import { DashboardSettingsContext } from "../dashboard/DashboardSettings";
import { useVideoSourceRecovery } from "../hooks/useVideoSourceRecovery";
import { useRecordingLibrary } from "../library/useRecordingLibrary";
import { RecordingLibraryPanel } from "../library/RecordingLibraryPanel";
import { RECORDING_DRAG_TYPE } from "@/types/recordingLibrary";
import { Button } from "@/components/ui/button";
import { BackgroundTaskStatus } from "@/components/ui/BackgroundTaskStatus";
import { useCallback, useMemo, useEffect, useRef, useState, type ComponentProps } from "react";
import { toast, Toaster } from "@/components/ui/toast";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import type { useI18n } from "@/contexts/I18nContext";
import type { useEditorExportController } from "../export/useEditorExportController";
import { isModernMp4Export } from "../exportStatusModel";
import { KeystrokeStylePanel } from "../keystrokes/KeystrokeStylePanel";
import type { useExportDimensions } from "../export/useExportDimensions";
import type { useExportSession } from "../export/useExportSession";
import type { useExportSettings } from "../export/useExportSettings";
import type { useTimelineEditingController } from "../hooks/useTimelineEditingController";
import type { useVideoEditorPresets } from "../presets/useVideoEditorPresets";
import { pickRecordingAppearanceDefaults } from "../presets/recordingAppearanceDefaults";
import { saveEditorPreferences } from "../editorPreferences";
import { ApplicationSettings } from "../ApplicationSettings";
import { SettingsSections } from "../SettingsSections";
import type { useEditorProjectController } from "../project/useEditorProjectController";
import { VersionHistoryPanel, VersionPreviewBanner } from "../project/VersionHistoryPanel";
import type { SettingsPanel } from "../SettingsPanel";
import type { useAppearanceState } from "../state/useAppearanceState";
import type { useEditorUiState } from "../state/useEditorUiState";
import type { useProjectState } from "../state/useProjectState";
import type { useTimelineState } from "../state/useTimelineState";
import { CropEditorDialog } from "./CropEditorDialog";
import { EditorDialogs } from "./EditorDialogs";
import { EditorLoadingSkeleton } from "./EditorLoadingSkeleton";
import { EditorHeader } from "./EditorHeader";
import { EditorPreviewPanel } from "./EditorPreviewPanel";
import { EditorSidebar } from "./EditorSidebar";
import { EditorTimelinePanel } from "./EditorTimelinePanel";

type Props = {
	t: ReturnType<typeof useI18n>["t"];
	project: ReturnType<typeof useProjectState>;
	appearance: ReturnType<typeof useAppearanceState>;
	timeline: ReturnType<typeof useTimelineState>;
	ui: ReturnType<typeof useEditorUiState>;
	presets: ReturnType<typeof useVideoEditorPresets>;
	projectController: ReturnType<typeof useEditorProjectController>;
	editing: ReturnType<typeof useTimelineEditingController>;
	exportController: ReturnType<typeof useEditorExportController>;
	exportSettings: ReturnType<typeof useExportSettings>;
	exportSession: ReturnType<typeof useExportSession>;
	exportDimensions: ReturnType<typeof useExportDimensions>;
	settingsPanelProps: ComponentProps<typeof SettingsPanel>;
	headerLeftControlsPaddingClass: string;
	hasCaptionsForSidecar: boolean;
	nvidiaCudaExportAvailable: boolean;
	experimentalNvidiaCudaExport: boolean;
	setExperimentalNvidiaCudaExport: (enabled: boolean) => void;
	effectiveShowCursor: boolean;
	previewAspectRatioValue: number;
};

export function EditorShell(props: Props) {
	const uiText = useUiText();
	const [onboardingRequest, setOnboardingRequest] = useState(0);
	const [applicationSettingsOpen, setApplicationSettingsOpen] = useState(false);
	const [savingRecordingDefault, setSavingRecordingDefault] = useState(false);
	const showOnboarding = useCallback(() => setOnboardingRequest((value) => value + 1), []);
	const {
		t,
		project,
		appearance,
		timeline,
		ui,
		presets,
		projectController,
		editing,
		exportController,
		exportSettings,
		exportSession,
		exportDimensions,
		settingsPanelProps,
		headerLeftControlsPaddingClass,
		hasCaptionsForSidecar,
		nvidiaCudaExportAvailable,
		experimentalNvidiaCudaExport,
		setExperimentalNvidiaCudaExport,
		effectiveShowCursor,
		previewAspectRatioValue,
	} = props;
	const captionPanelMemory = useRef<CaptionPanelMemory>({
		scrollTop: 0, query: "", onlyIssues: false, following: true, selection: null,
	});
	const getCaptionPlayheadTime = useCallback(() => (ui.videoPlaybackRef.current?.getTimelineTime() ?? 0) * 1000,
		[ui.videoPlaybackRef]);
	const captionRippleDelete = useRef(editing.sequenceTools.rippleDeleteRanges);
	captionRippleDelete.current = editing.sequenceTools.rippleDeleteRanges;
	const handleCaptionRippleDelete = useCallback((...args: Parameters<typeof captionRippleDelete.current>) =>
		captionRippleDelete.current(...args), []);
	const library = useRecordingLibrary(project, timeline, ui, appearance);
	// biome-ignore lint/correctness/useExhaustiveDependencies: Changing the active inspector closes the Videos view.
	useEffect(() => {
		library.setOpen(false);
	}, [ui.activeEffectSection, library.setOpen]);
	const timelinePanelRef = useRef<HTMLDivElement>(null);
	const timeAtClientXRef = useRef<((clientX: number) => number | undefined) | null>(null);
	const wasImporting = useRef(false);
	useEffect(() => {
		if (wasImporting.current && !library.importing) timelinePanelRef.current?.focus();
		wasImporting.current = library.importing;
	}, [library.importing]);
	const { setIsPreviewReady, setPreviewVersion } = ui;
	const remountRecoveredVideo = useCallback(() => {
		setIsPreviewReady(false);
		setPreviewVersion((version) => version + 1);
	}, [setIsPreviewReady, setPreviewVersion]);
	const handlePreviewError = useVideoSourceRecovery(project, remountRecoveredVideo);
	const {
		snapshot,
		history,
		lifecycle,
		autoCaption,
		saveActions,
		openActions,
		mediaRelink,
		externalProjectChange,
		versionHistory,
		hasUnsavedChanges,
	} = projectController;
	const {
		cursor,
		projection,
		audio,
		playback,
		captionCommands,
		zoomCommands,
		clipCommands,
		audioCommands,
		annotationCommands,
		handleSelectAnnotation,
		handleAutoSuggestZoomsConsumed,
	} = editing;
	const review = editing.changeReview;
	const reviewProjectKey = project.currentProjectPath ?? snapshot.currentSourcePath;
	const [focusedReviewProject, setFocusedReviewProject] = useState<string | null>(null);
	const timelineDurationMs = Math.round(projection.timelineDuration * 1000);
	const reviewFocusRange = useMemo(() => review.current && focusedReviewProject !== null &&
		focusedReviewProject === reviewProjectKey && !saveActions.previewReadOnly
		? getCutReviewRange(review.current, timelineDurationMs) : null,
	[review.current, focusedReviewProject, reviewProjectKey, saveActions.previewReadOnly, timelineDurationMs]);
	useEffect(() => { setFocusedReviewProject(null); }, [reviewProjectKey, saveActions.previewReadOnly]);
	const returnToFullTimeline = () => setFocusedReviewProject(null);
	const selectPreviewCaption = useCallback((id: string) =>
		captionCommands.handleSelectCaption(id, undefined, { seek: false }), [captionCommands.handleSelectCaption]);
	const { dialogActions, preflight } = exportController;
	const captionTaskBusy = ui.isGeneratingCaptions || settingsPanelProps.isImportingCaptions || settingsPanelProps.isWorkingWithTranscript;
	const dashboardSettingsContent = useMemo(
		() => (
			<ApplicationSettings
				onShowOnboarding={showOnboarding}
				onAutoZoomsChange={appearance.setAutoApplyFreshRecordingAutoZooms}
			/>
		),
		[appearance.setAutoApplyFreshRecordingAutoZooms, showOnboarding],
	);
	const saveRecordingAppearance = async () => {
		setSavingRecordingDefault(true);
		const saved = await saveEditorPreferences(pickRecordingAppearanceDefaults(snapshot.currentPersistedEditorState), { flush: true });
		setSavingRecordingDefault(false);
		if (saved) toast.success(t("common.interface.recordingAppearanceDefaultSaved"));
		else toast.error(t("common.interface.recordingAppearanceDefaultFailed"));
	};
	const onboarding = (
		<OnboardingController
			requestNonce={onboardingRequest}
			ready={!project.loading}
			canGuide={Boolean(project.videoPath) && !project.projectBrowserOpen && !saveActions.previewReadOnly}
		/>
	);
	const editorDialogs = (
			<DashboardSettingsContext.Provider value={dashboardSettingsContent}>
				<EditorDialogs
					t={t}
					projectSaveDialogOpen={project.projectSaveDialogOpen}
					setProjectSaveDialogOpen={project.setProjectSaveDialogOpen}
					projectSaveDialogDraft={project.projectSaveDialogDraft}
					setProjectSaveDialogDraft={project.setProjectSaveDialogDraft}
					projectSaveDialogInputRef={ui.projectSaveDialogInputRef}
					isSavingProjectDialog={project.isSavingProjectDialog}
					resolveProjectSaveDialog={lifecycle.resolveProjectSaveDialog}
					handleProjectSaveDialogSubmit={saveActions.handleProjectSaveDialogSubmit}
					unsavedChangesDialogOpen={project.unsavedChangesDialogOpen}
					setUnsavedChangesDialogOpen={project.setUnsavedChangesDialogOpen}
					unsavedChangesDialogActionLabel={project.unsavedChangesDialogActionLabel}
					resolveUnsavedChangesDialog={lifecycle.resolveUnsavedChangesDialog}
					externalProjectChange={externalProjectChange}
					mediaRelink={mediaRelink}
					projectBrowserOpen={project.projectBrowserOpen}
					onProjectBrowserOpenChange={openActions.handleProjectBrowserOpenChange}
					projectLibraryEntries={project.projectLibraryEntries}
					projectLibraryLoading={project.projectLibraryLoading}
					projectError={project.projectLibraryError}
					onRetryProjectLibrary={projectController.refreshProjectLibrary}
					onDeleteProjects={openActions.handleDeleteProjects}
					onRenameProject={openActions.handleRenameLibraryProject}
					handleImportMediaOrProject={openActions.handleImportMediaOrProject}
					handleOpenProjectFromLibrary={openActions.handleOpenProjectFromLibrary}
					nativeCaptureUnavailableModalOpen={ui.nativeCaptureUnavailableModalOpen}
					setNativeCaptureUnavailableModalOpen={ui.setNativeCaptureUnavailableModalOpen}
				/>
			</DashboardSettingsContext.Provider>
	);
	if (project.loading && !project.error)
		return (
			<>
				<EditorLoadingSkeleton />

				{editorDialogs}
				{onboarding}
				<Toaster className="pointer-events-auto" />
			</>
		);
	if (project.error)
		return (
			<div className="flex h-screen flex-col bg-background">
				<VersionPreviewBanner history={versionHistory} />
				<div className="flex flex-1 flex-col items-center justify-center gap-3">
					<div role="alert" className="max-w-xl break-words text-center text-destructive">
						{project.error}
					</div>
					<Button
						variant="ghost"
						ref={ui.projectBrowserFallbackTriggerRef}
						type="button"
						onClick={openActions.handleOpenProjectBrowser}
						disabled={saveActions.previewReadOnly}
						className="px-3 py-1.5 text-sm"
					>
						{uiText("openProjects")}</Button>
				</div>

				{editorDialogs}
				{onboarding}
				<Toaster className="pointer-events-auto" />
			</div>
		);

	return (
		<div className="flex h-screen flex-col overflow-hidden bg-editor-bg text-foreground selection:bg-accent/20"
			data-version-preview={saveActions.previewReadOnly || undefined}>
			{saveActions.newerProjectReadOnly && (
				<div role="status" className="flex items-center gap-3 border-b border-separator px-4 py-2 text-sm">
					<span>{uiText("projectRequiresNewerLeadCut")}</span>
					<Button variant="ghost" onClick={openActions.handleOpenProjectBrowser}>
						{uiText("openProjects")}
					</Button>
				</div>
			)}
			{saveActions.agentReadOnly && (
				<div role="status" className="flex items-center gap-3 border-b border-separator px-4 py-2 text-sm">
					<span>{uiText("projectAgentEditing")}</span>
					<Button variant="ghost" disabled={projectController.agentHandoffBusy || externalProjectChange.resolving}
						onClick={() => void projectController.changeAgentHandoff(false)}>
						{uiText("projectAgentResumeEditing")}
					</Button>
				</div>
			)}
			<EditorHeader
				clipsOpen={library.open}
				readOnly={saveActions.previewReadOnly}
				onOpenApplicationSettings={() => setApplicationSettingsOpen(true)}
				onOpenVersionHistory={() => void versionHistory.show()}
				onHandOffToAgent={project.currentProjectPath && typeof window.electronAPI.setProjectAgentHandoff === "function"
					? () => void projectController.changeAgentHandoff(true)
					: undefined}
				agentHandoffBusy={projectController.agentHandoffBusy || externalProjectChange.resolving}
				onToggleClips={() => library.setOpen((open) => !open)}
				t={t}
				headerLeftControlsPaddingClass={headerLeftControlsPaddingClass}
				project={project}
				projectBrowserTriggerRef={ui.projectBrowserTriggerRef}
				projectNameInputRef={ui.projectNameInputRef}
				projectDisplayName={snapshot.projectDisplayName}
				hasUnsavedChanges={hasUnsavedChanges}
				saveFeedback={saveActions.saveFeedback}
				handleSaveProject={saveActions.handleSaveProject}
				historyFlags={history.flags}
				handleOpenProjectBrowser={openActions.handleOpenProjectBrowser}
				handleOpenProjectFile={openActions.handleOpenProjectFile}
				handleSaveProjectAs={saveActions.handleSaveProjectAs}
				handleUndo={history.handleUndo}
				handleRedo={history.handleRedo}
				handleProjectNameSubmit={saveActions.handleProjectNameSubmit}
				closeProjectNameEditor={saveActions.closeProjectNameEditor}
				presets={presets}
				exportSettings={exportSettings}
				exportSession={exportSession}
				exportPreflight={preflight}
				exportDimensions={exportDimensions}
				timelineDuration={projection.timelineDuration}
				hasCaptionsForSidecar={hasCaptionsForSidecar}
				nvidiaCudaExportAvailable={nvidiaCudaExportAvailable}
				experimentalNvidiaCudaExport={experimentalNvidiaCudaExport}
				setExperimentalNvidiaCudaExport={setExperimentalNvidiaCudaExport}
				handleOpenExportDropdown={dialogActions.handleOpenExportDropdown}
				handleExportDropdownClose={dialogActions.handleExportDropdownClose}
				handleCancelExport={dialogActions.handleCancelExport}
				handleRetrySaveExport={dialogActions.handleRetrySaveExport}
				handleStartExportFromDropdown={dialogActions.handleStartExportFromDropdown}
				revealExportedFile={dialogActions.revealExportedFile}
			/>
			<VersionPreviewBanner history={versionHistory} />
			{(settingsPanelProps.whisperModelDownloadStatus === "downloading" || ui.isGeneratingCaptions) && (
				<div className="grid gap-2 border-b border-separator bg-background px-4 py-2 sm:grid-cols-2">
					{settingsPanelProps.whisperModelDownloadStatus === "downloading" && (
						<BackgroundTaskStatus title={uiText("downloadingCaptionModel")}
							progress={settingsPanelProps.whisperModelDownloadProgress ?? 0}
							detail={`${Math.round(settingsPanelProps.whisperModelDownloadProgress ?? 0)}%`}
							action={settingsPanelProps.onCancelWhisperModelDownload && (
								<Button size="sm" variant="outline" onClick={settingsPanelProps.onCancelWhisperModelDownload}>{uiText("cancel")}</Button>
							)} />
					)}
					{ui.isGeneratingCaptions && (
						<BackgroundTaskStatus title={uiText("captionRecognitionRunning")}
							progress={settingsPanelProps.captionGenerationProgress ?? 0}
							detail={`${Math.round(settingsPanelProps.captionGenerationProgress ?? 0)}%`}
							action={settingsPanelProps.onCancelAutoCaptions && (
								<Button size="sm" variant="outline" onClick={settingsPanelProps.onCancelAutoCaptions}>{uiText("cancel")}</Button>
							)} />
					)}
				</div>
			)}
			<div
				className="relative flex min-h-0 flex-1 flex-col"
				onPointerDownCapture={(event) => {
					if ((event.target as HTMLElement).closest("[data-timeline-item]"))
						library.setOpen(false);
				}}
				onDragOver={(event) => {
					if (saveActions.isPreviewReadOnly()) return;
					if (event.dataTransfer.types.includes(RECORDING_DRAG_TYPE)) {
						event.preventDefault();
						event.dataTransfer.dropEffect = "copy";
					}
				}}
				onDrop={(event) => {
					if (saveActions.isPreviewReadOnly()) return;
					const path = event.dataTransfer.getData(RECORDING_DRAG_TYPE);
					if (!path) return;
					event.preventDefault();
					event.stopPropagation();
					const timelinePanel = (event.target as HTMLElement).closest(
						"[data-timeline-panel]",
					);
					let index: number | undefined;
					const dropTime = timelinePanel ? timeAtClientXRef.current?.(event.clientX) : undefined;
					if (dropTime !== undefined) {
						const clips = sortClipRegions(timeline.clipRegions);
						const next = clips.findIndex(({ startMs, endMs }) => dropTime < (startMs + endMs) / 2);
						index = next < 0 ? clips.length : next;
					}
					let paths: unknown;
					try {
						paths = JSON.parse(path);
					} catch {
						paths = [path];
					}
					if (
						Array.isArray(paths) &&
						paths.every((value) => typeof value === "string" && value.length > 0)
					)
						void library.addToTimeline(paths, index);
				}}
			>
				<div className="relative z-10 flex min-h-0 flex-1 pt-3">
					<EditorSidebar
						deferPanels={Boolean(project.videoPath) && !ui.isPreviewReady}
						selectedCaptionId={timeline.selectedCaptionId}
						readOnly={saveActions.previewReadOnly}
						panelKey={library.open ? "library" : ui.activeEffectSection}
						panelContent={
							library.open ? <RecordingLibraryPanel library={library} /> :
								ui.activeEffectSection === "chapters" ? <ChapterProgressPanel value={timeline.chapterProgress} onChange={timeline.setChapterProgress} sequence={timeline} getCurrentTime={ui.playbackClock.getTime} onSeek={editing.playback.handleTimelineSeek} /> :
								ui.activeEffectSection === "keystrokes" ? <KeystrokeStylePanel settings={timeline.keystrokeOverlay} onChange={timeline.setKeystrokeOverlay} recording={timeline.recordedKeystrokes} /> :
								ui.activeEffectSection === "captionList" ? (
									<CaptionOverviewPanel
										emptyActions={project.videoPath && !saveActions.previewReadOnly && (
											<>
												<Button type="button" size="sm" variant="secondary" disabled={captionTaskBusy}
													onClick={() => {
														ui.setActiveEffectSection("captions");
														if (ui.whisperModelPath) settingsPanelProps.onGenerateAutoCaptions?.();
													}}>
													{t(ui.whisperModelPath ? "settings.captions.generateFull" : "common.interface.setupCaptionRecognition")}
												</Button>
												<Button type="button" size="sm" variant="outline" disabled={captionTaskBusy}
													onClick={settingsPanelProps.onImportSrtCaptions}>
													{t(settingsPanelProps.isImportingCaptions ? "settings.captions.importingSrt" : "settings.captions.importSrt")}
												</Button>
												{project.currentProjectPath && timelineDurationMs > 0 && typeof window.electronAPI.setProjectAgentHandoff === "function" && (
													<Button type="button" size="sm" variant="ghost" disabled={captionTaskBusy || projectController.agentHandoffBusy}
														onClick={() => void projectController.changeAgentHandoff(true)}>
														{t("common.interface.projectHandOffToAgent")}
													</Button>
												)}
											</>
										)}
										rows={projection.effectiveCaptionRegions}
										appearance={timeline.autoCaptionSettings}
										durationMs={projection.timelineDuration * 1000}
										cues={timeline.autoCaptions}
										clips={timeline.clipRegions}
										getPlayheadTime={getCaptionPlayheadTime}
										playbackClock={ui.playbackClock}
										isPlaying={ui.isPlaying}
										selectedCueId={timeline.selectedCaptionId}
										onSelect={captionCommands.handleSelectCaption}
										onPlayFrom={editing.playback.playFromTime}
										onPlayRange={editing.playback.playRange}
										onTogglePlay={editing.playback.togglePlayPause}
										onPause={editing.playback.pauseOnly}
										onTextEdit={captionCommands.handleCaptionTextEdit}
										onRetime={captionCommands.handleCaptionRetime}
										setCues={timeline.setAutoCaptions}
										onRippleDelete={handleCaptionRippleDelete}
										memory={captionPanelMemory.current}
									/>
								) : ui.activeEffectSection === "review" ? (
									<ChangeReviewPanel
										key={reviewProjectKey}
										review={review}
										recentAgentCutIds={projectController.recentAgentCutIds}
										agentEdits={projectController.agentEdits}
										project={{
											name: snapshot.projectDisplayName, path: project.currentProjectPath,
											id: project.lastSavedSnapshot?.projectId ?? null, sourcePath: snapshot.currentSourcePath,
										}}
										focused={Boolean(reviewFocusRange)}
										canFocus={timelineDurationMs > 0 && reviewProjectKey !== null}
										onToggleFocus={entry => {
											if (reviewFocusRange && review.selected === entry.id) returnToFullTimeline();
											else {
												review.select(entry);
												setFocusedReviewProject(reviewProjectKey);
											}
										}}
									/>
								) : undefined
						}
						t={t}
						activeSection={ui.activeEffectSection}
						setActiveSection={(section) => {
							library.setOpen(false);
							timeline.setSelectedRegionIds([]);
							timeline.setSelectedVideoId(null);
							timeline.setSelectedAnnotationId(null);
							timeline.setSelectedZoomId(null);
							timeline.setSelectedClipId(null);
							timeline.setSelectedAudioId(null);
							if (ui.activeEffectSection !== "captionList" && section !== "captionList") timeline.setSelectedCaptionId(null);
							ui.setActiveEffectSection(section);
						}}
						settingsPanelProps={{
							...settingsPanelProps,
							onSaveRecordingDefault: project.videoPath ? () => void saveRecordingAppearance() : undefined,
							savingRecordingDefault,
						}}
					/>
					<EditorPreviewPanel
						readOnly={saveActions.previewReadOnly}
						t={t}
						videoPath={project.videoPath}
						previewVersion={ui.previewVersion}
						aspectRatio={ui.aspectRatio}
						setAspectRatio={ui.setAspectRatio}
						previewAspectRatioValue={previewAspectRatioValue}
						videoPlaybackRef={ui.videoPlaybackRef}
						timelineRef={ui.timelineRef}
						playbackClock={ui.playbackClock}
						isPlaying={ui.isPlaying}
						previewVolume={ui.previewVolume}
						setPreviewVolume={ui.setPreviewVolume}
						suspendRendering={exportSession.isExporting && isModernMp4Export(exportSettings.exportFormat, exportSettings.exportPipelineModel)}
						exportPreview={exportSession.preview}
						appearance={appearance}
						timeline={timeline}
						audio={audio}
						projection={projection}
						playback={playback}
						zoomCommands={zoomCommands}
						annotationCommands={annotationCommands}
						effectiveCursorTelemetry={cursor.effectiveCursorTelemetry}
						effectiveShowCursor={effectiveShowCursor}
						isCropped={ui.isCropped}
						handleOpenCropEditor={ui.handleOpenCropEditor}
						handleSaveAutoCaptionEdit={autoCaption.handleSaveAutoCaptionEdit}
						handleSelectAutoCaption={ui.activeEffectSection === "captionList" ? selectPreviewCaption : undefined}
						handleSelectAnnotation={handleSelectAnnotation}
						setDuration={ui.setDuration}
						isPreviewReady={ui.isPreviewReady}
						setIsPreviewReady={ui.setIsPreviewReady}
						setIsPlaying={ui.setIsPlaying}
						setError={handlePreviewError}
					/>
				</div>
				<EditorTimelinePanel
					deferInitialTracks={Boolean(!ui.isPreviewReady && project.videoPath && findStartupPreviewVideo(project.videoPath))}
					onBrowseClips={() => library.setOpen(true)}
					onOpenMedia={() => void openActions.handleImportMediaOrProject()}
					readOnly={saveActions.previewReadOnly}
					changeMarkers={review.markers}
					focusRange={reviewFocusRange}
					onReturnToFullTimeline={returnToFullTimeline}
					sequenceTools={editing.sequenceTools}
					videoCommands={editing.videoCommands}
					panelRef={timelinePanelRef}
					timeAtClientXRef={timeAtClientXRef}
					timelineRef={ui.timelineRef}
					timeline={timeline}
					projection={projection}
					playback={playback}
					audio={audio}
					zoomCommands={zoomCommands}
					clipCommands={clipCommands}
					audioCommands={audioCommands}
					captionCommands={captionCommands}
					annotationCommands={annotationCommands}
					videoPath={project.videoPath}
					videoSourcePath={project.videoSourcePath}
					cursorTelemetrySourcePath={timeline.cursorTelemetrySourcePath}
					normalizedCursorTelemetry={cursor.normalizedCursorTelemetry}
					autoSuggestZoomsTrigger={ui.autoSuggestZoomsTrigger}
					handleAutoSuggestZoomsConsumed={handleAutoSuggestZoomsConsumed}
					disableSuggestedZooms={!appearance.autoApplyFreshRecordingAutoZooms}
					playbackClock={ui.playbackClock}
					handleSelectAnnotation={handleSelectAnnotation}
				/>
			</div>
			{library.importing && (
				<div
					className="fixed inset-0 z-[100] flex items-center justify-center bg-background/80"
					role="status"
					aria-live="polite"
				>
					<div className="rounded-xl border border-separator bg-background p-6 text-center">
						<p className="font-medium">{t("editor.media.addingVideo")}</p>
						<p className="mt-2 text-sm text-muted-foreground">
							{t("editor.media.preparingFootage")}
						</p>
						<Button
							className="mt-4"
							variant="ghost"
							size="sm"
							disabled={library.cancelling}
							onClick={() => void library.cancelImport()}
						>
							{t("common.actions.cancel", "Cancel")}
						</Button>
					</div>
				</div>
			)}

			{editorDialogs}
			{applicationSettingsOpen && (
				<Dialog open onOpenChange={setApplicationSettingsOpen}>
					<DialogContent aria-label={t("common.interface.applicationSettings")}>
						<DialogHeader>
							<DialogTitle>{t("common.interface.applicationSettings")}</DialogTitle>
							<DialogDescription>{t("common.interface.settingsScopeApplication")}</DialogDescription>
						</DialogHeader>
						<SettingsSections categories={["general", "motion"]}>
							<ApplicationSettings
								onShowOnboarding={() => { setApplicationSettingsOpen(false); showOnboarding(); }}
								onAutoZoomsChange={appearance.setAutoApplyFreshRecordingAutoZooms}
								beforeOpenShortcuts={() => setApplicationSettingsOpen(false)}
							/>
						</SettingsSections>
					</DialogContent>
				</Dialog>
			)}
			{onboarding}
			<CropEditorDialog
				open={ui.showCropModal}
				t={t}
				videoElement={ui.videoPlaybackRef.current?.video ?? null}
				cropRegion={appearance.cropRegion}
				setCropRegion={appearance.setCropRegion}
				aspectRatio={ui.aspectRatio}
				onCancel={ui.handleCancelCropEditor}
				onDone={ui.handleCloseCropEditor}
			/>
			<VersionHistoryPanel history={versionHistory} />
			<Toaster className="pointer-events-auto" />
		</div>
	);
}
