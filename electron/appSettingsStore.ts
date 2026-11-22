import { randomUUID } from "node:crypto";
import { readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { LEADCUT_STORAGE_KEY_PREFIX, LEGACY_STORAGE_KEY_PREFIX } from "../src/lib/storageKeys";
import { APP_SETTINGS_FILE } from "./ipc/constants";
import { parseJsonWithByteOrderMark } from "./ipc/utils";
import { appLog } from "./logger";

const SAVE_DELAY_MS = 300;
const WRITE_OPTIONS = { encoding: "utf8", flag: "wx" } as const;
let cachedSettings: Record<string, unknown> | undefined;
let pendingSave: ReturnType<typeof setTimeout> | undefined;
let settingsRevision = 0;
let savedRevision = 0;
let writesAllowed = true;

export function hasAppSetting(store: Record<string, unknown>, key: string): boolean {
	return Reflect.getOwnPropertyDescriptor(store, key) !== undefined;
}

function loadSettings(): Record<string, unknown> {
	try {
		const parsed = parseJsonWithByteOrderMark<unknown>(readFileSync(APP_SETTINGS_FILE, "utf8"));
		if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new SyntaxError("Invalid settings object");
		return parsed as Record<string, unknown>;
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return {};
		if (!(error instanceof SyntaxError)) {
			writesAllowed = false;
			appLog("error", "settings", "Could not read application settings.", error);
			return {};
		}
		const archive = path.join(path.dirname(APP_SETTINGS_FILE), `app-settings.损坏-${Date.now()}.json`);
		try {
			renameSync(APP_SETTINGS_FILE, archive);
			appLog("warn", "settings", "Archived application settings with invalid JSON.", archive);
		} catch (archiveError) {
			writesAllowed = false;
			appLog("error", "settings", "Could not preserve invalid application settings.", archiveError);
		}
		return {};
	}
}

function getSettings(): Record<string, unknown> {
	if (cachedSettings) return cachedSettings;
	const store = { ...loadSettings() };
	cachedSettings = store;
	for (const [key, value] of Object.entries(store)) {
		if (!key.startsWith(LEGACY_STORAGE_KEY_PREFIX)) continue;
		const targetKey = LEADCUT_STORAGE_KEY_PREFIX + key.slice(LEGACY_STORAGE_KEY_PREFIX.length);
		if (hasAppSetting(store, targetKey)) continue;
		store[targetKey] = value;
		settingsRevision++;
	}
	if (settingsRevision !== savedRevision) scheduleSave();
	return store;
}

async function saveSettings() {
	if (!writesAllowed || !cachedSettings || savedRevision === settingsRevision) return;
	const revision = settingsRevision;
	const temporary = `${APP_SETTINGS_FILE}.${randomUUID()}.tmp`;
	try {
		await fs.writeFile(temporary, JSON.stringify(cachedSettings, null, 2), WRITE_OPTIONS);
		if (revision !== settingsRevision || revision <= savedRevision) return;
		// Commit and advance the revision in one turn so a quit or immediate save cannot race an older rename.
		renameSync(temporary, APP_SETTINGS_FILE);
		savedRevision = revision;
	} catch (error) {
		appLog("error", "settings", "Could not write application settings.", error);
	} finally {
		await fs.rm(temporary, { force: true }).catch(() => undefined);
	}
}

function scheduleSave() {
	clearTimeout(pendingSave);
	pendingSave = setTimeout(() => {
		pendingSave = undefined;
		void saveSettings();
	}, SAVE_DELAY_MS);
}

export function flushAppSettingsSync() {
	clearTimeout(pendingSave);
	pendingSave = undefined;
	if (!writesAllowed || !cachedSettings || savedRevision === settingsRevision) return;
	const temporary = `${APP_SETTINGS_FILE}.${randomUUID()}.tmp`;
	try {
		writeFileSync(temporary, JSON.stringify(cachedSettings, null, 2), WRITE_OPTIONS);
		renameSync(temporary, APP_SETTINGS_FILE);
		savedRevision = settingsRevision;
	} catch (error) {
		try { rmSync(temporary, { force: true }); } catch { /* Preserve the write error in the log. */ }
		appLog("error", "settings", "Could not flush application settings.", error);
		throw error;
	}
}

export function migrateLegacyAppSettingKeys() {
	getSettings();
	flushAppSettingsSync();
}

export function readAppSettingsStore(): Record<string, unknown> {
	return { ...getSettings() };
}

export function writeAppSettingsStore(store: Record<string, unknown>) {
	const previous = getSettings();
	if (!writesAllowed) throw new Error("Application settings could not be safely read.");
	cachedSettings = { ...store };
	settingsRevision++;
	try {
		flushAppSettingsSync();
	} catch (error) {
		cachedSettings = previous;
		settingsRevision++;
		scheduleSave();
		throw error;
	}
}

export function readAppSetting(key: string): unknown {
	const store = getSettings();
	return hasAppSetting(store, key) ? store[key] : null;
}

export function writeAppSetting(key: string, value: unknown, options: { flush?: boolean } = {}) {
	const store = getSettings();
	if (options.flush && !writesAllowed) throw new Error("Application settings could not be safely read.");
	const before = Object.getOwnPropertyDescriptor(store, key);
	const changed = !before || !Object.is(before.value, value);
	if (changed) {
		Object.defineProperty(store, key, { value, writable: true, enumerable: true, configurable: true });
		settingsRevision++;
	}
	if (!options.flush) {
		if (settingsRevision !== savedRevision) scheduleSave();
		return;
	}
	try {
		flushAppSettingsSync();
	} catch (error) {
		if (changed) {
			if (before) Object.defineProperty(store, key, before);
			else delete store[key];
			settingsRevision++;
		}
		scheduleSave();
		throw error;
	}
}
