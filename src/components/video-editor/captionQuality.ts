export const CAPTION_ISSUE_KINDS = ["tooWide", "tooShort", "tooLong", "overlap", "empty", "trailingPunctuation"] as const;
export type CaptionIssueKind = (typeof CAPTION_ISSUE_KINDS)[number];

export interface CaptionQualityRules {
	enabled: Record<CaptionIssueKind, boolean>;
	minDurationMs: number;
	maxDurationMs: number;
}

export const DEFAULT_CAPTION_QUALITY_RULES: CaptionQualityRules = {
	enabled: { tooWide: true, tooShort: true, tooLong: true, overlap: true, empty: true, trailingPunctuation: true },
	minDurationMs: 300,
	maxDurationMs: 7000,
};

export const CAPTION_QUALITY_SETTINGS_KEY = "leadcut.captions.qualityRules.v1";

export function normalizeCaptionQualityRules(value: unknown): CaptionQualityRules {
	const defaults = DEFAULT_CAPTION_QUALITY_RULES;
	if (!value || typeof value !== "object") return defaults;
	const stored = value as Partial<CaptionQualityRules>;
	const duration = (amount: unknown, fallback: number) =>
		typeof amount === "number" && Number.isFinite(amount) ? Math.max(0, Math.round(amount)) : fallback;
	const minDurationMs = duration(stored.minDurationMs, defaults.minDurationMs);
	const enabled = { ...defaults.enabled };
	for (const kind of CAPTION_ISSUE_KINDS) {
		const flag = stored.enabled?.[kind];
		if (typeof flag === "boolean") enabled[kind] = flag;
	}
	return {
		enabled,
		minDurationMs,
		maxDurationMs: Math.max(minDurationMs, duration(stored.maxDurationMs, defaults.maxDurationMs)),
	};
}

export function checkCaptions(
	rows: readonly { id: string; startMs: number; endMs: number; text: string }[],
	rules: CaptionQualityRules,
	measure: (text: string) => number,
	maxWidthPx: number,
): Map<string, CaptionIssueKind[]> {
	const issues = new Map<string, CaptionIssueKind[]>();
	const ordered = [...rows].sort((left, right) => left.startMs - right.startMs);
	for (let index = 0; index < ordered.length; index++) {
		const row = ordered[index];
		const previous = ordered[index - 1];
		const next = ordered[index + 1];
		const text = row.text.trim();
		const duration = row.endMs - row.startMs;
		const found: CaptionIssueKind[] = [];
		if (rules.enabled.tooWide && text.length > 0 && measure(text) > maxWidthPx) found.push("tooWide");
		if (rules.enabled.tooShort && duration < rules.minDurationMs) found.push("tooShort");
		if (rules.enabled.tooLong && duration > rules.maxDurationMs) found.push("tooLong");
		if (rules.enabled.overlap && ((previous && previous.endMs > row.startMs) || (next && row.endMs > next.startMs))) found.push("overlap");
		if (rules.enabled.empty && !text) found.push("empty");
		if (rules.enabled.trailingPunctuation && /[，。、；：！？,.;:!?…]$/u.test(text)) found.push("trailingPunctuation");
		if (found.length > 0) issues.set(row.id, found);
	}
	return issues;
}
