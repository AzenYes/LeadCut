export interface EditRange {
	startMs: number;
	endMs: number;
}

/** Overlapping selections remove time once, regardless of how many tracks overlap. */
export function mergeEditRanges(ranges: readonly EditRange[]): EditRange[] {
	const merged: EditRange[] = [];
	for (const range of [...ranges].sort((a, b) => a.startMs - b.startMs)) {
		if (range.endMs <= range.startMs) continue;
		const last = merged[merged.length - 1];
		if (last && range.startMs <= last.endMs) last.endMs = Math.max(last.endMs, range.endMs);
		else merged.push({ startMs: range.startMs, endMs: range.endMs });
	}
	return merged;
}

/** Keep exact surviving pieces and shift them by the discarded time that came before them. */
export function deleteTimelineRanges<T extends EditRange & { id: string }>(
	regions: readonly T[],
	ranges: readonly EditRange[],
	trim: (region: T, startMs: number, endMs: number) => T = (region) => region,
	createId: (region: T) => string = () => `region-${crypto.randomUUID()}`,
): T[] {
	const cuts = mergeEditRanges(ranges);
	const mapTime = (time: number) =>
		time -
		cuts.reduce((sum, cut) => sum + Math.max(0, Math.min(time, cut.endMs) - cut.startMs), 0);
	return regions.flatMap((region) => {
		let cursor = region.startMs;
		const pieces: EditRange[] = [];
		for (const cut of cuts) {
			if (cut.endMs <= cursor || cut.startMs >= region.endMs) continue;
			if (cut.startMs > cursor) pieces.push({ startMs: cursor, endMs: cut.startMs });
			cursor = Math.max(cursor, cut.endMs);
		}
		if (cursor < region.endMs) pieces.push({ startMs: cursor, endMs: region.endMs });
		return pieces.map((piece, index) => {
			const startMs = mapTime(piece.startMs);
			const endMs = mapTime(piece.endMs);
			if (startMs === region.startMs && endMs === region.endMs) return region;
			return {
				...trim(region, piece.startMs, piece.endMs),
				id: index ? createId(region) : region.id,
				startMs,
				endMs,
			};
		});
	});
}
