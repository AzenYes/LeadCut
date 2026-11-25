import { describe, expect, it } from "vitest";
import { collectExportPreflightIssues } from "./exportPreflight";

const defaults = {
	chapterStatus: "ready",
	captionsEnabled: true,
	captionFontName: "Arial",
	availableFonts: ["arial", "Microsoft YaHei"],
	estimatedBytes: 100 / 1.1,
	targetFreeBytes: 100,
	tempFreeBytes: 200,
} as const;

function collect(overrides: Partial<Parameters<typeof collectExportPreflightIssues>[0]> = {}) {
	return collectExportPreflightIssues({ ...defaults, availableFonts: [...defaults.availableFonts], ...overrides });
}

describe("collectExportPreflightIssues", () => {
	it.each(["draft", "stale"] as const)("flags %s chapters", (status) => {
		expect(collect({ chapterStatus: status })).toEqual([{ kind: "chapters", status }]);
	});

	it.each(["off", "ready"] as const)("passes with chapters %s and room for the export", (chapterStatus) => {
		expect(collect({ chapterStatus })).toEqual([]);
	});

	it("warns only when an enabled caption uses an unavailable font", () => {
		expect(collect({ captionFontName: "Absent" })).toEqual([
			{ kind: "captionFont", fontName: "Absent", fallbackName: "微软雅黑" },
		]);
		expect(collect({ captionFontName: "Absent", captionsEnabled: false })).toEqual([]);
	});

	it("reports an unavailable keystroke font with the fallback", () => {
		expect(collect({ keystrokeFontName: "Missing keystroke font", captionsEnabled: false })).toEqual([
			{ kind: "keystrokeFont", fontName: "Missing keystroke font", fallbackName: "微软雅黑" },
		]);
		expect(collect({ keystrokeFontName: "ARIAL" })).toEqual([]);
	});

	it("identifies each volume with inadequate space and skips an unmeasurable volume", () => {
		expect(collect({ targetFreeBytes: 99, tempFreeBytes: null })).toEqual([
			{ kind: "diskSpace", location: "target", freeBytes: 99, neededBytes: 100 },
		]);
		expect(collect({ targetFreeBytes: null, tempFreeBytes: 5 })).toEqual([
			{ kind: "diskSpace", location: "temp", freeBytes: 5, neededBytes: 200 },
		]);
	});
});
