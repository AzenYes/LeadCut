import { CAPTION_PRESETS_STORAGE_KEY } from "@/lib/storageKeys";
import { loadAppSetting, saveAppSetting } from "@/lib/appSettings";
import { normalizeProjectEditor } from "./projectPersistence";
import { DEFAULT_AUTO_CAPTION_SETTINGS, type AutoCaptionSettings } from "./types";

export { CAPTION_PRESETS_STORAGE_KEY } from "@/lib/storageKeys";

export type CaptionPresetStyle = Omit<
	AutoCaptionSettings,
	"enabled" | "timelineQuickAdd" | "language"
>;
export interface CaptionPreset {
	id: string;
	name: string;
	style: CaptionPresetStyle;
}

/** PR skill reference: visual em 130px and outside outline 5px at 3840px width.
 * LeadCut stores effects at its 1920px reference size; preview and export scale together.
 * A PR 135-degree shadow points down/right, 5.7px / sqrt(2) on each axis at 4K.
 */
export const AZHEN_PR_CAPTION_PRESET: CaptionPreset = {
	id: "leadcut.azhen-pr.v1",
	name: "阿真 PR 字幕",
	style: captionPresetStyle({
		...DEFAULT_AUTO_CAPTION_SETTINGS,
		fontFamily: '"IBM Plex Sans SC"',
		fontWeight: "medium",
		fontSize: 65,
		maxWidth: 62,
		maxRows: 1,
		bottomOffset: 3,
		textColor: "#FFFFFF",
		inactiveTextColor: "#FFFFFF",
		strokeWidth: 2.5,
		strokePosition: "outside",
		strokeColor: "#000000",
		shadowEnabled: true,
		shadowColor: "#000000",
		shadowOpacity: 0.5,
		shadowBlur: 2,
		shadowOffsetX: 5.7 / Math.SQRT2 / 2,
		shadowOffsetY: 5.7 / Math.SQRT2 / 2,
		backgroundOpacity: 0,
		boxRadius: 0,
		animationStyle: "none",
	}),
};

export function captionPresetStyle(settings: AutoCaptionSettings): CaptionPresetStyle {
	const {
		enabled: _enabled,
		timelineQuickAdd: _quickAdd,
		language: _language,
		...style
	} = settings;
	return style;
}

export function normalizeCaptionPresets(value: unknown): CaptionPreset[] {
	if (!Array.isArray(value)) return [];
	const ids = new Set<string>();
	return value.flatMap((item) => {
		if (
			!item ||
			typeof item.id !== "string" ||
			!item.id.trim() ||
			ids.has(item.id) ||
			typeof item.name !== "string" ||
			!item.name.trim() ||
			!item.style ||
			typeof item.style !== "object"
		)
			return [];
		ids.add(item.id);
		return [
			{
				id: item.id,
				name: item.name.trim(),
				style: captionPresetStyle(
					normalizeProjectEditor({ autoCaptionSettings: item.style }).autoCaptionSettings,
				),
			},
		];
	});
}

export function loadCaptionPresets(): CaptionPreset[] {
	const persisted = loadAppSetting<unknown>(CAPTION_PRESETS_STORAGE_KEY);
	if (persisted !== null) return normalizeCaptionPresets(persisted);
	try {
		return normalizeCaptionPresets(
			JSON.parse(globalThis.localStorage?.getItem(CAPTION_PRESETS_STORAGE_KEY) ?? "[]"),
		);
	} catch {
		return [];
	}
}

export function saveCaptionPresets(presets: CaptionPreset[]): boolean {
	const normalized = normalizeCaptionPresets(presets);
	const appSaved = saveAppSetting(CAPTION_PRESETS_STORAGE_KEY, normalized);
	let browserSaved = false;
	try {
		if (globalThis.localStorage) {
			globalThis.localStorage.setItem(
				CAPTION_PRESETS_STORAGE_KEY,
				JSON.stringify(normalized),
			);
			browserSaved = true;
		}
	} catch {
		/* App settings can still persist when browser storage is unavailable. */
	}
	return appSaved || browserSaved;
}
