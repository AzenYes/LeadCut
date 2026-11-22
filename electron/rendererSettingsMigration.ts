import fs from "node:fs/promises";
import path from "node:path";
import { WebContentsView, type Session } from "electron";
import {
	CUSTOM_FONTS_STORAGE_KEY, DURABLE_RENDERER_STORAGE_KEYS, LEADCUT_STORAGE_KEY_PREFIX,
	LEGACY_CUSTOM_FONTS_KEY, LEGACY_STORAGE_KEY_PREFIX,
} from "../src/lib/storageKeys";
import { hasAppSetting, readAppSettingsStore, writeAppSettingsStore } from "./appSettingsStore";

const IMPORTED_KEY = "leadcut.renderer-settings-import.v1";

async function findLegacyOrigins(sessionPath: string) {
	const directory = path.join(sessionPath, "Local Storage", "leveldb");
	const files = await fs.readdir(directory).catch(() => []);
	const origins = new Set<string>();
	// Look for old loopback origins only. Chromium reads and validates their stored values.
	for (const file of files.filter(name => /^\d+\.(?:log|ldb)$/.test(name)).sort().reverse()) {
		const bytes = await fs.readFile(path.join(directory, file)).catch(() => null);
		if (!bytes) continue;
		const matches = [...bytes.toString("latin1").matchAll(/(?:META(?:ACCESS)?:|_)http:\/\/127\.0\.0\.1:(\d{1,5})(?!\d)/g)];
		for (const match of matches.reverse()) {
			const port = Number(match[1]);
			if (port > 0 && port <= 65535) origins.add(`http://127.0.0.1:${port}/`);
		}
	}
	return [...origins];
}

export async function migratePackagedRendererSettings(browserSession: Session, sessionPath: string) {
	const settings = readAppSettingsStore();
	if (settings[IMPORTED_KEY] === true) return;
	const legacyOrigins = await findLegacyOrigins(sessionPath);
	const pending = DURABLE_RENDERER_STORAGE_KEYS.filter(key => !hasAppSetting(settings, key));
	const recovered: Record<string, string> = {};
	if (pending.length && legacyOrigins.length) {
		const keys = pending.map(key => [
			key,
			key === CUSTOM_FONTS_STORAGE_KEY
				? [key, LEGACY_CUSTOM_FONTS_KEY, "openscreen_custom_fonts"]
				: [key, LEGACY_STORAGE_KEY_PREFIX + key.slice(LEADCUT_STORAGE_KEY_PREFIX.length)],
		]);
		const readStoredValues = `((keys) => Object.fromEntries(keys.map(([target, sources]) => [
			target, sources.map(key => localStorage.getItem(key)).find(value => value !== null) ?? null
		])))(${JSON.stringify(keys)})`;
		const view = new WebContentsView({ webPreferences: { session: browserSession } });
		let allowedUrl: string | null = null;
		try {
			// Supply an empty document ourselves. The old port may belong to another process now.
			browserSession.protocol.handle("http", request => request.url === allowedUrl
				? new Response("<title>LeadCut preferences</title>", { headers: { "Content-Type": "text/html" } })
				: new Response(null, { status: 404 }));
			for (const origin of legacyOrigins) {
				allowedUrl = origin;
				await view.webContents.loadURL(origin);
				const inOrigin = await view.webContents.executeJavaScript(readStoredValues) as Record<string, unknown>;
				for (const key of pending) {
					const value = inOrigin[key];
					if (!hasAppSetting(recovered, key) && typeof value === "string") recovered[key] = value;
				}
				if (pending.every(key => hasAppSetting(recovered, key))) break;
			}
		} finally {
			view.webContents.close();
			browserSession.protocol.unhandle("http");
		}
	}
	const latest = readAppSettingsStore();
	for (const [key, value] of Object.entries(recovered)) {
		if (!hasAppSetting(latest, key)) latest[key] = value;
	}
	latest[IMPORTED_KEY] = true;
	writeAppSettingsStore(latest);
}
