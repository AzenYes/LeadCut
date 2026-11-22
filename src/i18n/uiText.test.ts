import { afterEach, describe, expect, it, vi } from "vitest";
import en from "./locales/en/common.json";
import zh from "./locales/zh-CN/common.json";
import { getUiLocale, localizeUiMessage, translateUiForLocale, uiText } from "./uiText";
import { DEFAULT_SHORTCUTS, SHORTCUT_LABELS } from "@/lib/shortcuts";
import { BUILT_IN_WALLPAPERS } from "@/lib/wallpapers";

describe("reviewed interface translations", () => {
	afterEach(() => vi.unstubAllGlobals());
	it("preserves variables, paths and literal dollar signs in Chinese", () => {
		expect(translateUiForLocale("zh-CN", "selectedCount", { count: 3 })).toBe("已选择 3 项");
		expect(translateUiForLocale("zh-CN", "projectLoadedFromValue", { value0: "D:/演示/$video.leadcut" })).toBe("已从 D:/演示/$video.leadcut 打开项目");
		expect(translateUiForLocale("en", "selectedCount", { count: 3 })).toBe("3 selected");
		expect(translateUiForLocale("fr", "selectedCount", { count: 3 })).toBe("3 selected");
	});
	it("keeps the same interpolation fields in every Chinese message", () => {
		const placeholders = (value: string) => [...value.matchAll(/\{\{\s*(\w+)\s*\}\}/g)].map(m => m[1]).sort();
		for (const [key, value] of Object.entries(en.interface)) {
			expect(placeholders(zh.interface[key as keyof typeof zh.interface]), key).toEqual(placeholders(value));
		}
	});
	it("updates lazy shortcut and wallpaper labels when the saved language changes", () => {
		let locale = "zh-CN";
		vi.stubGlobal("window", { localStorage: { getItem: () => locale } });
		expect(getUiLocale()).toBe("zh-CN");
		expect(SHORTCUT_LABELS.splitClip).toBe("拆分片段");
		expect(BUILT_IN_WALLPAPERS[0].label).toBe("Tahoe 浅色");
		locale = "en";
		expect(SHORTCUT_LABELS.splitClip).toBe("Split Clip");
		expect(BUILT_IN_WALLPAPERS[0].label).toBe("Tahoe Light");
		expect(DEFAULT_SHORTCUTS.splitClip.key).toBe("f2");
	});
	it("localizes known error messages and preserves unknown diagnostics", () => {
		expect(localizeUiMessage("No video loaded", "zh-CN")).toBe("尚未加载视频");
		expect(localizeUiMessage("FFmpeg diagnostic: custom-code 17", "zh-CN")).toBe("FFmpeg diagnostic: custom-code 17");
		expect(translateUiForLocale("zh-TW", "selectAll")).toBe("Select all");
		expect(uiText("missingTranslation")).toBe("missingTranslation");
	});
});
