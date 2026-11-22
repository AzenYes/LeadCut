import { useUiText } from "@/i18n/useUiText";
import type { RefObject } from "react";
import { useCallback } from "react";
import { toast } from "@/components/ui/toast";
import type { SupportedMp4Dimensions } from "@/lib/exporter";
import type { useVideoEditorAudio } from "../audio/useVideoEditorAudio";
import type { getSmokeExportConfig } from "../smokeExportConfig";
import type { useAppearanceState } from "../state/useAppearanceState";
import type { useTimelineState } from "../state/useTimelineState";
import type { CursorTelemetryPoint, SpeedRegion, ZoomRegion } from "../types";
import type { VideoPlaybackRef } from "../VideoPlayback";
import { summarizeErrorMessage } from "../videoEditorUtils";
import type { PendingExportSave } from "./exportPersistence";
import type { useExportSession } from "./useExportSession";
import type { useExportSettings } from "./useExportSettings";

export type ExportRunnerInput = {
	projectDisplayName: string;
	videoPath: string | null;
	videoPlaybackRef: RefObject<VideoPlaybackRef | null>;
	isPlaying: boolean;
	appearance: ReturnType<typeof useAppearanceState>;
	timeline: ReturnType<typeof useTimelineState>;
	timelineDuration: number;
	exportSettings: ReturnType<typeof useExportSettings>;
	exportSession: ReturnType<typeof useExportSession>;
	audio: ReturnType<typeof useVideoEditorAudio>;
	smokeExportConfig: ReturnType<typeof getSmokeExportConfig>;
	effectiveSpeedRegions: SpeedRegion[];
	effectiveZoomRegions: ZoomRegion[];
	effectiveCursorTelemetry: CursorTelemetryPoint[];
	effectiveShowCursor: boolean;
	ensureSupportedMp4SourceDimensions: (
		frameRate: ReturnType<typeof useExportSettings>["mp4FrameRate"],
		options?: { capTo1080p?: boolean },
	) => Promise<SupportedMp4Dimensions>;
	captionSidecarPayload?: PendingExportSave["captionSidecar"];
	experimentalNvidiaCudaExport: boolean;
	nvidiaCudaExportAvailable: boolean;
	remountPreview: () => void;
};

export function showExportErrorToast(message: string) {
	const summary = summarizeErrorMessage(message);
	toast.error(summary, {
		description: summary === message ? undefined : message,
		duration: 20_000,
	});
}

export function useExportSuccessToast() {
	const uiText = useUiText();
	return useCallback((filePath: string, revealAfterSave = false) => {
		const reveal = async () => {
			try {
				const result = await window.electronAPI.revealInFolder(filePath);
				if (!result.success) toast.error(result.error || result.message || uiText("failedToRevealItemInFolder"));
			} catch (error) {
				toast.error(uiText("errorRevealingInFolderValue", { value0: String(error) }));
			}
		};
		if (revealAfterSave) void reveal();
		toast.success(uiText("exportedSuccessfullyToValue", { value0: filePath }), {
			action: {
				label: uiText("showInFolder4bc901"),
				onClick: reveal,
			},
		});
	}, [uiText]);
}
