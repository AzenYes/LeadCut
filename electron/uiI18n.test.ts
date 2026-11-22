import { afterEach, describe, expect, it, vi } from "vitest";
vi.mock("electron", () => ({ app: { getLocale: () => "en-US" } }));
import { getNativeUiLocale, nativeUiEvents, setNativeUiLocale, uiText } from "./uiI18n";

describe("native interface language", () => {
	afterEach(() => { nativeUiEvents.removeAllListeners(); setNativeUiLocale("en-US"); });
	it("uses the selected language for native file dialogs and source names", () => {
		setNativeUiLocale("zh-CN");
		expect(getNativeUiLocale()).toBe("zh-CN");
		expect(uiText("saveExportedVideo")).toBe("保存导出的视频");
		expect(uiText("screenValuePrimary", { value0: 2 })).toBe("屏幕 2（主屏幕）");
		setNativeUiLocale("en-US");
		expect(uiText("saveExportedVideo")).toBe("Save Exported Video");
	});
	it("refreshes menus only when the language changes", () => {
		setNativeUiLocale("en-US");
		const refresh = vi.fn(); nativeUiEvents.on("locale-changed", refresh);
		setNativeUiLocale("zh-CN"); setNativeUiLocale("zh-CN");
		expect(refresh).toHaveBeenCalledTimes(1);
		expect(uiText("showControls")).toBe("显示录制控制栏");
	});
});
