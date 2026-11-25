import { type EditorPreferences } from "../editorPreferences";
import type { ProjectEditorState } from "../projectPersistence";

const appearanceKeys = [
	"wallpaper",
	"shadowIntensity",
	"backgroundBlur",
	"zoomMotionBlur",
	"zoomMotionBlurTuning",
	"connectZooms",
	"zoomInDurationMs",
	"zoomInOverlapMs",
	"zoomOutDurationMs",
	"connectedZoomGapMs",
	"connectedZoomDurationMs",
	"zoomInEasing",
	"zoomOutEasing",
	"connectedZoomEasing",
	"showCursor",
	"loopCursor",
	"cursorStyle",
	"cursorSize",
	"cursorSmoothing",
	"cursorSpringStiffnessMultiplier",
	"cursorSpringDampingMultiplier",
	"cursorSpringMassMultiplier",
	"cameraSpringStiffnessMultiplier",
	"cameraSpringDampingMultiplier",
	"cameraSpringMassMultiplier",
	"cursorMotionBlur",
	"cursorClickEffect",
	"cursorClickEffectColor",
	"cursorClickEffectScale",
	"cursorClickEffectOpacity",
	"cursorClickEffectDurationMs",
	"cursorClickBounce",
	"cursorClickBounceDuration",
	"cursorSway",
	"borderRadius",
	"padding",
	"aspectRatio",
] as const satisfies readonly (keyof EditorPreferences & keyof ProjectEditorState)[];

export function pickRecordingAppearanceDefaults(editor: Partial<ProjectEditorState>): Partial<EditorPreferences> {
	const defaults = Object.fromEntries(
		appearanceKeys.flatMap(key => editor[key] === undefined ? [] : [[key, editor[key]]]),
	) as Partial<EditorPreferences>;
	if (editor.webcam) {
		const { sourcePath, visibleRanges, ...style } = editor.webcam;
		defaults.webcam = { ...style, sourcePath: null, enabled: false, timeOffsetMs: 0 };
	}
	return defaults;
}
