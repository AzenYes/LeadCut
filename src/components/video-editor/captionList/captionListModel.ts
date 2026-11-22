import type { projectCaptionCues } from "../captionTimeline";

export function findActiveRowIndex(rows: readonly { startMs: number; endMs: number }[], timeMs: number) {
	let low = 0;
	let high = rows.length;
	while (low < high) {
		const mid = (low + high) >>> 1;
		if (rows[mid].startMs <= timeMs) low = mid + 1;
		else high = mid;
	}
	const index = low - 1;
	return index >= 0 && timeMs < rows[index].endMs ? index : -1;
}

export type CaptionFragment = ReturnType<typeof projectCaptionCues>[number];
export type CaptionTranscriptRow = CaptionFragment & {
	fragments: CaptionFragment[];
	number: number;
};

const ESTIMATED_ROW_HEIGHT = 58;
const OVERSCAN_PX = 280;

export function captionRowOffsets(rows: readonly CaptionTranscriptRow[], measured: ReadonlyMap<string, number>) {
	const offsets = [0];
	for (const row of rows) offsets.push(offsets[offsets.length - 1] + (measured.get(row.id) ?? ESTIMATED_ROW_HEIGHT));
	return offsets;
}

export function captionWindowRange(offsets: readonly number[], scrollTop: number, viewportHeight: number) {
	const length = offsets.length - 1;
	const findRow = (position: number) => {
		let low = 0;
		let high = length;
		while (low < high) {
			const mid = (low + high) >>> 1;
			if (offsets[mid + 1] <= position) low = mid + 1;
			else high = mid;
		}
		return low;
	};
	const start = findRow(Math.max(0, scrollTop - OVERSCAN_PX));
	const end = Math.min(length, findRow(scrollTop + viewportHeight + OVERSCAN_PX) + 1);
	return { start, end };
}

export function groupCaptionRows(fragments: readonly CaptionFragment[]): CaptionTranscriptRow[] {
	const grouped = new Map<string, CaptionTranscriptRow>();
	for (const fragment of fragments) {
		const existing = grouped.get(fragment.sourceCueId);
		if (existing) {
			existing.fragments.push(fragment);
			existing.endMs = Math.max(existing.endMs, fragment.endMs);
		} else {
			grouped.set(fragment.sourceCueId, {
				...fragment, id: fragment.sourceCueId, fragments: [fragment], number: grouped.size + 1,
			});
		}
	}
	return [...grouped.values()];
}

export function formatCaptionTime(timeMs: number) {
	const tenth = Math.round(Math.max(0, timeMs) / 100);
	const minutes = Math.floor(tenth / 600);
	const seconds = (tenth % 600 / 10).toFixed(1).padStart(4, "0");
	if (minutes < 60) return `${minutes}:${seconds}`;
	return `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, "0")}:${seconds}`;
}

