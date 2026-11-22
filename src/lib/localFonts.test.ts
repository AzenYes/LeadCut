import { afterEach, expect, it, vi } from "vitest";
import { fontFamilyDisplayName, listLocalFontFamilies, localFontCssFamily } from "./localFonts";
afterEach(() => vi.unstubAllGlobals());
it("lists actual local families once even when multiple weights are installed", async () => {
	vi.stubGlobal("window", {
		queryLocalFonts: async () => [
			{ family: "微软雅黑" },
			{ family: "Arial" },
			{ family: "Arial" },
			{ family: " " },
		],
	});
	expect(await listLocalFontFamilies()).toEqual(
		["Arial", "微软雅黑"].sort((a, b) => a.localeCompare(b)),
	);
});
it("does not silently replace denied access with a hardcoded list", async () => {
	vi.stubGlobal("window", {
		queryLocalFonts: async () => {
			throw new Error("denied");
		},
	});
	await expect(listLocalFontFamilies()).rejects.toThrow("denied");
});
it("quotes a font name containing a comma as a single family", () => {
	expect(localFontCssFamily('Font, "Custom"')).toBe('"Font, \\"Custom\\""');
});

it("shows a readable family name while preserving quoted commas and escaped quotes", () => {
	expect(fontFamilyDisplayName('"SF Pro Text", "SF Pro Display", sans-serif')).toBe(
		"SF Pro Text",
	);
	expect(fontFamilyDisplayName(localFontCssFamily('Font, "Custom"'))).toBe('Font, "Custom"');
	expect(fontFamilyDisplayName("Microsoft YaHei, sans-serif")).toBe("Microsoft YaHei");
	expect(fontFamilyDisplayName("'IBM Plex Sans SC', sans-serif")).toBe("IBM Plex Sans SC");
});
