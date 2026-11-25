import { DEFAULT_CURSOR_CONFIG } from "@/components/video-editor/videoPlayback/cursorRenderer";
import { isVideoWallpaperSource } from "@/lib/wallpapers";
import { requiresClipTimelineRendering } from "./clipTimeline";
import type { ExportSceneOptions } from "./exportFrameRendererConfig";

type SceneCheck = (scene: ExportSceneOptions) => string | undefined;

export function hasVisibleExportCursor(scene: ExportSceneOptions): boolean {
	return scene.showCursor !== false && Boolean(scene.cursorTelemetry?.length);
}

const videoTracks: SceneCheck = (scene) =>
	scene.videoRegions?.length ? "independent-video-tracks" : undefined;
const webcams: SceneCheck = (scene) =>
	scene.webcam?.enabled ? "native-webcam-style-mismatch" : undefined;
const cursorSmoothing: SceneCheck = (scene) =>
	hasVisibleExportCursor(scene) &&
	(scene.cursorSmoothing ?? DEFAULT_CURSOR_CONFIG.smoothingFactor) > 0
		? "unsupported-cursor-smoothing"
		: undefined;
const cursorClickEffect: SceneCheck = (scene) =>
	scene.cursorTelemetry?.length && (scene.cursorClickEffect ?? "none") !== "none"
		? "unsupported-cursor-click-effect"
		: undefined;
const zoomBlur: SceneCheck = (scene) =>
	scene.zoomRegions?.length && (scene.zoomMotionBlur ?? 0) > 0
		? "unsupported-native-zoom-motion-blur"
		: undefined;

// Every renderer setting needs an explicit native capability decision.
// Settings that share a feature use the same check, including inactive controls.
const capabilities = {
	chapterProgress: (scene) =>
		scene.chapterProgress?.enabled ? "chapter-progress-overlay" : undefined,
	keystrokes: (scene) => (scene.keystrokes?.items.length ? "keystroke-overlay" : undefined),
	videoRegions: videoTracks,
	videoTracks,
	clipRegions: (scene) =>
		requiresClipTimelineRendering(scene.clipRegions) ? "explicit-clip-timeline" : undefined,
	wallpaper: (scene) =>
		isVideoWallpaperSource(scene.wallpaper?.trim() ?? "")
			? "unsupported-background-video"
			: undefined,
	cursorClickEffect,
	cursorClickEffectColor: cursorClickEffect,
	cursorClickEffectScale: cursorClickEffect,
	cursorClickEffectOpacity: cursorClickEffect,
	cursorClickEffectDurationMs: cursorClickEffect,
	cursorMotionBlur: (scene) =>
		hasVisibleExportCursor(scene) && (scene.cursorMotionBlur ?? 0) > 0
			? "unsupported-cursor-motion-blur"
			: undefined,
	cursorSway: (scene) =>
		hasVisibleExportCursor(scene) && (scene.cursorSway ?? 0) > 0
			? "unsupported-cursor-sway"
			: undefined,
	cursorSmoothing,
	cursorSpringStiffnessMultiplier: cursorSmoothing,
	cursorSpringDampingMultiplier: cursorSmoothing,
	cursorSpringMassMultiplier: cursorSmoothing,
	zoomRegions: (scene) =>
		!scene.zoomClassicMode &&
		scene.cursorTelemetry?.length &&
		scene.zoomRegions?.some((region) => region.mode !== "manual")
			? "unsupported-native-cursor-follow-zoom"
			: undefined,
	zoomMotionBlur: zoomBlur,
	zoomMotionBlurTuning: zoomBlur,
	annotationRegions: (scene) =>
		scene.annotationRegions?.length ? "unsupported-annotation-overlay" : undefined,
	autoCaptions: (scene) =>
		scene.autoCaptions?.length ? "unsupported-caption-overlay" : undefined,
	webcam: webcams,
	webcamUrl: webcams,
	width: "supported",
	height: "supported",
	showShadow: "supported",
	shadowIntensity: "supported",
	backgroundBlur: "supported",
	borderRadius: "supported",
	padding: "supported",
	cropRegion: "supported",
	connectZooms: "supported",
	zoomInDurationMs: "supported",
	zoomInOverlapMs: "supported",
	zoomOutDurationMs: "supported",
	connectedZoomGapMs: "supported",
	connectedZoomDurationMs: "supported",
	zoomInEasing: "supported",
	zoomOutEasing: "supported",
	connectedZoomEasing: "supported",
	zoomSmoothness: "supported",
	zoomClassicMode: "supported",
	cameraSpringStiffnessMultiplier: "supported",
	cameraSpringDampingMultiplier: "supported",
	cameraSpringMassMultiplier: "supported",
	speedRegions: "supported",
	autoCaptionSettings: "supported",
	previewWidth: "supported",
	previewHeight: "supported",
	cursorTelemetry: "supported",
	showCursor: "supported",
	cursorStyle: "supported",
	cursorSize: "supported",
	cursorClickBounce: "supported",
	cursorClickBounceDuration: "supported",
} satisfies Record<keyof ExportSceneOptions, "supported" | SceneCheck>;

const sceneChecks = [...new Set(Object.values(capabilities))].filter(
	(check) => check !== "supported",
);

export function getNativeStaticLayoutSceneSkipReasons(scene: ExportSceneOptions): string[] {
	return sceneChecks.flatMap((check) => {
		const reason = check(scene);
		return reason ? [reason] : [];
	});
}
