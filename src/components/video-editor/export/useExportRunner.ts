import { useUiText } from "@/i18n/useUiText";
import { getVideoRegionAudio } from "../videoTracks";
import { useCallback, useRef } from "react";
import { toast } from "@/components/ui/toast";
import { logError } from "@/lib/appLog";
import { estimateMp4OutputBytes, getMp4ExportBitrate } from "@/lib/exporter/exportBitrate";
import { DEFAULT_MP4_CODEC } from "@/lib/exporter/mp4Support";
import type { ExportSettings } from "@/lib/exporter/types";
import { calculateMp4ExportDimensions, resolveAvailableMp4Quality } from "../exportDimensions";
import { resolveMp4ExportRouting } from "../mp4ExportRouting";
import { resolveMp4ExportSettings } from "../mp4ExportSettings";
import { createSmokeExportProgressSampler } from "../smokeExportProgress";
import { buildExportRenderOptions } from "./buildExportRenderOptions";
import { checkProjectExport } from "./checkProjectExport";
import { suggestedExportFileName } from "./exportFileName";
import {
	type PendingExportSave,
	saveExportBlob,
	writeSmokeExportReport,
} from "./exportPersistence";
import {
	type ExportRunnerInput,
	showExportErrorToast,
	useExportSuccessToast,
} from "./exportRunnerSupport";

export function useExportRunner(input: ExportRunnerInput) {
	const uiText = useUiText();
	const inputRef = useRef(input);
	inputRef.current = input;
	const showExportSuccessToast = useExportSuccessToast();

	const handleExport = useCallback(
		async (
			settings: ExportSettings,
			destination?: string,
		): Promise<string | undefined> => {
			const {
				projectDisplayName,
				videoPath,
				videoPlaybackRef,
				isPlaying,
				appearance,
				timeline,
				timelineDuration,
				exportSettings,
				exportSession,
				audio,
				smokeExportConfig,
				effectiveSpeedRegions,
				effectiveZoomRegions,
				effectiveCursorTelemetry,
				effectiveShowCursor,
				ensureSupportedMp4SourceDimensions,
				captionSidecarPayload,
				experimentalNvidiaCudaExport,
				nvidiaCudaExportAvailable,
				remountPreview,
			} = inputRef.current;
			const { shadowIntensity, padding } = appearance;
			const { clipRegions } = timeline;
			const audioRegions = [...timeline.audioRegions, ...getVideoRegionAudio(timeline.videoRegions, timeline.videoTracks)];
			const {
				exportQuality,
				exportBitrateMbps,
				exportEncodingMode,
				exportBackendPreference,
				exportPipelineModel,
				mp4FrameRate,
			} = exportSettings;
			const {
				setIsExporting,
				setExportProgress,
				setExportError: setExportErrorState,
				setShowExportDropdown,
				setExportedFilePath,
				setHasPendingExportSave,
				exporterRef,
				pendingExportSaveRef,
				clearPendingExportSave,
				markExportAsSaving,
				exportRunIdRef,
				cancelledExportRunIdRef,
			} = exportSession;
			const setExportError = (message: string | null, detail?: string) => {
				if (message) logError("export", message, detail);
				setExportErrorState(message);
			};
			if (!videoPath) {
				toast.error(uiText("noVideoLoaded11795f"));
				return;
			}

			const video = videoPlaybackRef.current?.video;
			if (!video) {
				toast.error(uiText("videoNotReady"));
				return;
			}
			const outputPath = smokeExportConfig.enabled ? smokeExportConfig.outputPath : destination ?? null;
			const isAgentExport = smokeExportConfig.enabled && smokeExportConfig.mode === "agent";
			const revealAfterSave = !smokeExportConfig.enabled && exportSettings.revealAfterExport;

			const exportRunId = exportRunIdRef.current + 1;
			exportRunIdRef.current = exportRunId;
			cancelledExportRunIdRef.current = null;
			const exportWasCancelled = () => exportRunIdRef.current !== exportRunId;
			const exportWasExplicitlyCancelled = () =>
				cancelledExportRunIdRef.current === exportRunId;
			const discardCancelledTemp = async (pending: PendingExportSave) => {
				if (!pending.tempFilePath) return;
				await window.electronAPI
					.discardExportedTemp?.(pending.tempFilePath)
					.catch(() => undefined);
			};

			setIsExporting(true);
			setExportProgress(null);
			setExportError(null);
			clearPendingExportSave();
			const smokeExportStartedAt = smokeExportConfig.enabled ? performance.now() : null;

			let keepExportDialogOpen = false;
			const wasPlaying = isPlaying;
			const restoreTime = video.currentTime;

			try {
				if (isAgentExport) {
					const issues = await checkProjectExport(timeline);
					if (issues.length) throw new Error(issues.map(issue => issue.kind === "chapters"
						? `Chapters are ${issue.status}. Review or turn them off in LeadCut before exporting.`
						: issue.kind === "captionFont" || issue.kind === "keystrokeFont"
							? `${issue.kind === "captionFont" ? "Caption" : "Keystroke"} font ${issue.fontName} is missing. Select an installed font in LeadCut before exporting.`
							: "Insufficient disk space.").join(" "));
				}
				if (wasPlaying) {
					videoPlaybackRef.current?.pause();
				}

				// Get preview CONTAINER dimensions for scaling
				const playbackRef = videoPlaybackRef.current;
				const containerElement = playbackRef?.containerRef?.current;
				const previewWidth = containerElement?.clientWidth || 1920;
				const previewHeight = containerElement?.clientHeight || 1080;
				const effectiveShadowIntensity =
					smokeExportConfig.enabled && smokeExportConfig.shadowIntensity !== undefined
						? smokeExportConfig.shadowIntensity
						: shadowIntensity;
				const smokeProgressSampler = createSmokeExportProgressSampler({
					enabled: smokeExportConfig.enabled,
					startedAtMs: smokeExportStartedAt,
				});
				const smokeProgressSamples = smokeProgressSampler.samples;
				const recordSmokeProgress = smokeProgressSampler.record;

				if (settings.format === "gif" && settings.gifConfig) {
					// GIF Export
					const { GifExporter } = await import("@/lib/exporter/gifExporter");
					if (exportWasCancelled()) return;
					const gifExporter = new GifExporter({
						videoUrl: videoPath,
						width: settings.gifConfig.width,
						height: settings.gifConfig.height,
						frameRate: settings.gifConfig.frameRate,
						loop: settings.gifConfig.loop,
						sizePreset: settings.gifConfig.sizePreset,
						...buildExportRenderOptions({
							appearance,
							timeline,
							effectiveSpeedRegions,
							effectiveZoomRegions,
							effectiveCursorTelemetry,
							effectiveShowCursor,
							previewWidth,
							previewHeight,
							shadowIntensity: effectiveShadowIntensity,
							onProgress: (progress) => {
								if (exportWasCancelled()) return;
								recordSmokeProgress(progress);
								setExportProgress(progress);
							},
						}),
						videoPadding: padding,
						maxDecodeQueue: smokeExportConfig.maxDecodeQueue,
						maxPendingFrames: smokeExportConfig.maxPendingFrames,
					});

					exporterRef.current = gifExporter;
					const result = await gifExporter.export();
					if (exportWasCancelled()) return;

					if (result.success && result.blob) {
						const fileName = suggestedExportFileName(projectDisplayName, "gif");
						markExportAsSaving();

						const { saveResult, pendingSave } = await saveExportBlob(
							result.blob,
							fileName,
							outputPath,
						);
						if (exportWasCancelled()) {
							await discardCancelledTemp(pendingSave);
							return;
						}

						if (saveResult.canceled) {
							pendingExportSaveRef.current = pendingSave;
							setHasPendingExportSave(true);
							setExportErrorState(
								uiText("saveDialogCanceledClickSaveAgainToSaveWithoutReRendering"),
							);
							toast.info(uiText("saveCanceledYouCanSaveAgainWithoutReExporting"));
							keepExportDialogOpen = true;
						} else if (saveResult.success && saveResult.path) {
							if (smokeExportStartedAt !== null) {
								console.log(
									`[smoke-export] Completed in ${Math.round(performance.now() - smokeExportStartedAt)}ms (${saveResult.path})`,
								);
							}
							showExportSuccessToast(saveResult.path, revealAfterSave);
							setExportedFilePath(saveResult.path);
							if (smokeExportConfig.enabled) {
								window.close();
								return;
							}
						} else {
							setExportError(saveResult.message || uiText("failedToSaveGIF"), saveResult.error);
							toast.error(saveResult.message || uiText("failedToSaveGIF"));
							if (smokeExportConfig.enabled) {
								window.close();
								return;
							}
						}
					} else {
						setExportError(result.error || uiText("gifExportFailed"));
						toast.error(result.error || uiText("gifExportFailed"));
						if (smokeExportConfig.enabled) {
							window.close();
							return;
						}
					}
				} else {
					// MP4 Export
					const { quality, encodingMode, selectedMp4FrameRate } =
						resolveMp4ExportSettings({
							smokeExportConfig: {
								enabled: smokeExportConfig.enabled,
								mode: smokeExportConfig.mode,
								quality: smokeExportConfig.quality,
								encodingMode: smokeExportConfig.encodingMode,
								fps: smokeExportConfig.fps,
							},
							settings,
							exportQuality,
							exportEncodingMode,
							mp4FrameRate,
						});
					const {
						pipelineModel,
						useExperimentalNativeExport,
						useExperimentalNvidiaCudaExport,
						backendPreference,
					} = resolveMp4ExportRouting({
						smokeExportConfig: {
							enabled: smokeExportConfig.enabled,
							mode: smokeExportConfig.mode,
							pipelineModel: smokeExportConfig.pipelineModel,
							useNativeExport: smokeExportConfig.useNativeExport,
							backendPreference: smokeExportConfig.backendPreference,
						},
						settings,
						exportPipelineModel,
						exportBackendPreference,
						experimentalNvidiaCudaExport,
						nvidiaCudaExportAvailable,
					});
					const supportedSourceDimensions = await ensureSupportedMp4SourceDimensions(
						selectedMp4FrameRate,
						{
							capTo1080p: false,
						},
					);
					if (exportWasCancelled()) return;
					const effectiveQuality = resolveAvailableMp4Quality(
						supportedSourceDimensions.width, supportedSourceDimensions.height, quality,
					);
					const requestedDimensions = calculateMp4ExportDimensions(
						supportedSourceDimensions.width,
						supportedSourceDimensions.height,
						effectiveQuality,
					);
					const { width: exportWidth, height: exportHeight } = requestedDimensions;
					const bitrate = getMp4ExportBitrate({
						width: exportWidth,
						height: exportHeight,
						frameRate: selectedMp4FrameRate,
						quality: effectiveQuality,
						encodingMode,
						manualBitrateMbps: settings.bitrateMbps === undefined ? exportBitrateMbps : settings.bitrateMbps,
						useModernNativeStaticLayout: useExperimentalNativeExport,
					});
					if (isAgentExport && outputPath) {
						const space = await window.electronAPI.getExportDiskSpace(outputPath).catch(() => null);
						const needed = estimateMp4OutputBytes(bitrate, timelineDuration) * 1.1;
						if (space?.targetFreeBytes != null && space.targetFreeBytes < needed) throw new Error("Insufficient space at the export location.");
						if (space?.tempFreeBytes != null && space.tempFreeBytes < needed) throw new Error("Insufficient space in the system temporary directory.");
					}

					const exporterConfig = {
						videoUrl: videoPath,
						width: exportWidth,
						height: exportHeight,
						frameRate: selectedMp4FrameRate,
						bitrate,
						codec: DEFAULT_MP4_CODEC,
						encodingMode,
						preferredEncoderPath: supportedSourceDimensions.encoderPath,
						preferredRenderBackend: smokeExportConfig.renderBackend,
						experimentalNativeExport: useExperimentalNativeExport,
						experimentalNvidiaCudaExport: useExperimentalNvidiaCudaExport,
						maxEncodeQueue: smokeExportConfig.maxEncodeQueue,
						maxDecodeQueue: smokeExportConfig.maxDecodeQueue,
						maxPendingFrames: smokeExportConfig.maxPendingFrames,
						...buildExportRenderOptions({
							appearance,
							timeline,
							effectiveSpeedRegions,
							effectiveZoomRegions,
							effectiveCursorTelemetry,
							effectiveShowCursor,
							previewWidth,
							previewHeight,
							shadowIntensity: effectiveShadowIntensity,
							onProgress: (progress) => {
								if (exportWasCancelled()) return;
								recordSmokeProgress(progress);
								setExportProgress(progress);
							},
						}),
						audioRegions,
						clipRegions,
						sourceAudioFallbackPaths: audio.sourceAudioFallbackPaths,
						sourceAudioFallbackStartDelayMsByPath:
							audio.sourceAudioFallbackStartDelayMsByPath,
						sourceAudioTrackSettings: timeline.defaultSourceAudioTrackSettings,
						sourceAudioTrackSettingsByClip: timeline.sourceAudioTrackSettingsByClip,
					};

					const Exporter =
						pipelineModel === "modern"
							? (await import("@/lib/exporter/modernVideoExporter"))
									.ModernVideoExporter
							: (await import("@/lib/exporter/videoExporter")).VideoExporter;
					if (exportWasCancelled()) return;
					const exporter =
						pipelineModel === "modern"
							? new Exporter({ ...exporterConfig, backendPreference })
							: new Exporter(exporterConfig);

					exporterRef.current = exporter;
					const result = await exporter.export();
					if (exportWasCancelled()) return;
					const smokeExportElapsedMs =
						smokeExportStartedAt !== null
							? Math.round(performance.now() - smokeExportStartedAt)
							: undefined;

					if (result.success && (result.blob || result.tempFilePath)) {
						const fileName = suggestedExportFileName(projectDisplayName, "mp4");
						const sidecarForThisExport =
							settings.includeCaptionSidecar && captionSidecarPayload
								? captionSidecarPayload
								: undefined;
						markExportAsSaving();

						let saveResult: {
							success: boolean;
							path?: string;
							message?: string;
							canceled?: boolean;
							error?: string;
						};
						let pendingOnCancel: PendingExportSave;

						if (result.tempFilePath) {
							// Preferred path: main process already holds the finished MP4 on
							// disk, so we just ask it to move the temp file into place. This
							// avoids ever allocating a multi-GiB ArrayBuffer in the renderer.
							saveResult = await window.electronAPI.finalizeExportedVideo({
								tempPath: result.tempFilePath,
								fileName,
								outputPath,
								captionSidecar: sidecarForThisExport,
							});
							if (exportWasCancelled()) {
								await discardCancelledTemp({
									fileName,
									tempFilePath: result.tempFilePath,
									captionSidecar: sidecarForThisExport,
								});
								return;
							}
							pendingOnCancel = {
								fileName,
								tempFilePath: result.tempFilePath,
								captionSidecar: sidecarForThisExport,
							};
						} else if (result.blob) {
							// Legacy fallback: some export paths still surface a Blob, but in
							// Electron we stream it into a temp file first so save/finalize
							// never requires a giant renderer ArrayBuffer.
							const blobSave = await saveExportBlob(
								result.blob,
								fileName,
								outputPath,
								sidecarForThisExport,
							);
							if (exportWasCancelled()) {
								await discardCancelledTemp(blobSave.pendingSave);
								return;
							}
							saveResult = blobSave.saveResult;
							pendingOnCancel = blobSave.pendingSave;
						} else {
							saveResult = { success: false, message: uiText("exportProducedNoOutput") };
							pendingOnCancel = { fileName };
						}

						if (saveResult.canceled) {
							if (smokeExportConfig.enabled) {
								await writeSmokeExportReport(smokeExportConfig.outputPath, {
									success: false,
									phase: "save",
									format: "mp4",
									pipelineModel,
									backendPreference,
									encodingMode,
									shadowIntensity: effectiveShadowIntensity,
									elapsedMs: smokeExportElapsedMs,
									error: "Save canceled",
									progressSamples: smokeProgressSamples,
									metrics: result.metrics,
								});
							}
							pendingExportSaveRef.current = pendingOnCancel;
							setHasPendingExportSave(true);
							setExportErrorState(
								uiText("saveDialogCanceledClickSaveAgainToSaveWithoutReRendering"),
							);
							toast.info(uiText("saveCanceledYouCanSaveAgainWithoutReExporting"));
							keepExportDialogOpen = true;
						} else if (saveResult.success && saveResult.path) {
							if (smokeExportConfig.enabled) {
								await writeSmokeExportReport(smokeExportConfig.outputPath, {
									success: true,
									phase: "saved",
									format: "mp4",
									pipelineModel,
									backendPreference,
									encodingMode,
									shadowIntensity: effectiveShadowIntensity,
									elapsedMs: smokeExportElapsedMs,
									outputPath: saveResult.path,
									durationMs: result.metrics?.effectiveDurationSec === undefined
										? undefined : Math.round(result.metrics.effectiveDurationSec * 1000),
									frameCount: result.metrics?.frameCount,
									width: exportWidth,
									height: exportHeight,
									frameRate: selectedMp4FrameRate,
									bitrate,
									encoderName: result.metrics?.encoderName,
									route: result.metrics?.encodeBackend,
									progressSamples: smokeProgressSamples,
									metrics: result.metrics,
								});
							}
							if (smokeExportStartedAt !== null) {
								console.log(
									`[smoke-export] Completed in ${Math.round(performance.now() - smokeExportStartedAt)}ms (${saveResult.path})`,
								);
							}
								showExportSuccessToast(saveResult.path, revealAfterSave);
							setExportedFilePath(saveResult.path);
							if (smokeExportConfig.enabled) {
								window.close();
								return;
							}
						} else {
							if (smokeExportConfig.enabled) {
								await writeSmokeExportReport(smokeExportConfig.outputPath, {
									success: false,
									phase: "save",
									format: "mp4",
									pipelineModel,
									backendPreference,
									encodingMode,
									shadowIntensity: effectiveShadowIntensity,
									elapsedMs: smokeExportElapsedMs,
									error: saveResult.error || saveResult.message || uiText("failedToSaveVideo"),
									progressSamples: smokeProgressSamples,
									metrics: result.metrics,
								});
							}
							setExportError(saveResult.message || uiText("failedToSaveVideo"), saveResult.error);
							showExportErrorToast(saveResult.message || uiText("failedToSaveVideo"));
							// Keep the pending-save entry so the user can retry without
							// re-rendering. The temp file is still on disk (the main
							// process only moves/deletes it on success) and the
							// ArrayBuffer fallback still references its in-memory blob.
							if (pendingOnCancel.tempFilePath || pendingOnCancel.arrayBuffer) {
								pendingExportSaveRef.current = pendingOnCancel;
								setHasPendingExportSave(true);
								keepExportDialogOpen = true;
							}
							if (smokeExportConfig.enabled) {
								window.close();
								return;
							}
						}
					} else {
						if (smokeExportConfig.enabled) {
							await writeSmokeExportReport(smokeExportConfig.outputPath, {
								success: false,
								phase: "export",
								format: "mp4",
								pipelineModel,
								backendPreference,
								encodingMode,
								shadowIntensity: effectiveShadowIntensity,
								elapsedMs: smokeExportElapsedMs,
								error: result.error || uiText("exportFailed"),
								progressSamples: smokeProgressSamples,
								metrics: result.metrics,
							});
						}
						setExportError(result.error || uiText("exportFailed"));
						showExportErrorToast(result.error || uiText("exportFailed"));
						keepExportDialogOpen = true;
						if (smokeExportConfig.enabled) {
							window.close();
							return;
						}
					}
				}

				if (wasPlaying) {
					await videoPlaybackRef.current?.play().catch(() => undefined);
				} else {
					video.currentTime = restoreTime;
				}
			} catch (error) {
				if (exportWasCancelled()) return;
				console.error("Export error:", error);
				const errorMessage = error instanceof Error ? error.message : uiText("unknownError");
				if (smokeExportConfig.enabled) {
					await writeSmokeExportReport(smokeExportConfig.outputPath, {
						success: false,
						phase: "exception",
						format: settings.format,
						elapsedMs:
							smokeExportStartedAt !== null
								? Math.round(performance.now() - smokeExportStartedAt)
								: undefined,
						error: errorMessage,
					});
				}
				setExportError(errorMessage);
				showExportErrorToast(uiText("exportFailedValue", { value0: errorMessage }));
				keepExportDialogOpen = true;
				if (smokeExportConfig.enabled) {
					window.close();
				}
			} finally {
				if (exportWasExplicitlyCancelled() && exportRunIdRef.current === exportRunId + 1) {
					video.currentTime = restoreTime;
					if (wasPlaying) {
						await videoPlaybackRef.current?.play().catch(() => undefined);
					}
				} else if (!exportWasCancelled()) {
					setIsExporting(false);
					exporterRef.current = null;
					setShowExportDropdown(keepExportDialogOpen);
					remountPreview();
				}
			}
		},
		[uiText, showExportSuccessToast],
	);

	return { handleExport, showExportSuccessToast };
}
