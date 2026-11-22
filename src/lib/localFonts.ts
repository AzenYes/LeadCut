type LocalFontWindow = Window & {
	queryLocalFonts?: () => Promise<Array<{ family: string }>>;
};

export async function listLocalFontFamilies(): Promise<string[]> {
	const fontWindow = window as LocalFontWindow;
	if (!fontWindow.queryLocalFonts) throw new Error("Local font access is unavailable");
	const fonts = await fontWindow.queryLocalFonts();
	return [...new Set(fonts.map((font) => font.family.trim()).filter(Boolean))].sort((a, b) =>
		a.localeCompare(b),
	);
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
