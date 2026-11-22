import { expect, it } from "vitest";
import { normalizeExportPreferences, normalizeExportQuality } from "./exportPreferences";

it("migrates the legacy quality levels and preserves each resolution tier", () => {
	for (const value of ["medium", "good", "high"]) expect(normalizeExportQuality(value)).toBe("1080p");
	for (const value of ["1080p", "1440p", "2160p", "source"]) expect(normalizeExportQuality(value)).toBe(value);
	for (const value of ["4K", undefined, null, true, {}]) expect(normalizeExportQuality(value)).toBe("source");
});

it("uses automatic bitrate by default and clamps persisted manual rates", () => {
	expect(normalizeExportPreferences({}).exportBitrateMbps).toBeNull();
	expect(normalizeExportPreferences({ exportBitrateMbps: 10.5 }).exportBitrateMbps).toBe(10.5);
	expect(normalizeExportPreferences({ exportBitrateMbps: 1000 }).exportBitrateMbps).toBe(100);
	expect(normalizeExportPreferences({ exportBitrateMbps: NaN }).exportBitrateMbps).toBeNull();
});
