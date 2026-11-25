import { handleTrustedIpc, isTrustedIpcSender, onTrustedIpc } from "../../trustedIpc";
import { readAppEnv } from "../../envCompat";
import {
	ADVANCED_SECTIONS_STORAGE_KEY, CAPTION_PANEL_WIDTH_STORAGE_KEY, CAPTION_PAUSE_ON_TYPING_STORAGE_KEY,
	CAPTION_PRESETS_STORAGE_KEY, CAPTION_QUALITY_SETTINGS_KEY, CAPTION_SKIP_RIPPLE_CONFIRM_STORAGE_KEY,
	DURABLE_RENDERER_STORAGE_KEYS, EDITOR_LAYOUT_STORAGE_KEY, EDITOR_PREFERENCES_STORAGE_KEY,
	EDITOR_PRESETS_STORAGE_KEY, KEYSTROKE_CAPTURE_MODE_SETTING_KEY, KEYSTROKE_PRESETS_STORAGE_KEY,
	LOCALE_STORAGE_KEY, NVIDIA_CUDA_EXPORT_OPT_IN_SETTING_KEY, ONBOARDING_SEEN_STORAGE_KEY,
	REVIEW_RATE_SETTING_KEY, THEME_STORAGE_KEY,
} from "../../../src/lib/storageKeys";
import { createCountdownController } from "../../countdownController";
import { setNativeUiLocale } from "../../uiI18n";
import { getDetachedPreviewWindow } from "../../navigationPolicy";
import { showExportDiagnosticsBundleDialog } from "../../diagnosticsBundle";
import { appLog } from "../../logger";
import { getRecordingShortcuts, saveRecordingShortcuts, setRecordingShortcutCapture } from "../../recordingShortcuts";
import fs from "node:fs/promises";
import { app, BrowserWindow, type WebContents } from "electron";
import { readAppSetting, writeAppSetting } from "../../appSettingsStore";
import { createCountdownWindow, getHudOverlayWindow } from "../../windows";
import { COUNTDOWN_SETTINGS_FILE, SHORTCUTS_FILE } from "../constants";
import { configureLeadCutAgent } from "../settings/agentConnection";
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

const rendererSettingsSnapshotKeys = new Set([
	...DURABLE_RENDERER_STORAGE_KEYS,
	ADVANCED_SECTIONS_STORAGE_KEY, CAPTION_PANEL_WIDTH_STORAGE_KEY, CAPTION_PAUSE_ON_TYPING_STORAGE_KEY,
	CAPTION_PRESETS_STORAGE_KEY, CAPTION_QUALITY_SETTINGS_KEY, CAPTION_SKIP_RIPPLE_CONFIRM_STORAGE_KEY,
	EDITOR_LAYOUT_STORAGE_KEY, EDITOR_PREFERENCES_STORAGE_KEY, EDITOR_PRESETS_STORAGE_KEY,
	KEYSTROKE_CAPTURE_MODE_SETTING_KEY, KEYSTROKE_PRESETS_STORAGE_KEY, LOCALE_STORAGE_KEY,
	NVIDIA_CUDA_EXPORT_OPT_IN_SETTING_KEY, ONBOARDING_SEEN_STORAGE_KEY, REVIEW_RATE_SETTING_KEY, THEME_STORAGE_KEY,
]);

export type RendererSettingUpdate = { key: string; value: unknown; revision: number };
export type RendererSettingsSnapshot = { entries: [string, unknown][]; revision: number };
let rendererSettingsRevision = 0;

function publishRendererSetting(key: string, value: unknown, sender: WebContents, localeChanged = false) {
	if (!rendererSettingsSnapshotKeys.has(key)) return;
	const update = { key, value, revision: ++rendererSettingsRevision };
	for (const window of BrowserWindow.getAllWindows()) {
		if (window.isDestroyed()) continue;
		const contents = window.webContents;
		if (contents === sender || contents.isDestroyed() ||
			!isTrustedIpcSender({ sender: contents, senderFrame: contents.mainFrame })) continue;
		contents.send("app-settings:changed", update);
		if (localeChanged) contents.send("app-locale-changed", value);
	}
	return update;
}

function saveRendererSetting(sender: WebContents, key: unknown, value: unknown) {
	try {
		if (typeof key !== "string" || key.length === 0) return { success: false };
		const localeChanged = key === LOCALE_STORAGE_KEY && typeof value === "string" && readAppSetting(key) !== value;
		writeAppSetting(key, value, { flush: [CAPTION_PRESETS_STORAGE_KEY, EDITOR_PRESETS_STORAGE_KEY, KEYSTROKE_PRESETS_STORAGE_KEY].includes(key) });
		if (localeChanged) setNativeUiLocale(value);
		return { success: true, update: publishRendererSetting(key, value, sender, localeChanged) };
	} catch (error) {
		console.error("Failed to save app setting:", error);
		return { success: false };
	}
}

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
	handleTrustedIpc("patch-editor-preferences", (event, changes: unknown, flush?: unknown) => {
		if (!event.senderFrame || event.senderFrame !== event.sender.mainFrame ||
			!changes || typeof changes !== "object" || Array.isArray(changes)) return { success: false };
		const previous = readAppSetting(EDITOR_PREFERENCES_STORAGE_KEY);
		const current = previous && typeof previous === "object" && !Array.isArray(previous) ? previous : {};
		const value = { ...current, ...changes };
		writeAppSetting(EDITOR_PREFERENCES_STORAGE_KEY, value, { flush: flush === true });
		return { success: true, update: publishRendererSetting(EDITOR_PREFERENCES_STORAGE_KEY, value, event.sender) };
	});
	handleTrustedIpc("configure-leadcut-agent", (event, agent: unknown) => {
		if (!event.senderFrame || event.senderFrame !== event.sender.mainFrame) return { success: false, error: "untrusted-frame" };
		return configureLeadCutAgent(agent);
	});
	handleTrustedIpc("get-recording-shortcuts", getRecordingShortcuts);
	handleTrustedIpc("set-recording-shortcuts", (_event, config: unknown) => saveRecordingShortcuts(config));
	onTrustedIpc("set-recording-shortcut-capture", (event, active: unknown) => {
		if (typeof active === "boolean") setRecordingShortcutCapture(event.sender, active);
	});
	onTrustedIpc("app-log:write", (_event, level: unknown, scope: unknown, message: unknown, detail: unknown) => {
		if ((level !== "info" && level !== "warn" && level !== "error") ||
			typeof scope !== "string" || typeof message !== "string") return;
		appLog(level, scope.slice(0, 100), message.slice(0, 8192),
			typeof detail === "string" ? detail.slice(0, 8192) : undefined);
	});
	handleTrustedIpc("export-diagnostics-bundle", event =>
		showExportDiagnosticsBundleDialog(BrowserWindow.fromWebContents(event.sender)));
	onTrustedIpc("get-preview-display-bounds", event => {
		event.returnValue = getScreen().getAllDisplays().map(display => display.workArea);
	});
	handleTrustedIpc("set-detached-preview-fullscreen", (event, fullscreen: unknown) => {
		const preview = getDetachedPreviewWindow(event.sender);
		if (!preview || typeof fullscreen !== "boolean") return false;
		preview.setFullScreen(fullscreen);
		return true;
	});
	handleTrustedIpc(
		"get-window-fullscreen",
		(event) => BrowserWindow.fromWebContents(event.sender)?.isFullScreen() ?? false,
	);
	handleTrustedIpc("app:getVersion", () => {
		return app.getVersion();
	});

	handleTrustedIpc("get-window-chrome", (event) => {
		const win = BrowserWindow.fromWebContents(event.sender);
		return {
			trafficLightsVisible:
				process.platform === "darwin" &&
				!!win &&
				!win.isFullScreen() &&
				!win.isSimpleFullScreen(),
		};
	});

	handleTrustedIpc("get-platform", () => {
		return process.platform;
	});

	onTrustedIpc("app-settings:snapshot", event => {
		const snapshot: RendererSettingsSnapshot = {
			entries: Array.from(rendererSettingsSnapshotKeys, key => [key, readAppSetting(key)]),
			revision: rendererSettingsRevision,
		};
		event.returnValue = snapshot;
	});

	onTrustedIpc("app-settings:get", (event, key: unknown) => {
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

	onTrustedIpc("app-settings:set", (event, key: unknown, value: unknown) => {
		event.returnValue = saveRendererSetting(event.sender, key, value);
	});
	handleTrustedIpc("app-settings:set-async", (event, key: unknown, value: unknown) =>
		saveRendererSetting(event.sender, key, value));

	handleTrustedIpc("get-shortcuts", async () => {
		try {
			const data = await fs.readFile(SHORTCUTS_FILE, "utf-8");
			return parseJsonWithByteOrderMark(data);
		} catch {
			return null;
		}
	});

	handleTrustedIpc("save-shortcuts", async (_, shortcuts: unknown) => {
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
	handleTrustedIpc("get-recording-preferences", async () => {
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

	handleTrustedIpc("get-recording-audio-lab-config", () => {
		return getBrowserMicrophoneProfileFromEnv();
	});

	handleTrustedIpc("set-recording-preferences", async (_, prefs: RecordingPreferencesPatch) => {
		try {
			await recordingPreferencesStore.update(prefs);
			return { success: true };
		} catch (error) {
			console.error("Failed to save recording preferences:", error);
			return { success: false, error: String(error) };
		}
	});

	handleTrustedIpc("get-countdown-delay", async () => {
		try {
			const content = await fs.readFile(COUNTDOWN_SETTINGS_FILE, "utf-8");
			const parsed = parseJsonWithByteOrderMark<{ delay?: number }>(content);
			return { success: true, delay: parsed.delay ?? 3 };
		} catch {
			return { success: true, delay: 3 };
		}
	});

	handleTrustedIpc("set-countdown-delay", async (_, delay: number) => {
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
	handleTrustedIpc("start-countdown", (event, seconds: number) => {
		const caller = BrowserWindow.fromWebContents(event.sender);
		const workArea = caller && caller !== getHudOverlayWindow()
			? getScreen().getDisplayMatching(caller.getBounds()).workArea
			: undefined;
		return countdown.start(seconds, workArea);
	});
	handleTrustedIpc("cancel-countdown", () => countdown.cancel());

	handleTrustedIpc("get-active-countdown", () => {
		return {
			success: true,
			seconds: countdownInProgress ? countdownRemaining : null,
		};
	});
}
