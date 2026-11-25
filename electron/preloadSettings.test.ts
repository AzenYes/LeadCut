import { contextBridge, ipcRenderer } from "electron";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { RendererSettingUpdate } from "./ipc/register/settings";

vi.mock("electron", () => ({
	contextBridge: { exposeInMainWorld: vi.fn() },
	ipcRenderer: { invoke: vi.fn(), on: vi.fn(), sendSync: vi.fn() },
}));

describe("preload settings snapshot", () => {
	let settings: Window["electronAPI"];
	let receiveSettingUpdate: (update: RendererSettingUpdate) => void;
	const theme = "leadcut.theme";
	const locale = "leadcut.locale";

	beforeEach(async () => {
		vi.resetModules();
		vi.resetAllMocks();
		await import("./preload");
		settings = vi.mocked(contextBridge.exposeInMainWorld).mock.calls[0][1] as Window["electronAPI"];
		const listener = vi.mocked(ipcRenderer.on).mock.calls.find(([channel]) => channel === "app-settings:changed")![1];
		receiveSettingUpdate = update => listener({} as Electron.IpcRendererEvent, update);
		vi.mocked(ipcRenderer.sendSync).mockReturnValueOnce({
			entries: [[theme, "dark"], [locale, null]],
			revision: 1,
		});
	});

	it("reads all startup values from one synchronous request, including missing values", () => {
		expect(settings.getAppSetting(theme)).toBe("dark");
		expect(settings.getAppSetting(locale)).toBeNull();
		expect(settings.getAppSetting(theme)).toBe("dark");
		expect(ipcRenderer.sendSync).toHaveBeenCalledExactlyOnceWith("app-settings:snapshot");
	});

	it("keeps setting revisions independent when a local write overtakes a queued update", () => {
		expect(settings.getAppSetting(theme)).toBe("dark");
		vi.mocked(ipcRenderer.sendSync).mockReturnValueOnce({
			success: true, update: { key: theme, value: "light", revision: 4 },
		});
		expect(settings.setAppSetting(theme, "light")).toBe(true);
		receiveSettingUpdate({ key: theme, value: "system", revision: 3 });
		receiveSettingUpdate({ key: locale, value: "zh-CN", revision: 2 });
		expect(settings.getAppSetting(theme)).toBe("light");
		expect(settings.getAppSetting(locale)).toBe("zh-CN");
		expect(ipcRenderer.sendSync).toHaveBeenCalledTimes(2);
	});

	it("updates the snapshot after an asynchronous save and preserves cached values on failure", async () => {
		expect(settings.getAppSetting(locale)).toBeNull();
		vi.mocked(ipcRenderer.invoke).mockResolvedValueOnce({
			success: true, update: { key: locale, value: "en", revision: 2 },
		}).mockResolvedValueOnce({ success: false });
		expect(await settings.setAppSettingAsync?.(locale, "en")).toBe(true);
		expect(await settings.setAppSettingAsync?.(locale, "fr")).toBe(false);
		expect(settings.getAppSetting(locale)).toBe("en");
		expect(ipcRenderer.sendSync).toHaveBeenCalledTimes(1);
	});
});
