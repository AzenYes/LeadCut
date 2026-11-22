import { describe, expect, it, vi } from "vitest";
import { migrateLegacyStorageKeys } from "./legacyStorageMigration";
import { CUSTOM_FONTS_STORAGE_KEY, LEGACY_CUSTOM_FONTS_KEY, LOCALE_STORAGE_KEY, OPEN_DASHBOARD_STORAGE_KEY, THEME_STORAGE_KEY } from "./storageKeys";

function makeStorage(initial: Record<string, string>) {
	const values = new Map(Object.entries(initial));
	const storage = {
		get length() { return values.size; },
		key: (index: number) => [...values.keys()][index] ?? null,
		getItem: (key: string) => values.get(key) ?? null,
		setItem: vi.fn((key: string, value: string) => { values.set(key, value); }),
	};
	return { storage, values };
}

describe("migrateLegacyStorageKeys", () => {
	it("copies preferences and custom fonts without deleting or overwriting stored settings", () => {
		const { storage, values } = makeStorage({
			"recordly.theme": "dark",
			"recordly.locale": "en",
			"recordly.open-dashboard": "old-request",
			[LOCALE_STORAGE_KEY]: "",
			[LEGACY_CUSTOM_FONTS_KEY]: '["font"]',
			other: "unchanged",
		});

		migrateLegacyStorageKeys(storage);
		expect(values.get(THEME_STORAGE_KEY)).toBe("dark");
		expect(values.get("recordly.theme")).toBe("dark");
		expect(values.get(LOCALE_STORAGE_KEY)).toBe("");
		expect(values.get(CUSTOM_FONTS_STORAGE_KEY)).toBe('["font"]');
		expect(values.get(LEGACY_CUSTOM_FONTS_KEY)).toBe('["font"]');
		expect(values.has(OPEN_DASHBOARD_STORAGE_KEY)).toBe(false);
		expect(values.has("leadcut.other")).toBe(false);
		expect(storage.setItem).toHaveBeenCalledTimes(2);

		migrateLegacyStorageKeys(storage);
		expect(storage.setItem).toHaveBeenCalledTimes(2);
	});

	it("continues startup when storage is blocked or full", () => {
		const { storage } = makeStorage({ "recordly.theme": "dark" });
		storage.setItem.mockImplementation(() => { throw new Error("Quota exceeded"); });
		expect(() => migrateLegacyStorageKeys(storage)).not.toThrow();
		vi.spyOn(storage, "length", "get").mockImplementation(() => { throw new Error("Access denied"); });
		expect(() => migrateLegacyStorageKeys(storage)).not.toThrow();
	});
});
