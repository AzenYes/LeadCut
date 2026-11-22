import { BrowserWindow, globalShortcut, type WebContents } from "electron";
import {
	bindingToAccelerator,
	DEFAULT_RECORDING_SHORTCUTS,
	findRecordingShortcutConflict,
	RECORDING_SHORTCUT_ACTIONS,
	type RecordingShortcutAction,
	type RecordingShortcutSaveResult,
	type RecordingShortcutStatus,
	type RecordingShortcutsConfig,
} from "../src/lib/recordingShortcuts";
import { readAppSetting, writeAppSetting } from "./appSettingsStore";
import { appLog } from "./logger";

export { bindingToAccelerator, DEFAULT_RECORDING_SHORTCUTS, findRecordingShortcutConflict, RECORDING_SHORTCUT_ACTIONS };

type Handlers = Partial<Record<RecordingShortcutAction, () => void>>;
const SETTING_KEY = "leadcut.recordingShortcuts";
const registrations = new Set<string>();
let shortcutHandlers: Handlers = {};
let shortcutStatus: RecordingShortcutStatus = { config: DEFAULT_RECORDING_SHORTCUTS, failed: [] };
let endKeyCapture: (() => void) | null = null;
let keyCaptureOwner: WebContents | null = null;

export function setRecordingShortcutCapture(sender: WebContents, active: boolean) {
	if (!active) {
		if (keyCaptureOwner === sender) endKeyCapture?.();
		return;
	}
	const window = BrowserWindow.fromWebContents(sender);
	if (!window?.isFocused()) return;
	endKeyCapture?.();
	keyCaptureOwner = sender;
	const release = () => {
		window.removeListener("blur", release);
		sender.removeListener("destroyed", release);
		sender.removeListener("did-start-loading", release);
		sender.removeListener("render-process-gone", release);
		endKeyCapture = null;
		keyCaptureOwner = null;
		globalShortcut.setSuspended(false);
	};
	endKeyCapture = release;
	window.once("blur", release);
	sender.once("destroyed", release);
	sender.once("did-start-loading", release);
	sender.once("render-process-gone", release);
	globalShortcut.setSuspended(true);
}

export function applyRecordingShortcuts(config: RecordingShortcutsConfig, handlers: Handlers) {
	for (const accelerator of registrations) globalShortcut.unregister(accelerator);
	registrations.clear();

	const failed: RecordingShortcutAction[] = [];
	for (const action of RECORDING_SHORTCUT_ACTIONS) {
		const accelerator = bindingToAccelerator(config[action]);
		try {
			if (accelerator && globalShortcut.register(accelerator, () => handlers[action]?.())) {
				registrations.add(accelerator);
				continue;
			}
		} catch (error) {
			appLog("warn", "recording-shortcuts", `Could not register ${action}.`, error);
		}
		failed.push(action);
	}
	return failed;
}

function parseConfig(value: unknown): RecordingShortcutsConfig | null {
	if (!value || typeof value !== "object") return null;
	const supplied = value as Partial<Record<RecordingShortcutAction, unknown>>;
	const config = { ...DEFAULT_RECORDING_SHORTCUTS };
	for (const action of RECORDING_SHORTCUT_ACTIONS) {
		const candidate = supplied[action];
		if (!candidate || typeof candidate !== "object") return null;
		const binding = candidate as { key?: unknown; ctrl?: unknown; alt?: unknown; shift?: unknown };
		if (typeof binding.key !== "string" ||
			[binding.ctrl, binding.alt, binding.shift].some(modifier =>
				modifier !== undefined && typeof modifier !== "boolean")) return null;
		config[action] = {
			key: binding.key.toLowerCase(),
			ctrl: binding.ctrl === true,
			alt: binding.alt === true,
			shift: binding.shift === true,
		};
	}
	return config;
}

export function startRecordingShortcuts(handlers: Handlers) {
	shortcutHandlers = handlers;
	const saved = parseConfig(readAppSetting(SETTING_KEY));
	const config = saved && !findRecordingShortcutConflict(saved) ? saved : DEFAULT_RECORDING_SHORTCUTS;
	shortcutStatus = { config, failed: applyRecordingShortcuts(config, shortcutHandlers) };
}

export function getRecordingShortcuts() {
	return shortcutStatus;
}

export function saveRecordingShortcuts(value: unknown): RecordingShortcutSaveResult {
	const config = parseConfig(value);
	if (!config) return { success: false, failed: shortcutStatus.failed };
	const conflict = findRecordingShortcutConflict(config);
	if (conflict) return { success: false, conflict, failed: shortcutStatus.failed };

	endKeyCapture?.();
	const failed = applyRecordingShortcuts(config, shortcutHandlers);
	try {
		writeAppSetting(SETTING_KEY, config, { flush: true });
		shortcutStatus = { config, failed };
		return { success: true, failed };
	} catch (error) {
		appLog("error", "recording-shortcuts", "Could not save recording shortcuts.", error);
		const previous = shortcutStatus.config;
		shortcutStatus = { config: previous, failed: applyRecordingShortcuts(previous, shortcutHandlers) };
		return { success: false, failed: shortcutStatus.failed };
	}
}
