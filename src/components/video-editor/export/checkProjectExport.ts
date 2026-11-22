import { getCustomFonts } from "@/lib/customFonts";
import { fontFamilyDisplayName, listLocalFontFamilies } from "@/lib/localFonts";
import { chapterProgressStatus } from "../chapterProgress";
import type { useTimelineState } from "../state/useTimelineState";
import { getDefaultCaptionFontFamily } from "../types";
import { collectExportPreflightIssues } from "./exportPreflight";

let localFonts: Promise<string[] | null> | undefined;

export async function checkProjectExport(timeline: ReturnType<typeof useTimelineState>) {
	const captionsEnabled = timeline.autoCaptionSettings.enabled && timeline.autoCaptions.some(cue => cue.text.trim());
	const family = timeline.autoCaptionSettings.fontFamily;
	const captionFontName = captionsEnabled && family && family !== getDefaultCaptionFontFamily()
		? fontFamilyDisplayName(family) : null;
	const keystrokeFontName = timeline.recordedKeystrokes.presentation
		? fontFamilyDisplayName(timeline.keystrokeOverlay.style.fontFamily) : null;
	const customFamilies = getCustomFonts().map(font => fontFamilyDisplayName(font.fontFamily));
	const needsLocalFonts = [captionFontName, keystrokeFontName].some(name =>
		name && !customFamilies.some(family => family.toLowerCase() === name.toLowerCase()),
	);
	let availableFonts: string[] | null = customFamilies;
	if (needsLocalFonts) {
		localFonts ??= listLocalFontFamilies().catch(() => null);
		const families = await localFonts;
		availableFonts = families ? [...families, ...customFamilies] : null;
	}
	return collectExportPreflightIssues({
		chapterStatus: chapterProgressStatus(timeline.chapterProgress, timeline),
		captionsEnabled, captionFontName: availableFonts ? captionFontName : null,
		keystrokeFontName: availableFonts ? keystrokeFontName : null, availableFonts: availableFonts ?? [],
		estimatedBytes: 0, targetFreeBytes: null, tempFreeBytes: null,
	});
}
