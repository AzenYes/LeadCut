import { describe, expect, it } from "vitest";
import { filterItemsInRange, normalizeRegionSpan, spansOverlap } from "./spans";

describe("timeline core/spans", () => {
	it("treats adjacent spans as non-overlapping", () => {
		expect(spansOverlap({ start: 0, end: 100 }, { start: 100, end: 200 })).toBe(false);
	});

	it("detects strict overlap and containment", () => {
		expect(spansOverlap({ start: 0, end: 101 }, { start: 100, end: 200 })).toBe(true);
		expect(spansOverlap({ start: 50, end: 150 }, { start: 75, end: 100 })).toBe(true);
	});

	it("keeps crossing, overscan and selected spans in their original order", () => {
		const item = (id: string, start: number, end: number) => ({ id, span: { start, end } });
		const items = [
			item("before", 0, 50),
			item("crossing", 160, 240),
			item("inside", 250, 350),
			item("overscan", 420, 430),
			item("after", 500, 520),
			item("selected", 800, 850),
		];
		expect(filterItemsInRange(items, { start: 200, end: 400 }, 40, new Set(["selected"]))
			.map(result => result.id)).toEqual(["crossing", "inside", "overscan", "selected"]);
	});

	it("filters 1000 timeline items without expensive layout work", () => {
		const items = Array.from({ length: 1000 }, (_, index) => ({
			id: `caption-${index}`,
			span: { start: index * 1000, end: index * 1000 + 500 },
		}));
		const start = performance.now();
		const visible = filterItemsInRange(items, { start: 100000, end: 120000 }, 10000, new Set());
		expect(performance.now() - start).toBeLessThan(5);
		expect(visible).toHaveLength(40);
	});

	it("normalizes region to bounds and enforces min duration", () => {
		expect(
			normalizeRegionSpan({ startMs: -50, endMs: 10, totalMs: 1000, minDurationMs: 100 }),
		).toEqual({ start: 0, end: 100 });
	});

	it("clamps start when requested end exceeds total", () => {
		expect(
			normalizeRegionSpan({ startMs: 980, endMs: 1200, totalMs: 1000, minDurationMs: 100 }),
		).toEqual({ start: 900, end: 1000 });
	});

	it("keeps already valid spans unchanged", () => {
		expect(
			normalizeRegionSpan({ startMs: 100, endMs: 300, totalMs: 1000, minDurationMs: 50 }),
		).toEqual({ start: 100, end: 300 });
	});

	it("never exceeds total when min duration is larger than total", () => {
		expect(
			normalizeRegionSpan({ startMs: 100, endMs: 300, totalMs: 80, minDurationMs: 100 }),
		).toEqual({ start: 0, end: 80 });
	});
});
