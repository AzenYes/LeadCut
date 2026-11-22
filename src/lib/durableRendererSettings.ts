import { loadAppSetting, saveAppSetting } from "./appSettings";

export function readRendererSetting(key: string): string | null {
	const persisted = loadAppSetting<unknown>(key);
	if (typeof persisted === "string") return persisted;
	return globalThis.localStorage?.getItem(key) ?? null;
}

export function writeRendererSetting(key: string, value: string): void {
	const saved = saveAppSetting(key, value);
	try {
		globalThis.localStorage?.setItem(key, value);
	} catch (error) {
		if (!saved) throw error;
	}
}
