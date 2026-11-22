import { afterEach, describe, expect, it, vi } from "vitest";
import {
	CAPTION_PRESETS_STORAGE_KEY,
	AZHEN_PR_CAPTION_PRESET,
	captionPresetStyle,
	loadCaptionPresets,
	normalizeCaptionPresets,
	saveCaptionPresets,
} from "./captionPresets";
import { DEFAULT_AUTO_CAPTION_SETTINGS } from "./types";
import { normalizeProjectEditor } from "./projectPersistence";
import {
	getCaptionFontWeight,
	getCaptionScaledFontSize,
	getCaptionTextEffects,
} from "./captionStyle";

afterEach(() => vi.unstubAllGlobals());
const preset = {
	id: "custom",
	name: "我的字幕",
	style: captionPresetStyle({
		...DEFAULT_AUTO_CAPTION_SETTINGS,
		fontFamily: '"IBM Plex Sans SC"',
		fontSize: 48,
		fontWeight: "bold",
		shadowEnabled: true,
		strokeWidth: 2,
	}),
};

describe("subtitle presets", () => {
	it("adapts the PR Medium font and 4K visual size, outside outline and shadow without touching cues", () => {
		const settings = { ...DEFAULT_AUTO_CAPTION_SETTINGS, ...AZHEN_PR_CAPTION_PRESET.style };
		const size = getCaptionScaledFontSize(settings.fontSize, 3840, settings.maxWidth);
		expect(size).toBe(130);
		expect(getCaptionFontWeight(settings)).toBe(500);
		const effects = getCaptionTextEffects(settings, size);
		expect(effects.strokeWidth / 2).toBe(5);
		expect(effects.shadowColor).toBe("rgba(0, 0, 0, 0.5)");
		expect(effects.shadowBlur).toBe(4);
		expect(Math.hypot(effects.shadowOffsetX, effects.shadowOffsetY)).toBeCloseTo(5.7);
		expect(effects.shadowOffsetX).toBeGreaterThan(0);
		expect(effects.shadowOffsetY).toBeGreaterThan(0);
		expect(settings.maxRows).toBe(1);
		expect(settings.backgroundOpacity).toBe(0);
		expect(
			normalizeProjectEditor({ autoCaptionSettings: settings }).autoCaptionSettings,
		).toEqual(settings);
	});
	it("round trips all appearance settings through app storage without copying recognition or timeline controls", () => {
		const values = new Map<string, unknown>();
		vi.stubGlobal("electronAPI", {
			getAppSetting: (key: string) => values.get(key),
			setAppSetting: (key: string, value: unknown) => {
				values.set(key, value);
				return true;
			},
		});
		expect(saveCaptionPresets([preset])).toBe(true);
		expect(loadCaptionPresets()).toEqual([preset]);
		expect(preset.style).not.toHaveProperty("enabled");
		expect(preset.style).not.toHaveProperty("language");
		expect(preset.style).not.toHaveProperty("timelineQuickAdd");
	});
	it("recovers valid presets from mixed corrupt data and normalizes unsafe sizes", () => {
		expect(
			normalizeCaptionPresets([null, {}, preset, preset, { id: "bad", name: "", style: {} }]),
		).toEqual([preset]);
		expect(
			normalizeCaptionPresets([
				{ ...preset, style: { ...preset.style, fontSize: 10000, shadowOpacity: -1 } },
			])[0].style,
		).toMatchObject({ fontSize: 72, shadowOpacity: 0 });
	});
	it("falls back to browser storage and persists deletion", () => {
		const values = new Map<string, string>();
		vi.stubGlobal("localStorage", {
			getItem: (key: string) => values.get(key) ?? null,
			setItem: (key: string, value: string) => values.set(key, value),
		});
		expect(saveCaptionPresets([preset])).toBe(true);
		expect(values.has(CAPTION_PRESETS_STORAGE_KEY)).toBe(true);
		expect(loadCaptionPresets()).toEqual([preset]);
		expect(saveCaptionPresets([])).toBe(true);
		expect(loadCaptionPresets()).toEqual([]);
	});
	it("reports failure when both storage methods are unavailable", () => {
		vi.stubGlobal("localStorage", {
			setItem: () => {
				throw new Error("denied");
			},
		});
		expect(saveCaptionPresets([preset])).toBe(false);
	});
});
