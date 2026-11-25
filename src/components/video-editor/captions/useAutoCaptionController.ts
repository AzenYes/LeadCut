import { uiText } from "@/i18n/uiText";
import { type Dispatch, type SetStateAction, useCallback, useEffect, useRef, useState } from "react";
import { toast } from "@/components/ui/toast";
import { resolveAutoCaptionSourcePath } from "../autoCaptionSource";
import { type CaptionEditTarget, updateCaptionCuesForEditedTarget } from "../captionEditing";
import { resolveVideoUrl } from "../projectPersistence";
import type { ProjectTranscript } from "../transcript";
import type { AutoCaptionSettings, CaptionCue } from "../types";
import { getErrorMessage } from "../videoEditorUtils";

type DownloadStatus = "idle" | "downloading" | "downloaded" | "error";
type Translator = (
	key: string,
	fallback?: string,
	params?: Record<string, string | number>,
) => string;

interface UseAutoCaptionControllerParams {
	t: Translator;
	videoPath: string | null;
	projectPath?: string | null;
	setVideoPath: Dispatch<SetStateAction<string | null>>;
	videoSourcePath: string | null;
	setVideoSourcePath: Dispatch<SetStateAction<string | null>>;
	webcamSourcePath: string | null;
	whisperExecutablePath: string | null;
	setWhisperExecutablePath: Dispatch<SetStateAction<string | null>>;
	whisperModelPath: string | null;
	setWhisperModelPath: Dispatch<SetStateAction<string | null>>;
	downloadedWhisperModelPath: string | null;
	setDownloadedWhisperModelPath: Dispatch<SetStateAction<string | null>>;
	whisperModelDownloadStatus: DownloadStatus;
	setWhisperModelDownloadStatus: Dispatch<SetStateAction<DownloadStatus>>;
	setWhisperModelDownloadProgress: Dispatch<SetStateAction<number>>;
	isGeneratingCaptions: boolean;
	setIsGeneratingCaptions: Dispatch<SetStateAction<boolean>>;
	autoCaptionSettings: AutoCaptionSettings;
	setAutoCaptionSettings: Dispatch<SetStateAction<AutoCaptionSettings>>;
	setAutoCaptions: Dispatch<SetStateAction<CaptionCue[]>>;
	openCaptionTranscript: () => void;
	transcript: ProjectTranscript | null;
	setTranscript: Dispatch<SetStateAction<ProjectTranscript | null>>;
	syncActiveVideoSource: (sourcePath: string, webcamPath?: string | null) => Promise<void>;
}

export function useAutoCaptionController({
	t,
	videoPath,
	projectPath,
	setVideoPath,
	videoSourcePath,
	setVideoSourcePath,
	webcamSourcePath,
	whisperExecutablePath,
	setWhisperExecutablePath,
	whisperModelPath,
	setWhisperModelPath,
	downloadedWhisperModelPath,
	setDownloadedWhisperModelPath,
	whisperModelDownloadStatus,
	setWhisperModelDownloadStatus,
	setWhisperModelDownloadProgress,
	isGeneratingCaptions,
	setIsGeneratingCaptions,
	autoCaptionSettings,
	setAutoCaptionSettings,
	setAutoCaptions,
	openCaptionTranscript,
	transcript,
	setTranscript,
	syncActiveVideoSource,
}: UseAutoCaptionControllerParams) {
	const captionGenerationInFlightRef = useRef(false);
	const captionImportInFlightRef = useRef(false);
	const [isImportingCaptions, setIsImportingCaptions] = useState(false);
	const [isWorkingWithTranscript, setIsWorkingWithTranscript] = useState(false);
	const [captionGenerationProgress, setCaptionGenerationProgress] = useState(0);
	useEffect(() => window.electronAPI.onAutoCaptionProgress?.(progress => {
		if (captionGenerationInFlightRef.current) setCaptionGenerationProgress(progress);
	}), []);
	const activeSourceRef = useRef({ videoSourcePath, videoPath, projectPath });
	const scopeRevisionRef = useRef(0);
	if (activeSourceRef.current.projectPath !== projectPath ||
		resolveAutoCaptionSourcePath(activeSourceRef.current) !== resolveAutoCaptionSourcePath({ videoSourcePath, videoPath })) {
		scopeRevisionRef.current += 1;
	}
	activeSourceRef.current = { videoSourcePath, videoPath, projectPath };

	const handleImportSrtCaptions = useCallback(async () => {
		if (captionImportInFlightRef.current || captionGenerationInFlightRef.current || isGeneratingCaptions) return;
		if (!videoPath) {
			toast.error(t("settings.captions.importNoVideo", "Open a video before importing subtitles."));
			return;
		}
		const sourceBeforeImport = resolveAutoCaptionSourcePath(activeSourceRef.current);
		const projectBeforeImport = activeSourceRef.current.projectPath;
		const revisionBeforeImport = scopeRevisionRef.current;
		captionImportInFlightRef.current = true;
		setIsImportingCaptions(true);
		try {
			const result = await window.electronAPI.importSrtCaptions({ title: t("settings.captions.importSrt", "Import SRT") });
			if (result.canceled) return;
			if (scopeRevisionRef.current !== revisionBeforeImport || resolveAutoCaptionSourcePath(activeSourceRef.current) !== sourceBeforeImport || activeSourceRef.current.projectPath !== projectBeforeImport) {
				toast.info(t("settings.captions.importProjectChanged", "Project changed; imported subtitles were not applied."));
				return;
			}
			if (!result.success || !result.cues?.length) {
				toast.error(t(`settings.captions.importErrors.${result.errorCode ?? "readFailed"}`, "Could not import this SRT file."));
				return;
			}
			setAutoCaptions(result.cues);
			setAutoCaptionSettings((current) => ({ ...current, enabled: true }));
			openCaptionTranscript();
			toast.success(t("settings.captions.importSuccess", "Imported {{count}} subtitles.", { count: result.cues.length }));
		} catch {
			toast.error(t("settings.captions.importErrors.readFailed", "Could not read the SRT file."));
		} finally {
			captionImportInFlightRef.current = false;
			setIsImportingCaptions(false);
		}
	}, [isGeneratingCaptions, openCaptionTranscript, setAutoCaptions, setAutoCaptionSettings, t, videoPath]);

	const withTranscriptOperation = useCallback(async (operation: (isCurrent: () => boolean) => Promise<void>) => {
		if (captionImportInFlightRef.current || captionGenerationInFlightRef.current || isGeneratingCaptions) return;
		if (!videoPath) {
			toast.error(uiText("noSourceVideoIsLoaded"));
			return;
		}
		const revision = scopeRevisionRef.current;
		const isCurrent = () => scopeRevisionRef.current === revision;
		captionImportInFlightRef.current = true;
		setIsWorkingWithTranscript(true);
		try {
			await operation(isCurrent);
		} catch {
			toast.error(uiText("transcriptReadFailed"));
		} finally {
			captionImportInFlightRef.current = false;
			setIsWorkingWithTranscript(false);
		}
	}, [isGeneratingCaptions, videoPath]);

	const handleImportTranscript = useCallback(() => withTranscriptOperation(async (isCurrent) => {
		const result = await window.electronAPI.importTranscriptFile();
		if (result.canceled) return;
		if (!isCurrent()) {
			toast.info(uiText("transcriptProjectChanged"));
			return;
		}
		if (!result.success || !result.transcript) {
			toast.error(uiText(result.errorCode === "empty" ? "transcriptEmpty" : "transcriptReadFailed"));
			return;
		}
		setTranscript(result.transcript);
		toast.success(uiText("transcriptImported", { value0: result.transcript.segments.length }));
	}), [setTranscript, withTranscriptOperation]);

	const handleRebuildCaptionsFromTranscript = useCallback(() => withTranscriptOperation(async (isCurrent) => {
		if (!transcript?.segments.length) return;
		const result = await window.electronAPI.rebuildCaptionsFromTranscript(transcript);
		if (!isCurrent()) {
			toast.info(uiText("transcriptProjectChanged"));
			return;
		}
		if (!result.success || !result.cues?.length) {
			toast.error(uiText("transcriptNoCues"));
			return;
		}
		setAutoCaptions(result.cues);
		setAutoCaptionSettings(settings => ({ ...settings, enabled: true }));
		openCaptionTranscript();
		toast.success(uiText("transcriptRebuilt", { value0: result.cues.length }));
	}), [openCaptionTranscript, setAutoCaptionSettings, setAutoCaptions, transcript, withTranscriptOperation]);

	useEffect(() => {
		const unsubscribe = window.electronAPI.onWhisperSmallModelDownloadProgress((state) => {
			setWhisperModelDownloadStatus(state.status);
			setWhisperModelDownloadProgress(state.progress);
			if (state.status === "downloaded") {
				setDownloadedWhisperModelPath(state.path ?? null);
				setWhisperModelPath((current) => current ?? state.path ?? null);
			} else if (state.status === "idle") {
				setDownloadedWhisperModelPath(null);
			} else if (state.status === "error" && state.error) {
				toast.error(state.error);
			}
		});

		void window.electronAPI.getWhisperSmallModelStatus().then((result) => {
			if (!result.success) return;
			if (result.exists && result.path) {
				setDownloadedWhisperModelPath(result.path);
				setWhisperModelPath((current) => current ?? result.path ?? null);
				setWhisperModelDownloadStatus("downloaded");
				setWhisperModelDownloadProgress(100);
			} else {
				setDownloadedWhisperModelPath(null);
				setWhisperModelDownloadStatus("idle");
				setWhisperModelDownloadProgress(0);
			}
		});

		return () => unsubscribe?.();
	}, [
		setDownloadedWhisperModelPath,
		setWhisperModelDownloadProgress,
		setWhisperModelDownloadStatus,
		setWhisperModelPath,
	]);

	const handlePickWhisperExecutable = useCallback(async () => {
		const result = await window.electronAPI.openWhisperExecutablePicker();
		if (!result.success || !result.path) return;
		setWhisperExecutablePath(result.path);
		toast.success(uiText("whisperExecutableSelected"));
	}, [uiText, setWhisperExecutablePath]);

	const handleDownloadWhisperSmallModel = useCallback(async () => {
		if (whisperModelDownloadStatus === "downloading") return;
		setWhisperModelDownloadStatus("downloading");
		setWhisperModelDownloadProgress(0);
		const result = await window.electronAPI.downloadWhisperSmallModel();
		if (result.canceled) {
			setWhisperModelDownloadStatus("idle");
			return;
		}
		if (!result.success) {
			setWhisperModelDownloadStatus("error");
			toast.error(result.error || uiText("failedToDownloadWhisperSmallModel"));
			return;
		}
		if (result.path) {
			setDownloadedWhisperModelPath(result.path);
			setWhisperModelPath(result.path);
		}
	}, [uiText,
		setDownloadedWhisperModelPath,
		setWhisperModelDownloadProgress,
		setWhisperModelDownloadStatus,
		setWhisperModelPath,
		whisperModelDownloadStatus,
	]);

	const handlePickWhisperModel = useCallback(async () => {
		const result = await window.electronAPI.openWhisperModelPicker();
		if (!result.success || !result.path) return;
		setWhisperModelPath(result.path);
		toast.success(uiText("whisperModelSelected"));
	}, [uiText, setWhisperModelPath]);

	const handleDeleteWhisperSmallModel = useCallback(async () => {
		const result = await window.electronAPI.deleteWhisperSmallModel();
		if (!result.success) {
			toast.error(result.error || uiText("failedToDeleteWhisperSmallModel"));
			return;
		}
		setWhisperModelPath((current) => (current === downloadedWhisperModelPath ? null : current));
		setDownloadedWhisperModelPath(null);
		setWhisperModelDownloadStatus("idle");
		setWhisperModelDownloadProgress(0);
		toast.success(uiText("whisperSmallModelDeleted"));
	}, [uiText,
		downloadedWhisperModelPath,
		setDownloadedWhisperModelPath,
		setWhisperModelDownloadProgress,
		setWhisperModelDownloadStatus,
		setWhisperModelPath,
	]);

	const handleGenerateAutoCaptions = useCallback(async () => {
		if (captionGenerationInFlightRef.current || captionImportInFlightRef.current || isGeneratingCaptions) return;
		const revisionBeforeGeneration = scopeRevisionRef.current;
		const projectBeforeGeneration = activeSourceRef.current.projectPath;
		captionGenerationInFlightRef.current = true;
		setCaptionGenerationProgress(0);
		setIsGeneratingCaptions(true);
		try {
			if (!whisperModelPath) {
				toast.error(uiText("selectAWhisperModelOrDownloadTheSmallModelFirst"));
				return;
			}
			let sourcePath = resolveAutoCaptionSourcePath({ videoSourcePath, videoPath });
			if (!sourcePath) {
				const sessionResult = await window.electronAPI.getCurrentRecordingSession?.();
				const currentVideoResult = await window.electronAPI.getCurrentVideoPath();
				sourcePath = resolveAutoCaptionSourcePath({
					recordingSessionVideoPath:
						sessionResult?.success && sessionResult.session?.videoPath
							? sessionResult.session.videoPath
							: null,
					currentVideoPath: currentVideoResult.success
						? (currentVideoResult.path ?? null)
						: null,
				});
			}
			if (!sourcePath) {
				toast.error(uiText("noSourceVideoIsLoaded"));
				return;
			}
			if (scopeRevisionRef.current !== revisionBeforeGeneration) return;
			// Refreshing an unchanged session revokes active companion-audio URLs.
			if (sourcePath !== videoSourcePath) {
				await syncActiveVideoSource(sourcePath, webcamSourcePath);
				const url = await resolveVideoUrl(sourcePath);
				if (scopeRevisionRef.current !== revisionBeforeGeneration) return;
				setVideoSourcePath(sourcePath);
				setVideoPath(url);
			}
			const result = await window.electronAPI.generateAutoCaptions({
				videoPath: sourcePath,
				whisperExecutablePath: whisperExecutablePath ?? undefined,
				whisperModelPath,
				language: autoCaptionSettings.language,
			});
			if (result.canceled) return;
			if (scopeRevisionRef.current !== revisionBeforeGeneration || activeSourceRef.current.projectPath !== projectBeforeGeneration || resolveAutoCaptionSourcePath(activeSourceRef.current) !== sourcePath) {
				toast.info(uiText("recordingChangedGeneratedCaptionsWereNotApplied"));
				return;
			}
			if (!result.success || !result.cues) {
				const errorMessage = result.error ? getErrorMessage(result.error) : result.message;
				toast.error(errorMessage || uiText("failedToGenerateCaptions"));
				return;
			}
			setAutoCaptions(result.cues);
			if (result.transcript !== undefined) setTranscript(result.transcript);
			if (result.cues.length > 0) {
				setAutoCaptionSettings((current) => ({ ...current, enabled: true }));
			}
			openCaptionTranscript();
			toast.success(result.message || uiText("generatedValueCaptions", { value0: result.cues.length }));
		} catch (error) {
			toast.error(getErrorMessage(error));
		} finally {
			captionGenerationInFlightRef.current = false;
			setIsGeneratingCaptions(false);
		}
	}, [uiText,
		autoCaptionSettings.language,
		isGeneratingCaptions,
		openCaptionTranscript,
		setAutoCaptionSettings,
		setAutoCaptions,
		setIsGeneratingCaptions,
		setTranscript,
		setVideoPath,
		setVideoSourcePath,
		syncActiveVideoSource,
		videoPath,
		videoSourcePath,
		webcamSourcePath,
		whisperExecutablePath,
		whisperModelPath,
	]);

	const handleSaveAutoCaptionEdit = useCallback(
		(target: CaptionEditTarget, text: string) => {
			setAutoCaptions((captions) => updateCaptionCuesForEditedTarget(captions, target, text));
			toast.success(t("settings.captions.editSaved", "Caption updated"));
		},
		[setAutoCaptions, t],
	);

	return {
		isImportingCaptions,
		isWorkingWithTranscript,
		captionGenerationProgress,
		handleCancelAutoCaptions: window.electronAPI.cancelAutoCaptions,
		handleCancelWhisperModelDownload: window.electronAPI.cancelWhisperModelDownload,
		hasTranscript: Boolean(transcript?.segments.length),
		handleImportSrtCaptions,
		handleImportTranscript,
		handleRebuildCaptionsFromTranscript,
		handlePickWhisperExecutable,
		handleDownloadWhisperSmallModel,
		handlePickWhisperModel,
		handleDeleteWhisperSmallModel,
		handleGenerateAutoCaptions,
		handleSaveAutoCaptionEdit,
	};
}
