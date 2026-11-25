export type ExportPreflightIssue =
	| { kind: "chapters"; status: "draft" | "stale" }
	| { kind: "captionFont"; fontName: string; fallbackName: string }
	| { kind: "keystrokeFont"; fontName: string; fallbackName: string }
	| { kind: "diskSpace"; location: "target" | "temp"; freeBytes: number; neededBytes: number };

export type ExportDiskSpace = { targetFreeBytes: number | null; tempFreeBytes: number | null };

export function collectExportPreflightIssues(input: {
	chapterStatus: "off" | "draft" | "stale" | "ready";
	captionsEnabled: boolean;
	captionFontName: string | null;
	keystrokeFontName?: string | null;
	availableFonts: string[];
	estimatedBytes: number;
} & ExportDiskSpace): ExportPreflightIssue[] {
	const issues: ExportPreflightIssue[] = [];
	if (input.chapterStatus === "draft" || input.chapterStatus === "stale") {
		issues.push({ kind: "chapters", status: input.chapterStatus });
	}
	for (const [kind, fontName] of [
		["captionFont", input.captionsEnabled ? input.captionFontName : null],
		["keystrokeFont", input.keystrokeFontName],
	] as const) {
		if (fontName && !input.availableFonts.some(family => family.toLowerCase() === fontName.toLowerCase())) {
			issues.push({ kind, fontName, fallbackName: "微软雅黑" });
		}
	}
	for (const [location, freeBytes] of [["target", input.targetFreeBytes], ["temp", input.tempFreeBytes]] as const) {
		const neededBytes = input.estimatedBytes * (location === "temp" ? 2.2 : 1.1);
		if (freeBytes !== null && freeBytes < neededBytes) {
			issues.push({ kind: "diskSpace", location, freeBytes, neededBytes });
		}
	}
	return issues;
}
