import { handleTrustedIpc } from "../../trustedIpc";
import { localizeNativeUiMessage, uiText } from "../../uiI18n";
import fs from "node:fs/promises";
import path from "node:path";
import { dialog } from "electron";
import { generateAutoCaptionsFromVideo } from "../captions/generate";
import { importSrtFile, SrtImportError } from "../captions/srtImport";
import { importTranscriptFile, rebuildCaptionsFromTranscript, TranscriptImportError } from "../captions/transcriptImport";
import {
	deleteWhisperSmallModel,
	cancelWhisperModelDownload,
	downloadWhisperSmallModel,
	getWhisperSmallModelStatus,
	sendWhisperModelDownloadProgress,
} from "../captions/whisper";
import { LEGACY_PROJECT_FILE_EXTENSIONS, PROJECT_FILE_EXTENSION } from "../constants";
import { hasProjectFileExtension, loadProjectFromPath } from "../project/manager";
import { approveUserPath, getRecordingsDir } from "../utils";

const VIDEO_FILE_EXTENSIONS = ["webm", "mp4", "mov", "avi", "mkv"];
const PROJECT_FILE_EXTENSIONS = [PROJECT_FILE_EXTENSION, ...LEGACY_PROJECT_FILE_EXTENSIONS];

type OpenVideoFilePickerOptions = {
	includeProjects?: boolean;
};

export function registerCaptionHandlers() {
	let selectedWhisperExecutable: string | undefined;
	const activeGeneration = new Map<number, AbortController>();
	handleTrustedIpc("cancel-auto-captions", event => {
		activeGeneration.get(event.sender.id)?.abort();
	});
	handleTrustedIpc("import-transcript-file", async () => {
		try {
			const selected = await dialog.showOpenDialog({
				title: uiText("transcriptImport"),
				filters: [{ name: "JSON", extensions: ["json"] }],
				properties: ["openFile"],
			});
			if (selected.canceled || !selected.filePaths.length) return { success: false, canceled: true };
			const filePath = selected.filePaths[0];
			return { success: true, path: filePath, transcript: await importTranscriptFile(filePath) };
		} catch (error) {
			return { success: false, errorCode: error instanceof TranscriptImportError ? error.code : "readFailed" };
		}
	});
	handleTrustedIpc("rebuild-captions-from-transcript", async (_, transcript: unknown) => {
		try {
			return { success: true, cues: rebuildCaptionsFromTranscript(transcript) };
		} catch (error) {
			return { success: false, errorCode: error instanceof TranscriptImportError ? error.code : "readFailed" };
		}
	});
	handleTrustedIpc("import-srt-captions", async (_, options?: { title?: string }) => {
		try {
			const selected = await dialog.showOpenDialog({
				title: typeof options?.title === "string" ? options.title.slice(0, 160) : uiText("importSRTSubtitles"),
				filters: [{ name: "SRT", extensions: ["srt"] }],
				properties: ["openFile"],
			});
			if (selected.canceled || selected.filePaths.length === 0) return { success: false, canceled: true };
			const filePath = selected.filePaths[0];
			const cues = await importSrtFile(filePath);
			return { success: true, path: filePath, cues };
		} catch (error) {
			return { success: false, errorCode: error instanceof SrtImportError ? error.code : "readFailed" };
		}
	});
	handleTrustedIpc("open-video-file-picker", async (_, options?: OpenVideoFilePickerOptions) => {
		try {
			const includeProjects = Boolean(options?.includeProjects);
			const recordingsDir = await getRecordingsDir();
			const result = await dialog.showOpenDialog({
				title: includeProjects ? uiText("importMediaOrLeadCutProject") : uiText("selectVideoFile"),
				defaultPath: recordingsDir,
				filters: [
					...(includeProjects
						? [
								{
									name: uiText("mediaOrLeadCutProjects"),
									extensions: [
										...VIDEO_FILE_EXTENSIONS,
										...PROJECT_FILE_EXTENSIONS,
									],
								},
							]
						: []),
					{ name: uiText("videoFiles"), extensions: VIDEO_FILE_EXTENSIONS },
					...(includeProjects
						? [{ name: uiText("leadcutProjects"), extensions: PROJECT_FILE_EXTENSIONS }]
						: []),
					{ name: uiText("allFiles"), extensions: ["*"] },
				],
				properties: ["openFile"],
			});

			if (result.canceled || result.filePaths.length === 0) {
				return { success: false, canceled: true };
			}

			const selectedPath = result.filePaths[0];

			if (includeProjects && hasProjectFileExtension(selectedPath)) {
				const projectResult = await loadProjectFromPath(selectedPath);
				return projectResult.success
					? { ...projectResult, kind: "project" }
					: projectResult;
			}

			approveUserPath(selectedPath);
			return {
				success: true,
				kind: "media",
				path: selectedPath,
				extension: path.extname(selectedPath).replace(/^\./, "").toLowerCase(),
			};
		} catch (error) {
			console.error("Failed to open file picker:", error);
			return {
				success: false,
				message: uiText("failedToOpenFilePicker"),
				error: String(error),
			};
		}
	});

	handleTrustedIpc("open-audio-file-picker", async () => {
		try {
			const result = await dialog.showOpenDialog({
				title: uiText("selectAudioFile"),
				filters: [
					{
						name: uiText("audioFiles"),
						extensions: ["mp3", "wav", "aac", "m4a", "flac", "ogg"],
					},
					{ name: uiText("allFiles"), extensions: ["*"] },
				],
				properties: ["openFile"],
			});

			if (result.canceled || result.filePaths.length === 0) {
				return { success: false, canceled: true };
			}

			approveUserPath(result.filePaths[0]);
			return {
				success: true,
				path: result.filePaths[0],
			};
		} catch (error) {
			console.error("Failed to open audio file picker:", error);
			return {
				success: false,
				message: uiText("failedToOpenAudioFilePicker"),
				error: String(error),
			};
		}
	});

	handleTrustedIpc("open-whisper-executable-picker", async () => {
		try {
			const result = await dialog.showOpenDialog({
				title: uiText("selectWhisperExecutable"),
				filters: [
					{
						name: uiText("executables"),
						extensions: process.platform === "win32" ? ["exe"] : ["*"],
					},
					{ name: uiText("allFiles"), extensions: ["*"] },
				],
				properties: ["openFile"],
			});

			if (result.canceled || result.filePaths.length === 0) {
				return { success: false, canceled: true };
			}

			selectedWhisperExecutable = await fs.realpath(result.filePaths[0]);
			return { success: true, path: selectedWhisperExecutable };
		} catch (error) {
			console.error("Failed to open Whisper executable picker:", error);
			return { success: false, error: String(error) };
		}
	});

	handleTrustedIpc("open-whisper-model-picker", async () => {
		try {
			const result = await dialog.showOpenDialog({
				title: uiText("selectWhisperModel"),
				filters: [
					{ name: uiText("whisperModels"), extensions: ["bin"] },
					{ name: uiText("allFiles"), extensions: ["*"] },
				],
				properties: ["openFile"],
			});

			if (result.canceled || result.filePaths.length === 0) {
				return { success: false, canceled: true };
			}

			approveUserPath(result.filePaths[0]);
			return { success: true, path: result.filePaths[0] };
		} catch (error) {
			console.error("Failed to open Whisper model picker:", error);
			return { success: false, error: String(error) };
		}
	});

	handleTrustedIpc("get-whisper-small-model-status", async () => {
		try {
			return await getWhisperSmallModelStatus();
		} catch (error) {
			return { success: false, exists: false, path: null, error: String(error) };
		}
	});

	handleTrustedIpc("cancel-whisper-model-download", cancelWhisperModelDownload);
	handleTrustedIpc("download-whisper-small-model", async (event) => {
		try {
			const existing = await getWhisperSmallModelStatus();
			if (existing.exists) {
				sendWhisperModelDownloadProgress(event.sender, {
					status: "downloaded",
					progress: 100,
					path: existing.path,
				});
				return { success: true, path: existing.path, alreadyDownloaded: true };
			}

			const modelPath = await downloadWhisperSmallModel(event.sender);
			return { success: true, path: modelPath };
		} catch (error) {
			if (error instanceof Error && error.name === "AbortError") return { success: false, canceled: true };
			console.error("Failed to download Whisper small model:", error);
			return { success: false, error: String(error) };
		}
	});

	handleTrustedIpc("delete-whisper-small-model", async (event) => {
		try {
			await deleteWhisperSmallModel();
			sendWhisperModelDownloadProgress(event.sender, {
				status: "idle",
				progress: 0,
				path: null,
			});
			return { success: true };
		} catch (error) {
			console.error("Failed to delete Whisper small model:", error);
			// Verify whether the file was actually removed despite the error
			const status = await getWhisperSmallModelStatus();
			if (!status.exists) {
				// File is gone — treat as success
				sendWhisperModelDownloadProgress(event.sender, {
					status: "idle",
					progress: 0,
					path: null,
				});
				return { success: true };
			}
			sendWhisperModelDownloadProgress(event.sender, {
				status: "error",
				progress: 0,
				path: null,
				error: String(error),
			});
			return { success: false, error: String(error) };
		}
	});

	handleTrustedIpc(
		"generate-auto-captions",
		async (
			event,
			options: {
				videoPath: string;
				whisperExecutablePath?: string;
				whisperModelPath: string;
				language?: string;
			},
		) => {
			const sender = event.sender;
			const senderId = sender.id;
			if (activeGeneration.has(senderId)) return { success: false, message: uiText("failedToGenerateAutoCaptions") };
			const controller = new AbortController();
			activeGeneration.set(senderId, controller);
			const cancel = () => controller.abort();
			sender.once("destroyed", cancel);
			try {
				const result = await generateAutoCaptionsFromVideo({
					videoPath: options.videoPath,
					whisperModelPath: options.whisperModelPath,
					language: options.language,
					signal: controller.signal,
					onProgress: progress => {
						if (!sender.isDestroyed()) sender.send("auto-caption-progress", Math.round(progress * 100));
					},
					whisperExecutablePath: options.whisperExecutablePath &&
						path.resolve(options.whisperExecutablePath) === selectedWhisperExecutable
						? selectedWhisperExecutable
						: undefined,
				});
				return {
					success: true,
					cues: result.cues,
					transcript: result.transcript,
					message:
						result.audioSourceLabel === "recording"
							? uiText("generatedValueCaptionCues", { value0: result.cues.length })
							: uiText("generatedValueCaptionCuesFromTheValue", { value0: result.cues.length, value1: localizeNativeUiMessage(result.audioSourceLabel) }),
				};
			} catch (error) {
				if (controller.signal.aborted) return { success: false, canceled: true };
				console.error("Failed to generate auto captions:", error);
				return {
					success: false,
					error: String(error),
					message:
						error instanceof Error ? error.message : uiText("failedToGenerateAutoCaptions"),
				};
			} finally {
				activeGeneration.delete(senderId);
				if (!sender.isDestroyed()) sender.removeListener("destroyed", cancel);
			}
		},
	);
}
