import type { RefObject } from "react";
import type { useI18n } from "@/contexts/I18nContext";
import type { useVideoEditorAudio } from "../audio/useVideoEditorAudio";
import type { getSmokeExportConfig } from "../smokeExportConfig";
import type { useAppearanceState } from "../state/useAppearanceState";
import type { useTimelineState } from "../state/useTimelineState";
import type { CursorTelemetryPoint, SpeedRegion, ZoomRegion } from "../types";
import type { VideoPlaybackRef } from "../VideoPlayback";
import { useExportDialogActions } from "./useExportDialogActions";
import type { useExportDimensions } from "./useExportDimensions";
import { useExportMessages } from "./useExportMessages";
import { useExportPreflight } from "./useExportPreflight";
import { useExportRunner } from "./useExportRunner";
import type { useExportSession } from "./useExportSession";
import type { useExportSettings } from "./useExportSettings";
import { useExportStatusViewModel } from "./useExportStatusViewModel";
import { useSmokeExportAutomation } from "./useSmokeExportAutomation";

type Input = {
	t: ReturnType<typeof useI18n>["t"];
	projectDisplayName: string;
	videoPath: string | null;
	videoSourcePath: string | null;
	videoPlaybackRef: RefObject<VideoPlaybackRef | null>;
	isPlaying: boolean;
	duration: number;
	timelineDuration: number;
	reviewChapters: () => void;
	error: string | null;
	loading: boolean;
	isPreviewReady: boolean;
	appearance: ReturnType<typeof useAppearanceState>;
	timeline: ReturnType<typeof useTimelineState>;
	settings: ReturnType<typeof useExportSettings>;
	session: ReturnType<typeof useExportSession>;
	dimensions: ReturnType<typeof useExportDimensions>;
	audio: ReturnType<typeof useVideoEditorAudio>;
	smokeConfig: ReturnType<typeof getSmokeExportConfig>;
	effectiveSpeedRegions: SpeedRegion[];
	effectiveZoomRegions: ZoomRegion[];
	effectiveCursorTelemetry: CursorTelemetryPoint[];
	effectiveShowCursor: boolean;
	cursorTelemetrySourcePath: string | null;
	hasCaptionsForSidecar: boolean;
	captionSidecarPayload?: Parameters<typeof useExportRunner>[0]["captionSidecarPayload"];
	experimentalNvidiaCudaExport: boolean;
	nvidiaCudaExportAvailable: boolean;
	remountPreview: () => void;
};

export function useEditorExportController(input: Input) {
	const runner = useExportRunner({
		projectDisplayName: input.projectDisplayName,
		videoPath: input.videoPath,
		videoPlaybackRef: input.videoPlaybackRef,
		isPlaying: input.isPlaying,
		appearance: input.appearance,
		timeline: input.timeline,
		timelineDuration: input.timelineDuration,
		exportSettings: input.settings,
		exportSession: input.session,
		audio: input.audio,
		smokeExportConfig: input.smokeConfig,
		effectiveSpeedRegions: input.effectiveSpeedRegions,
		effectiveZoomRegions: input.effectiveZoomRegions,
		effectiveCursorTelemetry: input.effectiveCursorTelemetry,
		effectiveShowCursor: input.effectiveShowCursor,
		ensureSupportedMp4SourceDimensions: input.dimensions.ensureSupportedMp4SourceDimensions,
		captionSidecarPayload: input.captionSidecarPayload,
		experimentalNvidiaCudaExport: input.experimentalNvidiaCudaExport,
		nvidiaCudaExportAvailable: input.nvidiaCudaExportAvailable,
		remountPreview: input.remountPreview,
	});
	const preflight = useExportPreflight({
		projectDisplayName: input.projectDisplayName,
		timeline: input.timeline,
		timelineDuration: input.timelineDuration,
		outputDimensions: input.dimensions.mp4OutputDimensions,
		session: input.session,
		handleExport: runner.handleExport,
		reviewChapters: input.reviewChapters,
	});
	const dialogActions = useExportDialogActions({
		videoPath: input.videoPath,
		videoPlaybackRef: input.videoPlaybackRef,
		hasCaptionsForSidecar: input.hasCaptionsForSidecar,
		settings: input.settings,
		session: input.session,
		preflight,
		showExportSuccessToast: runner.showExportSuccessToast,
	});
	useSmokeExportAutomation({
		config: input.smokeConfig,
		cursorTelemetrySourcePath: input.cursorTelemetrySourcePath,
		duration: input.duration,
		error: input.error,
		isPreviewReady: input.isPreviewReady && input.timeline.recordedKeystrokes.ready,
		loading: input.loading,
		videoPath: input.videoPath,
		videoSourcePath: input.videoSourcePath,
		handleExport: runner.handleExport,
	});
	const status = useExportStatusViewModel({
		t: input.t,
		session: input.session,
		settings: input.settings,
	});
	const exportMessage = useExportMessages({
		t: input.t,
		active: status.isLightningExportInProgress,
	});

	return { dialogActions, preflight, status, exportMessage };
}
