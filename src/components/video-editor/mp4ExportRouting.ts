import type { ExportBackendPreference, ExportPipelineModel, ExportSettings } from "@/lib/exporter";
import type { SmokeExportConfig } from "./smokeExportConfig";

export type Mp4ExportRouting = {
	pipelineModel: ExportPipelineModel;
	useExperimentalNativeExport: boolean;
	useExperimentalNvidiaCudaExport: boolean;
	backendPreference: ExportBackendPreference;
};

export function resolveMp4ExportRouting({
	smokeExportConfig,
	settings,
	exportPipelineModel,
	exportBackendPreference,
	experimentalNvidiaCudaExport,
	nvidiaCudaExportAvailable,
}: {
	smokeExportConfig: Pick<
		SmokeExportConfig,
		"enabled" | "pipelineModel" | "useNativeExport" | "backendPreference"
	> & Partial<Pick<SmokeExportConfig, "mode">>;
	settings: Pick<ExportSettings, "pipelineModel" | "backendPreference">;
	exportPipelineModel: ExportPipelineModel;
	exportBackendPreference: ExportBackendPreference;
	experimentalNvidiaCudaExport: boolean;
	nvidiaCudaExportAvailable: boolean;
}): Mp4ExportRouting {
	const useSmokeRouting = smokeExportConfig.enabled && smokeExportConfig.mode !== "agent";
	const pipelineModel = useSmokeRouting
		? (smokeExportConfig.pipelineModel ?? "modern")
		: (settings.pipelineModel ?? exportPipelineModel);
	const backendPreference =
		pipelineModel === "legacy"
			? "webcodecs"
			: useSmokeRouting
				? (smokeExportConfig.backendPreference ??
					(smokeExportConfig.useNativeExport ? "breeze" : "webcodecs"))
				: (settings.backendPreference ?? exportBackendPreference);
	const useExperimentalNativeExport = pipelineModel === "modern" &&
		backendPreference !== "webcodecs" &&
		(!useSmokeRouting || smokeExportConfig.useNativeExport);
	const useExperimentalNvidiaCudaExport =
		useExperimentalNativeExport && experimentalNvidiaCudaExport && nvidiaCudaExportAvailable;

	return {
		pipelineModel,
		useExperimentalNativeExport,
		useExperimentalNvidiaCudaExport,
		backendPreference,
	};
}
