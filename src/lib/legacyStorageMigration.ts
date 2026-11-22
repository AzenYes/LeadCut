import {
	CUSTOM_FONTS_STORAGE_KEY,
	LEADCUT_STORAGE_KEY_PREFIX,
	LEGACY_CUSTOM_FONTS_KEY,
	LEGACY_STORAGE_KEY_PREFIX,
	OPEN_DASHBOARD_STORAGE_KEY,
} from "./storageKeys";

type MigrationStorage = Pick<Storage, "length" | "key" | "getItem" | "setItem">;

export function migrateLegacyStorageKeys(storage: MigrationStorage) {
	try {
		// A write can change the order returned by Storage.key().
		const keys = Array.from({ length: storage.length }, (_, index) => storage.key(index));
		for (const key of keys) {
			if (key === null) continue;
			let targetKey: string;
			if (key === LEGACY_CUSTOM_FONTS_KEY) {
				targetKey = CUSTOM_FONTS_STORAGE_KEY;
			} else if (key.startsWith(LEGACY_STORAGE_KEY_PREFIX)) {
				targetKey = LEADCUT_STORAGE_KEY_PREFIX + key.slice(LEGACY_STORAGE_KEY_PREFIX.length);
			} else {
				continue;
			}
			if (targetKey === OPEN_DASHBOARD_STORAGE_KEY || storage.getItem(targetKey) !== null) continue;
			const value = storage.getItem(key);
			if (value !== null) storage.setItem(targetKey, value);
		}
	} catch {
		// Some profiles disable localStorage or limit its quota.
	}
}

if (typeof window !== "undefined") {
	try {
		migrateLegacyStorageKeys(window.localStorage);
	} catch {
		// Accessing localStorage itself can fail for a restricted origin.
	}
}
