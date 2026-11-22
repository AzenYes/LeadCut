import type {
	ExportEncodingMode,
	ExportMp4FrameRate,
	ExportQuality,
	ExportSettings,
} from "@/lib/exporter";
import type { SmokeExportConfig } from "./smokeExportConfig";

export type ResolvedMp4ExportSettings = {
	quality: ExportQuality;
	encodingMode: ExportEncodingMode;
	selectedMp4FrameRate: ExportMp4FrameRate;
};

export function resolveMp4ExportSettings({
	smokeExportConfig,
	settings,
	exportQuality,
	exportEncodingMode,
	mp4FrameRate,
}: {
	smokeExportConfig: Pick<SmokeExportConfig, "enabled" | "quality" | "encodingMode" | "fps">
		& Partial<Pick<SmokeExportConfig, "mode">>;
	settings: Pick<ExportSettings, "quality" | "encodingMode" | "mp4FrameRate">;
	exportQuality: ExportQuality;
	exportEncodingMode: ExportEncodingMode;
	mp4FrameRate: ExportMp4FrameRate;
}): ResolvedMp4ExportSettings {
	if (smokeExportConfig.enabled && smokeExportConfig.mode === "agent") {
		return {
			quality: smokeExportConfig.quality ?? "source",
			encodingMode: settings.encodingMode ?? exportEncodingMode,
			selectedMp4FrameRate: smokeExportConfig.fps ?? 30,
		};
	}
	return {
		quality: smokeExportConfig.enabled
			? (smokeExportConfig.quality ?? settings.quality ?? exportQuality)
			: (settings.quality ?? exportQuality),
		encodingMode: smokeExportConfig.enabled
			? (smokeExportConfig.encodingMode ?? settings.encodingMode ?? exportEncodingMode)
			: (settings.encodingMode ?? exportEncodingMode),
		selectedMp4FrameRate: smokeExportConfig.enabled
			? (smokeExportConfig.fps ?? settings.mp4FrameRate ?? mp4FrameRate)
			: (settings.mp4FrameRate ?? mp4FrameRate),
	};
}
