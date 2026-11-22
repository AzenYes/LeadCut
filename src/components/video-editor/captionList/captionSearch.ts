import { editCaptionCueText, normalizeCaptionEditText } from "../captionEditing";
import type { CaptionCue } from "../types";

type Options = { caseSensitive?: boolean; cueIds?: ReadonlySet<string>; firstOnly?: boolean; matchOffset?: number };

export type CaptionTextMatch = { index: number; length: number };

export function captionTextMatcher(query: string, caseSensitive = false) {
	if (!query) return null;
	return new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), caseSensitive ? "g" : "gi");
}

export function findCaptionTextMatches(text: string, pattern: RegExp): CaptionTextMatch[] {
	return Array.from(text.matchAll(pattern), match => ({ index: match.index, length: match[0].length }));
}

export function replaceInCaptions(cues: CaptionCue[], query: string, replacement: string, options: Options = {}) {
	const pattern = captionTextMatcher(query, options.caseSensitive);
	if (!pattern) return { cues, count: 0 };
	let count = 0;
	const next = cues.map(cue => {
		if (options.firstOnly && count) return cue;
		if (options.cueIds && !options.cueIds.has(cue.id)) return cue;
		let matches = 0;
		const text = normalizeCaptionEditText(cue.text.replace(pattern, (match: string, offset: number) => {
			if (options.matchOffset !== undefined && offset !== options.matchOffset) return match;
			if (options.firstOnly && matches > 0) return match;
			matches++;
			return replacement;
		}));
		if (!matches || !text || text === cue.text) return cue;
		count += matches;
		return editCaptionCueText(cue, text);
	});
	return { cues: count ? next : cues, count };
}
