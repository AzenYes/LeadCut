import { uiText } from "@/i18n/uiText";
import type { ExportFormat, ExportPipelineModel, ExportProgress } from "@/lib/exporter";

export type ExportStatusModel = {
	isExportSaving: boolean;
	isExportPreparing: boolean;
	isExportFinalizing: boolean;
	isRenderingAudio: boolean;
	exportFinalizingProgress: number | null;
	exportFinalizingPercent: number | null;
	isExportMuxingAndSaving: boolean;
	isExportFinalSaveIndeterminate: boolean;
	isLightningExportInProgress: boolean;
	shouldSuspendPreviewRendering: boolean;
	isLegacyExportInProgress: boolean;
	renderSpeedFps: string | null;
	runtimeLabel: string | null;
	nativeSkipReasons: string[];
	nativeSkipLabel: string | null;
};

export function isModernMp4Export(format: ExportFormat, pipeline: ExportPipelineModel) {
	return format === "mp4" && pipeline === "modern";
}

export function resolveExportStatusModel({
	isExporting,
	exportProgress,
	exportFormat,
	exportPipelineModel,
}: {
	isExporting: boolean;
	exportProgress: ExportProgress | null;
	exportFormat: ExportFormat;
	exportPipelineModel: ExportPipelineModel;
}): ExportStatusModel {
	const isExportSaving = exportProgress?.phase === "saving";
	const isExportPreparing =
		isExporting && (!exportProgress || exportProgress.phase === "preparing");
	const isExportFinalizing = exportProgress?.phase === "finalizing";
	const isRenderingAudio =
		isExportFinalizing && typeof exportProgress?.audioProgress === "number";
	const rawFinalizingProgress =
		typeof exportProgress?.renderProgress === "number"
			? exportProgress.renderProgress
			: (exportProgress?.percentage ?? 100);
	const exportFinalizingProgress = isExportFinalizing
		? Math.max(
				0,
				Math.min(100, Number.isFinite(rawFinalizingProgress) ? rawFinalizingProgress : 0),
			)
		: null;
	const exportFinalizingPercent = isExportFinalizing
		? Math.round(exportFinalizingProgress ?? 100)
		: null;
	const isExportMuxingAndSaving =
		isExportFinalizing &&
		exportFormat === "mp4" &&
		exportPipelineModel === "modern" &&
		!isRenderingAudio;
	const isExportFinalSaveIndeterminate =
		isExportMuxingAndSaving && (exportFinalizingPercent ?? 0) >= 98;
	const isLightningExportInProgress =
		exportFormat === "mp4" &&
		exportPipelineModel === "modern" &&
		(isExporting || exportProgress !== null);
	const shouldSuspendPreviewRendering = isExporting && isModernMp4Export(exportFormat, exportPipelineModel);
	const isLegacyExportInProgress =
		exportFormat === "mp4" &&
		exportPipelineModel === "legacy" &&
		(isExporting || exportProgress !== null);
	const renderSpeedFps =
		!isExportPreparing &&
		!isExportFinalizing &&
		!isExportSaving &&
		typeof exportProgress?.renderFps === "number" &&
		Number.isFinite(exportProgress.renderFps) &&
		exportProgress.renderFps > 0
			? exportProgress.renderFps.toFixed(1)
			: null;
	const runtimeLabel = resolveRuntimeLabel(exportProgress);
	const nativeSkipReasons =
		exportProgress?.nativeStaticLayoutSkipReasons &&
		exportProgress.nativeStaticLayoutSkipReasons.length > 0
			? exportProgress.nativeStaticLayoutSkipReasons
			: exportProgress?.nativeStaticLayoutSkipReason
				? [exportProgress.nativeStaticLayoutSkipReason]
				: [];
	const nativeSkipLabel =
		nativeSkipReasons.length > 0
			? uiText("nativeExportSkipped", { reason: nativeSkipReasons[0], count: nativeSkipReasons.length - 1 })
			: null;

	return {
		isExportSaving,
		isExportPreparing,
		isExportFinalizing,
		isRenderingAudio,
		exportFinalizingProgress,
		exportFinalizingPercent,
		isExportMuxingAndSaving,
		isExportFinalSaveIndeterminate,
		isLightningExportInProgress,
		shouldSuspendPreviewRendering,
		isLegacyExportInProgress,
		renderSpeedFps,
		runtimeLabel,
		nativeSkipReasons,
		nativeSkipLabel,
	};
}

function resolveRuntimeLabel(exportProgress: ExportProgress | null): string | null {
	const renderBackend = exportProgress?.renderBackend;
	const encodeBackend = exportProgress?.encodeBackend;
	const encoderName = exportProgress?.encoderName;
	const route = exportProgress?.exportRoute;

	if (!renderBackend && !encodeBackend && !encoderName && !route) {
		return null;
	}

	const rendererLabel =
		renderBackend === "webgpu" ? "WebGPU" : renderBackend === "webgl" ? "WebGL" : null;
	const encoderLabel = route === "webcodecs" || (!route && encodeBackend === "webcodecs")
		? "WebCodecs"
		: route || encodeBackend === "ffmpeg" ? "Breeze" : null;
	const pathLabel =
		rendererLabel && encoderLabel
			? `${rendererLabel} + ${encoderLabel}`
			: (rendererLabel ?? encoderLabel);

	if (!pathLabel) {
		return encoderName ?? null;
	}

	return encoderName ? `${pathLabel} (${encoderName})` : pathLabel;
}
