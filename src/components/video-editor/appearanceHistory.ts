import type { useAppearanceState } from "./state/useAppearanceState";

type Appearance = ReturnType<typeof useAppearanceState>;
export type AppearanceHistorySnapshot = Pick<Appearance,
	| "wallpaper"
	| "shadowIntensity"
	| "backgroundBlur"
	| "zoomMotionBlur"
	| "zoomMotionBlurTuning"
	| "connectZooms"
	| "zoomInDurationMs"
	| "zoomInOverlapMs"
	| "zoomOutDurationMs"
	| "connectedZoomGapMs"
	| "connectedZoomDurationMs"
	| "zoomInEasing"
	| "zoomOutEasing"
	| "connectedZoomEasing"
	| "showCursor"
	| "loopCursor"
	| "cursorStyle"
	| "cursorSize"
	| "cursorSmoothing"
	| "cursorSpringStiffnessMultiplier"
	| "cursorSpringDampingMultiplier"
	| "cursorSpringMassMultiplier"
	| "cameraSpringStiffnessMultiplier"
	| "cameraSpringDampingMultiplier"
	| "cameraSpringMassMultiplier"
	| "zoomSmoothness"
	| "zoomClassicMode"
	| "cursorMotionBlur"
	| "cursorClickEffect"
	| "cursorClickEffectColor"
	| "cursorClickEffectScale"
	| "cursorClickEffectOpacity"
	| "cursorClickEffectDurationMs"
	| "cursorClickBounce"
	| "cursorClickBounceDuration"
	| "cursorSway"
	| "borderRadius"
	| "padding"
	| "cropRegion"
	| "webcam"
>;

export function captureAppearanceHistory(appearance: Appearance): AppearanceHistorySnapshot {
	return {
		wallpaper: appearance.wallpaper,
		shadowIntensity: appearance.shadowIntensity,
		backgroundBlur: appearance.backgroundBlur,
		zoomMotionBlur: appearance.zoomMotionBlur,
		zoomMotionBlurTuning: appearance.zoomMotionBlurTuning,
		connectZooms: appearance.connectZooms,
		zoomInDurationMs: appearance.zoomInDurationMs,
		zoomInOverlapMs: appearance.zoomInOverlapMs,
		zoomOutDurationMs: appearance.zoomOutDurationMs,
		connectedZoomGapMs: appearance.connectedZoomGapMs,
		connectedZoomDurationMs: appearance.connectedZoomDurationMs,
		zoomInEasing: appearance.zoomInEasing,
		zoomOutEasing: appearance.zoomOutEasing,
		connectedZoomEasing: appearance.connectedZoomEasing,
		showCursor: appearance.showCursor,
		loopCursor: appearance.loopCursor,
		cursorStyle: appearance.cursorStyle,
		cursorSize: appearance.cursorSize,
		cursorSmoothing: appearance.cursorSmoothing,
		cursorSpringStiffnessMultiplier: appearance.cursorSpringStiffnessMultiplier,
		cursorSpringDampingMultiplier: appearance.cursorSpringDampingMultiplier,
		cursorSpringMassMultiplier: appearance.cursorSpringMassMultiplier,
		cameraSpringStiffnessMultiplier: appearance.cameraSpringStiffnessMultiplier,
		cameraSpringDampingMultiplier: appearance.cameraSpringDampingMultiplier,
		cameraSpringMassMultiplier: appearance.cameraSpringMassMultiplier,
		zoomSmoothness: appearance.zoomSmoothness,
		zoomClassicMode: appearance.zoomClassicMode,
		cursorMotionBlur: appearance.cursorMotionBlur,
		cursorClickEffect: appearance.cursorClickEffect,
		cursorClickEffectColor: appearance.cursorClickEffectColor,
		cursorClickEffectScale: appearance.cursorClickEffectScale,
		cursorClickEffectOpacity: appearance.cursorClickEffectOpacity,
		cursorClickEffectDurationMs: appearance.cursorClickEffectDurationMs,
		cursorClickBounce: appearance.cursorClickBounce,
		cursorClickBounceDuration: appearance.cursorClickBounceDuration,
		cursorSway: appearance.cursorSway,
		borderRadius: appearance.borderRadius,
		padding: appearance.padding,
		cropRegion: appearance.cropRegion,
		webcam: appearance.webcam,
	};
}

export function restoreAppearanceHistory(appearance: Appearance, snapshot: AppearanceHistorySnapshot): void {
	appearance.setWallpaper(snapshot.wallpaper);
	appearance.setShadowIntensity(snapshot.shadowIntensity);
	appearance.setBackgroundBlur(snapshot.backgroundBlur);
	appearance.setZoomMotionBlur(snapshot.zoomMotionBlur);
	appearance.setZoomMotionBlurTuning(snapshot.zoomMotionBlurTuning);
	appearance.setConnectZooms(snapshot.connectZooms);
	appearance.setZoomInDurationMs(snapshot.zoomInDurationMs);
	appearance.setZoomInOverlapMs(snapshot.zoomInOverlapMs);
	appearance.setZoomOutDurationMs(snapshot.zoomOutDurationMs);
	appearance.setConnectedZoomGapMs(snapshot.connectedZoomGapMs);
	appearance.setConnectedZoomDurationMs(snapshot.connectedZoomDurationMs);
	appearance.setZoomInEasing(snapshot.zoomInEasing);
	appearance.setZoomOutEasing(snapshot.zoomOutEasing);
	appearance.setConnectedZoomEasing(snapshot.connectedZoomEasing);
	appearance.setShowCursor(snapshot.showCursor);
	appearance.setLoopCursor(snapshot.loopCursor);
	appearance.setCursorStyle(snapshot.cursorStyle);
	appearance.setCursorSize(snapshot.cursorSize);
	appearance.setCursorSmoothing(snapshot.cursorSmoothing);
	appearance.setCursorSpringStiffnessMultiplier(snapshot.cursorSpringStiffnessMultiplier);
	appearance.setCursorSpringDampingMultiplier(snapshot.cursorSpringDampingMultiplier);
	appearance.setCursorSpringMassMultiplier(snapshot.cursorSpringMassMultiplier);
	appearance.setCameraSpringStiffnessMultiplier(snapshot.cameraSpringStiffnessMultiplier);
	appearance.setCameraSpringDampingMultiplier(snapshot.cameraSpringDampingMultiplier);
	appearance.setCameraSpringMassMultiplier(snapshot.cameraSpringMassMultiplier);
	appearance.setZoomSmoothness(snapshot.zoomSmoothness);
	appearance.setZoomClassicMode(snapshot.zoomClassicMode);
	appearance.setCursorMotionBlur(snapshot.cursorMotionBlur);
	appearance.setCursorClickEffect(snapshot.cursorClickEffect);
	appearance.setCursorClickEffectColor(snapshot.cursorClickEffectColor);
	appearance.setCursorClickEffectScale(snapshot.cursorClickEffectScale);
	appearance.setCursorClickEffectOpacity(snapshot.cursorClickEffectOpacity);
	appearance.setCursorClickEffectDurationMs(snapshot.cursorClickEffectDurationMs);
	appearance.setCursorClickBounce(snapshot.cursorClickBounce);
	appearance.setCursorClickBounceDuration(snapshot.cursorClickBounceDuration);
	appearance.setCursorSway(snapshot.cursorSway);
	appearance.setBorderRadius(snapshot.borderRadius);
	appearance.setPadding(snapshot.padding);
	appearance.setCropRegion(snapshot.cropRegion);
	appearance.setWebcam(snapshot.webcam);
}
