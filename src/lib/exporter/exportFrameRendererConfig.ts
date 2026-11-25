import type { ClipRegion } from "@/components/video-editor/types";
import type { FrameRenderConfig } from "./modernFrameRenderer";

type SceneFields = Omit<
	FrameRenderConfig,
	| "videoWidth"
	| "videoHeight"
	| "timelineEffects"
	| "preferredRenderBackend"
	| "useGpuFramePipeline"
	| "nativeReadbackMode"
>;

export interface ExportSceneOptions extends SceneFields {
	clipRegions?: ClipRegion[];
}

// Require a mapping for every scene setting while allowing absent optional values.
type ExportSceneFrameConfig = {
	[Field in keyof Required<SceneFields>]: SceneFields[Field];
} & Pick<FrameRenderConfig, "videoWidth" | "videoHeight" | "timelineEffects">;

export function buildExportFrameRendererConfig(
	config: ExportSceneOptions,
	videoInfo: { width: number; height: number },
): ExportSceneFrameConfig {
	return {
		width: config.width,
		height: config.height,
		videoWidth: videoInfo.width,
		videoHeight: videoInfo.height,
		timelineEffects: config.clipRegions !== undefined,
		wallpaper: config.wallpaper,
		zoomRegions: config.zoomRegions,
		showShadow: config.showShadow,
		shadowIntensity: config.shadowIntensity,
		backgroundBlur: config.backgroundBlur,
		zoomMotionBlur: config.zoomMotionBlur,
		zoomMotionBlurTuning: config.zoomMotionBlurTuning,
		connectZooms: config.connectZooms,
		zoomInDurationMs: config.zoomInDurationMs,
		zoomInOverlapMs: config.zoomInOverlapMs,
		zoomOutDurationMs: config.zoomOutDurationMs,
		connectedZoomGapMs: config.connectedZoomGapMs,
		connectedZoomDurationMs: config.connectedZoomDurationMs,
		zoomInEasing: config.zoomInEasing,
		zoomOutEasing: config.zoomOutEasing,
		connectedZoomEasing: config.connectedZoomEasing,
		borderRadius: config.borderRadius,
		padding: config.padding,
		cropRegion: config.cropRegion,
		webcam: config.webcam,
		webcamUrl: config.webcamUrl,
		annotationRegions: config.annotationRegions,
		videoRegions: config.videoRegions,
		chapterProgress: config.chapterProgress,
		keystrokes: config.keystrokes,
		videoTracks: config.videoTracks,
		autoCaptions: config.autoCaptions,
		autoCaptionSettings: config.autoCaptionSettings,
		speedRegions: config.speedRegions,
		previewWidth: config.previewWidth,
		previewHeight: config.previewHeight,
		cursorTelemetry: config.cursorTelemetry,
		showCursor: config.showCursor,
		cursorStyle: config.cursorStyle,
		cursorSize: config.cursorSize,
		cursorSmoothing: config.cursorSmoothing,
		cursorSpringStiffnessMultiplier: config.cursorSpringStiffnessMultiplier,
		cursorSpringDampingMultiplier: config.cursorSpringDampingMultiplier,
		cursorSpringMassMultiplier: config.cursorSpringMassMultiplier,
		cameraSpringStiffnessMultiplier: config.cameraSpringStiffnessMultiplier,
		cameraSpringDampingMultiplier: config.cameraSpringDampingMultiplier,
		cameraSpringMassMultiplier: config.cameraSpringMassMultiplier,
		zoomSmoothness: config.zoomSmoothness,
		zoomClassicMode: config.zoomClassicMode,
		cursorMotionBlur: config.cursorMotionBlur,
		cursorClickEffect: config.cursorClickEffect,
		cursorClickEffectColor: config.cursorClickEffectColor,
		cursorClickEffectScale: config.cursorClickEffectScale,
		cursorClickEffectOpacity: config.cursorClickEffectOpacity,
		cursorClickEffectDurationMs: config.cursorClickEffectDurationMs,
		cursorClickBounce: config.cursorClickBounce,
		cursorClickBounceDuration: config.cursorClickBounceDuration,
		cursorSway: config.cursorSway,
	};
}
