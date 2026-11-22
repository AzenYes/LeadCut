type LocalFontWindow = Window & {
	queryLocalFonts?: () => Promise<Array<{ family: string }>>;
};

const CATALOG_LIFETIME_MS = 60_000;
const catalogs = new WeakMap<
	Window,
	{
		families?: string[];
		expiresAt: number;
		pending?: Promise<string[]>;
	}
>();

export function getCachedLocalFontFamilies(): string[] | undefined {
	return catalogs.get(window)?.families;
}

async function readFontFamilies(fontWindow: LocalFontWindow, refresh: boolean): Promise<string[]> {
	if (fontWindow.electronAPI?.listLocalFontFamilies) {
		return fontWindow.electronAPI.listLocalFontFamilies(refresh);
	}
	if (!fontWindow.queryLocalFonts) throw new Error("Local font access is unavailable");
	return (await fontWindow.queryLocalFonts()).map((font) => font.family);
}

export function listLocalFontFamilies(refresh = false): Promise<string[]> {
	const fontWindow = window as LocalFontWindow;
	let catalog = catalogs.get(fontWindow);
	if (!catalog) {
		catalog = { expiresAt: 0 };
		catalogs.set(fontWindow, catalog);
	}
	if (catalog.pending) return catalog.pending;
	if (!refresh && catalog.families && Date.now() < catalog.expiresAt) {
		return Promise.resolve(catalog.families);
	}
	const entry = catalog;
	entry.pending = readFontFamilies(fontWindow, refresh)
		.then((families) => {
			const sorted = [...new Set(families.map((name) => name.trim()).filter(Boolean))].sort(
				(a, b) => a.localeCompare(b),
			);
			if (
				entry.families?.length !== sorted.length ||
				sorted.some((name, index) => entry.families?.[index] !== name)
			) {
				entry.families = sorted;
			}
			entry.expiresAt = Date.now() + CATALOG_LIFETIME_MS;
			return entry.families ?? sorted;
		})
		.finally(() => {
			entry.pending = undefined;
		});
	return entry.pending;
}

/** A family may contain commas or quotes; always treat it as one CSS family. */
export function localFontCssFamily(family: string): string {
	return `"${family.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

/** Show the first family name, without exposing a CSS fallback stack. */
export function fontFamilyDisplayName(value: string): string {
	const family = value.trim();
	const quoted = family.match(/^(?:"((?:\\.|[^"\\])*)"|'((?:\\.|[^'\\])*)')/);
	return quoted ? (quoted[1] ?? quoted[2]).replace(/\\(.)/g, "$1") : family.split(",")[0].trim();
}
