import { readAppEnv } from "../../envCompat";
import { CAPTION_PRESETS_STORAGE_KEY, EDITOR_PRESETS_STORAGE_KEY, KEYSTROKE_PRESETS_STORAGE_KEY, LOCALE_STORAGE_KEY } from "../../../src/lib/storageKeys";
import { createCountdownController } from "../../countdownController";
import { setNativeUiLocale } from "../../uiI18n";
import { getDetachedPreviewWindow } from "../../navigationPolicy";
import { showExportDiagnosticsBundleDialog } from "../../diagnosticsBundle";
import { appLog } from "../../logger";
import { getRecordingShortcuts, saveRecordingShortcuts, setRecordingShortcutCapture } from "../../recordingShortcuts";
import fs from "node:fs/promises";
import { app, BrowserWindow, ipcMain } from "electron";
import { readAppSetting, writeAppSetting } from "../../appSettingsStore";
import { hideCursor } from "../../cursorHider";
import { createCountdownWindow, getHudOverlayWindow } from "../../windows";
import { COUNTDOWN_SETTINGS_FILE, SHORTCUTS_FILE } from "../constants";
import {
	recordingPreferencesStore,
	type RecordingPreferencesPatch,
} from "../settings/recordingPreferencesStore";
import {
	countdownInProgress,
	countdownRemaining,
	setCountdownInProgress,
	setCountdownRemaining,
} from "../state";
import { getScreen, parseJsonWithByteOrderMark } from "../utils";

const DEFAULT_BROWSER_MICROPHONE_PROFILE = "processed";
const BROWSER_MICROPHONE_PROFILES = new Set([
	"processed",
	"no-agc",
	"no-echo",
	"no-noise-suppression",
	"raw",
]);

function getBrowserMicrophoneProfileFromEnv() {
	const requested = readAppEnv("BROWSER_MIC_PROFILE")?.trim() || null;
	const normalized = requested?.toLowerCase() ?? DEFAULT_BROWSER_MICROPHONE_PROFILE;
	return {
		browserMicrophoneProfile: BROWSER_MICROPHONE_PROFILES.has(normalized)
			? normalized
			: DEFAULT_BROWSER_MICROPHONE_PROFILE,
		requestedBrowserMicrophoneProfile: requested,
	};
}

export function registerSettingsHandlers() {
	ipcMain.handle("get-recording-shortcuts", getRecordingShortcuts);
	ipcMain.handle("set-recording-shortcuts", (_event, config: unknown) => saveRecordingShortcuts(config));
	ipcMain.on("set-recording-shortcut-capture", (event, active: unknown) => {
		if (typeof active === "boolean") setRecordingShortcutCapture(event.sender, active);
	});
	ipcMain.on("app-log:write", (_event, level: unknown, scope: unknown, message: unknown, detail: unknown) => {
		if ((level !== "info" && level !== "warn" && level !== "error") ||
			typeof scope !== "string" || typeof message !== "string") return;
		appLog(level, scope.slice(0, 100), message.slice(0, 8192),
			typeof detail === "string" ? detail.slice(0, 8192) : undefined);
	});
	ipcMain.handle("export-diagnostics-bundle", event =>
		showExportDiagnosticsBundleDialog(BrowserWindow.fromWebContents(event.sender)));
	ipcMain.on("get-preview-display-bounds", event => {
		event.returnValue = getScreen().getAllDisplays().map(display => display.workArea);
	});
	ipcMain.handle("set-detached-preview-fullscreen", (event, fullscreen: unknown) => {
		const preview = getDetachedPreviewWindow(event.sender);
		if (!preview || typeof fullscreen !== "boolean") return false;
		preview.setFullScreen(fullscreen);
		return true;
	});
	ipcMain.handle(
		"get-window-fullscreen",
		(event) => BrowserWindow.fromWebContents(event.sender)?.isFullScreen() ?? false,
	);
	ipcMain.handle("app:getVersion", () => {
		return app.getVersion();
	});

	ipcMain.handle("get-window-chrome", (event) => {
		const win = BrowserWindow.fromWebContents(event.sender);
		return {
			trafficLightsVisible:
				process.platform === "darwin" &&
				!!win &&
				!win.isFullScreen() &&
				!win.isSimpleFullScreen(),
		};
	});

	ipcMain.handle("get-platform", () => {
		return process.platform;
	});

	ipcMain.on("app-settings:get", (event, key: unknown) => {
		try {
			if (typeof key !== "string" || key.length === 0) {
				event.returnValue = { success: false, value: null };
				return;
			}

			event.returnValue = {
				success: true,
				value: readAppSetting(key),
			};
		} catch (error) {
			console.error("Failed to read app setting:", error);
			event.returnValue = { success: false, value: null };
		}
	});

	ipcMain.on("app-settings:set", (event, key: unknown, value: unknown) => {
		try {
			if (typeof key !== "string" || key.length === 0) {
				event.returnValue = { success: false };
				return;
			}

			const localeChanged = key === LOCALE_STORAGE_KEY && typeof value === "string" && readAppSetting(key) !== value;
			writeAppSetting(key, value, { flush: [CAPTION_PRESETS_STORAGE_KEY, EDITOR_PRESETS_STORAGE_KEY, KEYSTROKE_PRESETS_STORAGE_KEY].includes(key) });
			if (localeChanged) {
				setNativeUiLocale(value);
				for (const window of BrowserWindow.getAllWindows()) {
					if (!window.isDestroyed() && window.webContents !== event.sender) {
						window.webContents.send("app-locale-changed", value);
					}
				}
			}
			event.returnValue = { success: true };
		} catch (error) {
			console.error("Failed to save app setting:", error);
			event.returnValue = { success: false };
		}
	});

	// ---------------------------------------------------------------------------
	// Cursor hiding for the browser-capture fallback.
	// The IPC promise resolves only after the cursor hide attempt completes.
	// ---------------------------------------------------------------------------
	ipcMain.handle("hide-cursor", () => {
		if (process.platform !== "win32") {
			return { success: true };
		}

		return { success: hideCursor() };
	});

	ipcMain.handle("get-shortcuts", async () => {
		try {
			const data = await fs.readFile(SHORTCUTS_FILE, "utf-8");
			return parseJsonWithByteOrderMark(data);
		} catch {
			return null;
		}
	});

	ipcMain.handle("save-shortcuts", async (_, shortcuts: unknown) => {
		try {
			await fs.writeFile(SHORTCUTS_FILE, JSON.stringify(shortcuts, null, 2), "utf-8");
			return { success: true };
		} catch (error) {
			console.error("Failed to save shortcuts:", error);
			return { success: false, error: String(error) };
		}
	});

	// ---------------------------------------------------------------------------
	// Countdown timer before recording
	// ---------------------------------------------------------------------------
	ipcMain.handle("get-recording-preferences", async () => {
		try {
			const parsed = await recordingPreferencesStore.read();
			return {
				success: true,
				microphoneEnabled: parsed.microphoneEnabled === true,
				microphoneDeviceId:
					typeof parsed.microphoneDeviceId === "string"
						? parsed.microphoneDeviceId
						: undefined,
				microphoneDeviceLabel:
					typeof parsed.microphoneDeviceLabel === "string" ? parsed.microphoneDeviceLabel : undefined,
				systemAudioEnabled: parsed.systemAudioEnabled === true,
				webcamEnabled: parsed.webcamEnabled === true,
				webcamDeviceId:
					typeof parsed.webcamDeviceId === "string" ? parsed.webcamDeviceId : undefined,
				webcamDeviceLabel:
					typeof parsed.webcamDeviceLabel === "string" ? parsed.webcamDeviceLabel : undefined,
			};
		} catch {
			return {
				success: true,
				microphoneEnabled: false,
				microphoneDeviceId: undefined,
				systemAudioEnabled: true,
				webcamEnabled: false,
				webcamDeviceId: undefined,
			};
		}
	});

	ipcMain.handle("get-recording-audio-lab-config", () => {
		return getBrowserMicrophoneProfileFromEnv();
	});

	ipcMain.handle("set-recording-preferences", async (_, prefs: RecordingPreferencesPatch) => {
		try {
			await recordingPreferencesStore.update(prefs);
			return { success: true };
		} catch (error) {
			console.error("Failed to save recording preferences:", error);
			return { success: false, error: String(error) };
		}
	});

	ipcMain.handle("get-countdown-delay", async () => {
		try {
			const content = await fs.readFile(COUNTDOWN_SETTINGS_FILE, "utf-8");
			const parsed = parseJsonWithByteOrderMark<{ delay?: number }>(content);
			return { success: true, delay: parsed.delay ?? 3 };
		} catch {
			return { success: true, delay: 3 };
		}
	});

	ipcMain.handle("set-countdown-delay", async (_, delay: number) => {
		try {
			await fs.writeFile(
				COUNTDOWN_SETTINGS_FILE,
				JSON.stringify({ delay }, null, 2),
				"utf-8",
			);
			return { success: true };
		} catch (error) {
			console.error("Failed to save countdown delay:", error);
			return { success: false, error: String(error) };
		}
	});

	const countdown = createCountdownController((workArea) => createCountdownWindow(false, workArea), (remaining) => {
		setCountdownRemaining(remaining);
		setCountdownInProgress(remaining !== null);
	}, (window) => {
		// Reuse the prepared renderer so every recording starts its countdown promptly.
		if (window.webContents.isLoadingMainFrame()) window.close();
		else { window.hide(); window.webContents.send("countdown-tick", null); }
	});
	ipcMain.handle("start-countdown", (event, seconds: number) => {
		const caller = BrowserWindow.fromWebContents(event.sender);
		const workArea = caller && caller !== getHudOverlayWindow()
			? getScreen().getDisplayMatching(caller.getBounds()).workArea
			: undefined;
		return countdown.start(seconds, workArea);
	});
	ipcMain.handle("cancel-countdown", () => countdown.cancel());

	ipcMain.handle("get-active-countdown", () => {
		return {
			success: true,
			seconds: countdownInProgress ? countdownRemaining : null,
		};
	});
}
