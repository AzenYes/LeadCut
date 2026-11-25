import type { Dispatch, MutableRefObject, RefObject, SetStateAction } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "@/components/ui/toast";
import { uiText } from "@/i18n/uiText";
import { requiresNewerProjectReader } from "../../../../services/leadcut-mcp/src/projectFormat";
import type { useI18n } from "@/contexts/I18nContext";
import type { AspectRatio } from "@/utils/aspectRatioUtils";
import { useAutoCaptionController } from "../captions/useAutoCaptionController";
import { normalizeChangeLog } from "../changeLog";
import { loadEditorPreferences, saveEditorPreferences } from "../editorPreferences";
import { useEditorHistory } from "../hooks/useEditorHistory";
import { hasUnsavedProjectChanges } from "../projectDirtyState";
import { deriveNextId, fromFileUrl, normalizeProjectEditor, validateProjectData } from "../projectPersistence";
import { emptyChapterProgress } from "../chapterProgress";
import { getDevOpenRecordingConfig, getSmokeExportConfig } from "../smokeExportConfig";
import type { useAppearanceState } from "../state/useAppearanceState";
import type { useProjectState } from "../state/useProjectState";
import type { useTimelineState } from "../state/useTimelineState";
import type { EditorEffectSection } from "../types";
import type { VideoPlaybackRef } from "../VideoPlayback";
import { useInitialEditorSource } from "./useInitialEditorSource";
import type { useProjectLibraryController } from "./useProjectLibraryController";
import { useProjectLifecycle } from "./useProjectLifecycle";
import { useProjectMediaRelink } from "./useProjectMediaRelink";
import { useProjectOpenActions } from "./useProjectOpenActions";
import { useProjectSaveActions } from "./useProjectSaveActions";
import { useExternalProjectChange } from "./useExternalProjectChange";
import { useProjectSnapshotModel } from "./useProjectSnapshotModel";
import { useProjectVersionHistory } from "./useProjectVersionHistory";
import { createAgentEditRestoreCheck, findAgentEditsThroughRevisions, mergeAgentReviewEdits, restoreAgentEdit, type AgentEdit } from "./agentEditReview";

type Input = {
	cropEditing?: boolean;
	t: ReturnType<typeof useI18n>["t"];
	project: ReturnType<typeof useProjectState>;
	appearance: ReturnType<typeof useAppearanceState>;
	timeline: ReturnType<typeof useTimelineState>;
	initialPreferences: ReturnType<typeof loadEditorPreferences>;
	smokeConfig: ReturnType<typeof getSmokeExportConfig>;
	devConfig: ReturnType<typeof getDevOpenRecordingConfig>;
	aspectRatio: AspectRatio;
	setAspectRatio: Dispatch<SetStateAction<AspectRatio>>;
	videoPath: string | null;
	setVideoPath: Dispatch<SetStateAction<string | null>>;
	videoSourcePath: string | null;
	setVideoSourcePath: Dispatch<SetStateAction<string | null>>;
	setCurrentTime: (seconds: number) => void;
	setIsPlaying: Dispatch<SetStateAction<boolean>>;
	setActiveEffectSection: Dispatch<SetStateAction<EditorEffectSection>>;
	setDuration: Dispatch<SetStateAction<number>>;
	whisperExecutablePath: string | null;
	setWhisperExecutablePath: Dispatch<SetStateAction<string | null>>;
	whisperModelPath: string | null;
	setWhisperModelPath: Dispatch<SetStateAction<string | null>>;
	downloadedWhisperModelPath: string | null;
	setDownloadedWhisperModelPath: Dispatch<SetStateAction<string | null>>;
	whisperModelDownloadStatus: "idle" | "downloading" | "downloaded" | "error";
	setWhisperModelDownloadStatus: Dispatch<
		SetStateAction<"idle" | "downloading" | "downloaded" | "error">
	>;
	setWhisperModelDownloadProgress: Dispatch<SetStateAction<number>>;
	isGeneratingCaptions: boolean;
	setIsGeneratingCaptions: Dispatch<SetStateAction<boolean>>;
	videoPlaybackRef: RefObject<VideoPlaybackRef | null>;
	projectNameInputRef: RefObject<HTMLInputElement | null>;
	projectSaveDialogInputRef: RefObject<HTMLInputElement | null>;
	nextZoomIdRef: MutableRefObject<number>;
	nextClipIdRef: MutableRefObject<number>;
	nextAudioIdRef: MutableRefObject<number>;
	nextAnnotationIdRef: MutableRefObject<number>;
	nextAnnotationZIndexRef: MutableRefObject<number>;
	clipInitializedRef: MutableRefObject<boolean>;
	autoFullTrackClipIdRef: MutableRefObject<string | null>;
	autoFullTrackClipEndMsRef: MutableRefObject<number | null>;
	pendingFreshRecordingAutoZoomPathRef: MutableRefObject<string | null>;
	pendingFreshRecordingAutoSuggestTelemetryCountRef: MutableRefObject<number>;
	autoSuggestedVideoPathRef: MutableRefObject<string | null>;
	applySessionPresentation: (
		session:
			| { hideOverlayCursorByDefault?: boolean; nativeCaptureUnavailable?: boolean }
			| null
			| undefined,
	) => void;
	refreshProjectLibrary: ReturnType<typeof useProjectLibraryController>["refreshProjectLibrary"];
	captureProjectThumbnail: ReturnType<
		typeof useProjectLibraryController
	>["captureProjectThumbnail"];
};

const NO_RECENT_AGENT_CUTS: ReadonlySet<string> = new Set();
const NO_AGENT_EDITS: readonly AgentEdit[] = [];

export function useEditorProjectController(input: Input) {
	const { whisperExecutablePath, whisperModelPath } = input;
	useEffect(() => {
		void saveEditorPreferences({ whisperExecutablePath, whisperModelPath });
	}, [whisperExecutablePath, whisperModelPath]);
	useEffect(() => window.electronAPI?.onRendererRecovered?.(() => {
		toast.warning(uiText("editorRecoveredAfterCrash"), { duration: 10000 });
	}), []);
	const snapshot = useProjectSnapshotModel({
		t: input.t,
		project: input.project,
		appearance: input.appearance,
		timeline: input.timeline,
		aspectRatio: input.aspectRatio,
		projectNameInputRef: input.projectNameInputRef,
		projectSaveDialogInputRef: input.projectSaveDialogInputRef,
	});
	const history = useEditorHistory({
		cropEditing: input.cropEditing,
		projectPath: input.project.currentProjectPath,
		appearance: input.appearance,
		aspectRatio: input.aspectRatio,
		setAspectRatio: input.setAspectRatio,
		timeline: input.timeline,
		nextZoomIdRef: input.nextZoomIdRef,
		nextClipIdRef: input.nextClipIdRef,
		nextAnnotationIdRef: input.nextAnnotationIdRef,
		nextAudioIdRef: input.nextAudioIdRef,
		nextAnnotationZIndexRef: input.nextAnnotationZIndexRef,
	});
	const lifecycle = useProjectLifecycle({
		t: input.t,
		project: input.project,
		appearance: input.appearance,
		timeline: input.timeline,
		aspectRatio: input.aspectRatio,
		setAspectRatio: input.setAspectRatio,
		currentSourcePath: snapshot.currentSourcePath,
		currentPersistedEditorState: snapshot.currentPersistedEditorState,
		videoPlaybackRef: input.videoPlaybackRef,
		setIsPlaying: input.setIsPlaying,
		setCurrentTime: input.setCurrentTime,
		setDuration: input.setDuration,
		applySessionPresentation: input.applySessionPresentation,
		buildPersistedEditorState: snapshot.buildPersistedEditorState,
		resetHistory: history.resetHistory,
		refs: {
			nextZoomIdRef: input.nextZoomIdRef,
			nextClipIdRef: input.nextClipIdRef,
			nextAudioIdRef: input.nextAudioIdRef,
			nextAnnotationIdRef: input.nextAnnotationIdRef,
			nextAnnotationZIndexRef: input.nextAnnotationZIndexRef,
			clipInitializedRef: input.clipInitializedRef,
			autoFullTrackClipIdRef: input.autoFullTrackClipIdRef,
			autoFullTrackClipEndMsRef: input.autoFullTrackClipEndMsRef,
			pendingFreshRecordingAutoZoomPathRef: input.pendingFreshRecordingAutoZoomPathRef,
			pendingFreshRecordingAutoSuggestTelemetryCountRef:
				input.pendingFreshRecordingAutoSuggestTelemetryCountRef,
			autoSuggestedVideoPathRef: input.autoSuggestedVideoPathRef,
		},
	});
	const hasUnsavedChanges = useMemo(
		() =>
			!requiresNewerProjectReader(input.project.lastSavedSnapshot ?? {}) &&
			hasUnsavedProjectChanges(
				lifecycle.currentProjectSnapshot,
				input.project.lastSavedSnapshot,
			),
		[lifecycle.currentProjectSnapshot, input.project.lastSavedSnapshot],
	);

	const openCaptionTranscript = useCallback(() => {
		input.timeline.setSelectedCaptionId(null);
		input.setActiveEffectSection("captionList");
	}, [input.setActiveEffectSection, input.timeline.setSelectedCaptionId]);
	const autoCaption = useAutoCaptionController({
		t: input.t,
		videoPath: input.videoPath,
		setVideoPath: input.setVideoPath,
		projectPath: input.project.currentProjectPath,
		videoSourcePath: input.videoSourcePath,
		setVideoSourcePath: input.setVideoSourcePath,
		webcamSourcePath: input.appearance.webcam.sourcePath ?? null,
		whisperExecutablePath: input.whisperExecutablePath,
		setWhisperExecutablePath: input.setWhisperExecutablePath,
		whisperModelPath: input.whisperModelPath,
		setWhisperModelPath: input.setWhisperModelPath,
		downloadedWhisperModelPath: input.downloadedWhisperModelPath,
		setDownloadedWhisperModelPath: input.setDownloadedWhisperModelPath,
		whisperModelDownloadStatus: input.whisperModelDownloadStatus,
		setWhisperModelDownloadStatus: input.setWhisperModelDownloadStatus,
		setWhisperModelDownloadProgress: input.setWhisperModelDownloadProgress,
		isGeneratingCaptions: input.isGeneratingCaptions,
		setIsGeneratingCaptions: input.setIsGeneratingCaptions,
		autoCaptionSettings: input.timeline.autoCaptionSettings,
		setAutoCaptionSettings: input.timeline.setAutoCaptionSettings,
		setAutoCaptions: input.timeline.setAutoCaptions,
		openCaptionTranscript,
		transcript: input.timeline.transcript,
		setTranscript: input.timeline.setTranscript,
		syncActiveVideoSource: lifecycle.syncActiveVideoSource,
	});
	const saveActions = useProjectSaveActions({
		project: input.project,
		currentSourcePath: snapshot.currentSourcePath,
		currentProjectSnapshot: lifecycle.currentProjectSnapshot,
		currentPersistedEditorState: snapshot.currentPersistedEditorState,
		projectDisplayName: snapshot.projectDisplayName,
		hasUnsavedChanges,
		projectSaveDialogInputRef: input.projectSaveDialogInputRef,
		projectNameInputRef: input.projectNameInputRef,
		openProjectSaveDialog: lifecycle.openProjectSaveDialog,
		resolveProjectSaveDialog: lifecycle.resolveProjectSaveDialog,
		captureProjectThumbnail: input.captureProjectThumbnail,
		refreshProjectLibrary: input.refreshProjectLibrary,
	});
	const mediaRelink = useProjectMediaRelink({
		project: input.project,
		applyLoadedProject: lifecycle.applyLoadedProject,
		withSavesSuspended: saveActions.withSavesSuspended,
		refreshProjectLibrary: input.refreshProjectLibrary,
	});
	useInitialEditorSource({
		project: input.project,
		appearance: input.appearance,
		timeline: input.timeline,
		smokeConfig: input.smokeConfig,
		devConfig: input.devConfig,
		videoSourcePath: input.videoSourcePath,
		pendingFreshRecordingAutoZoomPathRef: input.pendingFreshRecordingAutoZoomPathRef,
		applyLoadedProject: lifecycle.applyLoadedProject,
		offerRelink: mediaRelink.offerRelink,
		resetSourceScopedEditorState: lifecycle.resetSourceScopedEditorState,
		applySessionPresentation: input.applySessionPresentation,
		refreshProjectLibrary: input.refreshProjectLibrary,
	});
	const versionHistory = useProjectVersionHistory({
		project: input.project,
		hasUnsavedChanges,
		saveActions,
		applyLoadedProject: lifecycle.applyLoadedProject,
	});
	const openActions = useProjectOpenActions({
		project: input.project,
		appearance: input.appearance,
		videoPlaybackRef: input.videoPlaybackRef,
		pendingFreshRecordingAutoZoomPathRef: input.pendingFreshRecordingAutoZoomPathRef,
		hasUnsavedChanges,
		setIsPlaying: input.setIsPlaying,
		setCurrentTime: input.setCurrentTime,
		setDuration: input.setDuration,
		applyLoadedProject: lifecycle.applyLoadedProject,
		offerRelink: mediaRelink.offerRelink,
		openUnsavedChangesDialog: lifecycle.openUnsavedChangesDialog,
		saveProject: saveActions.saveProject,
		withSavesSuspended: saveActions.withSavesSuspended,
		isVersionPreview: saveActions.isVersionPreview,
		refreshProjectLibrary: input.refreshProjectLibrary,
		resetSourceScopedEditorState: lifecycle.resetSourceScopedEditorState,
		applySessionPresentation: input.applySessionPresentation,
		handleSaveProject: saveActions.handleSaveProject,
		handleSaveProjectAs: saveActions.handleSaveProjectAs,
	});
	const [agentHandoffBusy, setAgentHandoffBusy] = useState(false);
	const agentHandoffPending = useRef(false);
	const [agentReviewRound, setAgentReviewRound] = useState<{ path: string; cutIds: ReadonlySet<string>; edits: AgentEdit[] }>();
	const recordAgentChanges = (path: string, incoming: unknown, history: unknown[] = []) => {
		if (!validateProjectData(incoming)) return;
		const editor = normalizeProjectEditor(incoming.editor);
		const existingIds = new Set(input.timeline.changeLog.entries.map(entry => entry.id));
		const addedIds = normalizeChangeLog(editor.changeLog).entries
			.filter(entry => entry.source === "agent" && !existingIds.has(entry.id))
			.map(entry => entry.id);
		const reviewValue = (state: typeof editor, videoPath: string) => ({
			...state, sourcePath: fromFileUrl(videoPath),
			chapterProgress: state.chapterProgress ?? emptyChapterProgress(), transcript: state.transcript ?? null,
		});
		const revisions = history.every(validateProjectData)
			? history.map(project => reviewValue(normalizeProjectEditor(project.editor), project.videoPath))
			: [];
		revisions.push(reviewValue(editor, incoming.videoPath));
		const edits = findAgentEditsThroughRevisions(
			{ ...input.timeline, sourcePath: snapshot.currentSourcePath }, revisions, crypto.randomUUID(),
		);
		if (!addedIds.length && !edits.length) return;
		setAgentReviewRound(round => ({
			path,
			cutIds: new Set([...(round?.path === path ? round.cutIds : []), ...addedIds]),
			edits: mergeAgentReviewEdits(round?.path === path ? round.edits : [], edits),
		}));
		input.setActiveEffectSection("review");
	};
	const externalProjectChange = useExternalProjectChange({
		project: input.project,
		applyLoadedProject: lifecycle.applyLoadedProject,
		openProjectSaveDialog: lifecycle.openProjectSaveDialog,
		saveActions,
		projectDisplayName: snapshot.projectDisplayName,
		hasUnsavedChanges,
		agentHandoffBusy,
		onAgentProjectReload: recordAgentChanges,
	});
	async function changeAgentHandoff(handedOff: boolean) {
		const path = input.project.currentProjectPath;
		if (!path || !window.electronAPI.setProjectAgentHandoff ||
			agentHandoffPending.current || externalProjectChange.resolving || externalProjectChange.conflictOpen) return;
		agentHandoffPending.current = true;
		setAgentHandoffBusy(true);
		try {
			if (handedOff && hasUnsavedChanges && !(await saveActions.saveProject(false))) return;
			await saveActions.withSavesSuspended(async () => {
				if (handedOff) saveActions.setAgentReadOnly(path);
				const result = await window.electronAPI.setProjectAgentHandoff(path, handedOff);
				if (!result.success) {
					if (handedOff) saveActions.setAgentReadOnly(null);
					throw new Error(result.message || uiText("failedToLoadProject"));
				}
				if (handedOff) setAgentReviewRound(undefined);
				if (!handedOff) {
				const loaded = await window.electronAPI.openProjectFileAtPath(path, true);
					if (!loaded.success || !loaded.project || !(await lifecycle.applyLoadedProject(
						loaded.project, loaded.path ?? path, loaded.revision, { preservePlayhead: true },
					))) {
						await window.electronAPI.setProjectAgentHandoff(path, true).catch(() => undefined);
						throw new Error(loaded.message || uiText("failedToLoadProject"));
					}
				recordAgentChanges(loaded.path ?? path, loaded.project, loaded.agentReviewHistory);
					saveActions.setAgentReadOnly(null);
				}
			});
		} catch (error) {
			if (handedOff) saveActions.setAgentReadOnly(null);
			toast.error(error instanceof Error ? error.message : String(error));
		} finally {
			agentHandoffPending.current = false;
			setAgentHandoffBusy(false);
		}
	}
	const activeAgentReview = agentReviewRound?.path === input.project.currentProjectPath ? agentReviewRound : undefined;
	function updateAgentEdit(id: string, update: Partial<Pick<AgentEdit, "status" | "note">>) {
		setAgentReviewRound(round => round && {
			...round, edits: round.edits.map(edit => edit.id === id ? { ...edit, ...update } : edit),
		});
	}
	let agentRestoreCheck: ReturnType<typeof createAgentEditRestoreCheck> | undefined;
	const agentEdits = {
		entries: activeAgentReview?.edits ?? NO_AGENT_EDITS,
		canRestore: (edit: AgentEdit) => {
			agentRestoreCheck ??= createAgentEditRestoreCheck({ ...input.timeline, sourcePath: snapshot.currentSourcePath });
			return agentRestoreCheck(edit);
		},
		accept: (edit: AgentEdit) => { if (!saveActions.previewReadOnly) updateAgentEdit(edit.id, { status: "accepted" }); },
		restore: (edit: AgentEdit) => {
			if (saveActions.previewReadOnly || !restoreAgentEdit(edit, input.timeline, snapshot.currentSourcePath)) return;
			if (edit.field === "zoomRegions") {
				const targetId = edit.target?.id;
				const retained = targetId ? input.timeline.zoomRegions.filter(zoom => zoom.id !== targetId) : [];
				input.nextZoomIdRef.current = deriveNextId("zoom", [...retained, ...edit.before].map(zoom => zoom.id));
			}
			updateAgentEdit(edit.id, { status: "restored" });
		},
		saveNote: (edit: AgentEdit, note: string) => { if (!saveActions.previewReadOnly) updateAgentEdit(edit.id, { note }); },
	};

	return {
		refreshProjectLibrary: input.refreshProjectLibrary,
		snapshot,
		history,
		lifecycle,
		autoCaption,
		saveActions,
		openActions,
		mediaRelink,
		externalProjectChange,
		agentHandoffBusy,
		recentAgentCutIds: activeAgentReview?.cutIds ?? NO_RECENT_AGENT_CUTS,
		agentEdits,
		changeAgentHandoff,
		versionHistory,
		hasUnsavedChanges,
	};
}
