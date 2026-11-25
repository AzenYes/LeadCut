import type { AspectRatio } from "@/utils/aspectRatioUtils";
import type { normalizeProjectEditor } from "../projectPersistence";
import type { useAppearanceState } from "../state/useAppearanceState";

export function applyEditorAppearance(
	appearance: ReturnType<typeof useAppearanceState>,
	editor: ReturnType<typeof normalizeProjectEditor>,
	setAspectRatio: (ratio: AspectRatio) => void,
) {
	appearance.setWallpaper(editor.wallpaper);
	appearance.setShadowIntensity(editor.shadowIntensity);
	appearance.setBackgroundBlur(editor.backgroundBlur);
	appearance.setZoomMotionBlur(editor.zoomMotionBlur);
	appearance.setZoomMotionBlurTuning({ ...editor.zoomMotionBlurTuning });
	appearance.setConnectZooms(editor.connectZooms);
	appearance.setZoomInDurationMs(editor.zoomInDurationMs);
	appearance.setZoomInOverlapMs(editor.zoomInOverlapMs);
	appearance.setZoomOutDurationMs(editor.zoomOutDurationMs);
	appearance.setConnectedZoomGapMs(editor.connectedZoomGapMs);
	appearance.setConnectedZoomDurationMs(editor.connectedZoomDurationMs);
	appearance.setZoomInEasing(editor.zoomInEasing);
	appearance.setZoomOutEasing(editor.zoomOutEasing);
	appearance.setConnectedZoomEasing(editor.connectedZoomEasing);
	appearance.setShowCursor(editor.showCursor);
	appearance.setLoopCursor(editor.loopCursor);
	appearance.setCursorStyle(editor.cursorStyle);
	appearance.setCursorSize(editor.cursorSize);
	appearance.setCursorSmoothing(editor.cursorSmoothing);
	appearance.setCursorSpringStiffnessMultiplier(editor.cursorSpringStiffnessMultiplier);
	appearance.setCursorSpringDampingMultiplier(editor.cursorSpringDampingMultiplier);
	appearance.setCursorSpringMassMultiplier(editor.cursorSpringMassMultiplier);
	appearance.setCameraSpringStiffnessMultiplier(editor.cameraSpringStiffnessMultiplier);
	appearance.setCameraSpringDampingMultiplier(editor.cameraSpringDampingMultiplier);
	appearance.setCameraSpringMassMultiplier(editor.cameraSpringMassMultiplier);
	appearance.setCursorClickEffect(editor.cursorClickEffect);
	appearance.setCursorClickEffectColor(editor.cursorClickEffectColor);
	appearance.setCursorClickEffectScale(editor.cursorClickEffectScale);
	appearance.setCursorClickEffectOpacity(editor.cursorClickEffectOpacity);
	appearance.setCursorClickEffectDurationMs(editor.cursorClickEffectDurationMs);
	appearance.setZoomSmoothness(editor.zoomSmoothness);
	appearance.setZoomClassicMode(editor.zoomClassicMode);
	appearance.setCursorMotionBlur(editor.cursorMotionBlur);
	appearance.setCursorClickBounce(editor.cursorClickBounce);
	appearance.setCursorClickBounceDuration(editor.cursorClickBounceDuration);
	appearance.setCursorSway(editor.cursorSway);
	appearance.setBorderRadius(editor.borderRadius);
	appearance.setPadding(editor.padding);
	appearance.setCropRegion(editor.cropRegion);
	appearance.setWebcam(editor.webcam);
	setAspectRatio(editor.aspectRatio);
}
