import type {
	ExportBackendPreference,
	ExportEncodingMode,
	ExportFormat,
	ExportMp4FrameRate,
	ExportPipelineModel,
	ExportQuality,
	GifFrameRate,
	GifSizePreset,
} from "@/lib/exporter";
import { isValidMp4FrameRate } from "@/lib/exporter/types";
import { normalizeManualMp4Bitrate } from "@/lib/exporter/exportBitrate";

export interface ExportPreferences {
	exportEncodingMode: ExportEncodingMode;
	exportBackendPreference: ExportBackendPreference;
	exportPipelineModel: ExportPipelineModel;
	exportQuality: ExportQuality;
	exportBitrateMbps: number | null;
	mp4FrameRate: ExportMp4FrameRate;
	exportFormat: ExportFormat;
	gifFrameRate: GifFrameRate;
	gifLoop: boolean;
	gifSizePreset: GifSizePreset;
	publishDestination: "link" | "local";
	includeCaptionSidecar: boolean;
	revealAfterExport: boolean;
}

export function normalizeExportEncodingMode(value: unknown): ExportEncodingMode {
	if (value === "fast" || value === "balanced" || value === "quality") {
		return value;
	}

	return "balanced";
}

export function normalizeExportBackendPreference(value: unknown): ExportBackendPreference {
	if (value === "auto" || value === "webcodecs" || value === "breeze") {
		return value;
	}

	return "auto";
}

export function normalizeExportPipelineModel(_value: unknown): ExportPipelineModel {
	// Legacy remains available to internal smoke/export routing, but persisted
	// user selections migrate to the only pipeline exposed by the editor UI.
	return "modern";
}

export function normalizeExportMp4FrameRate(value: unknown): ExportMp4FrameRate {
	return typeof value === "number" && isValidMp4FrameRate(value) ? value : 30;
}

export function normalizeExportQuality(value: unknown): ExportQuality {
	if (value === "1080p" || value === "1440p" || value === "2160p" || value === "source") return value;
	if (value === "medium" || value === "good" || value === "high") return "1080p";
	return "source";
}

export function normalizeExportPreferences(raw: Partial<ExportPreferences>): ExportPreferences {
	return {
		exportEncodingMode: normalizeExportEncodingMode(raw.exportEncodingMode),
		exportBackendPreference: normalizeExportBackendPreference(raw.exportBackendPreference),
		exportPipelineModel: normalizeExportPipelineModel(raw.exportPipelineModel),
		exportQuality: normalizeExportQuality(raw.exportQuality),
		exportBitrateMbps: normalizeManualMp4Bitrate(raw.exportBitrateMbps),
		mp4FrameRate: normalizeExportMp4FrameRate(raw.mp4FrameRate),
		exportFormat: raw.exportFormat === "gif" ? "gif" : "mp4",
		gifFrameRate:
			raw.gifFrameRate === 15 ||
			raw.gifFrameRate === 20 ||
			raw.gifFrameRate === 25 ||
			raw.gifFrameRate === 30
				? raw.gifFrameRate
				: 15,
		gifLoop: typeof raw.gifLoop === "boolean" ? raw.gifLoop : true,
		gifSizePreset:
			raw.gifSizePreset === "medium" ||
			raw.gifSizePreset === "large" ||
			raw.gifSizePreset === "original"
				? raw.gifSizePreset
				: "medium",
		publishDestination: "local",
		includeCaptionSidecar: raw.includeCaptionSidecar === true,
		revealAfterExport: raw.revealAfterExport === true,
	};
}
