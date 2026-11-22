import { describe, expect, it } from "vitest";
import { normalizeProjectEditor } from "../projectPersistence";
import { hasNonDefaultSourceTrackSettings } from "@/lib/exporter/audioProcessorShared";
import {
	getAudibleSourceAudioRanges,
	isSourceAudioDeleted,
	normalizeSourceAudioDeletedRanges,
} from "./sourceAudioEdits";

describe("source audio deletions", () => {
	it("merges repeated, overlapping and adjacent deletions and rejects invalid intervals", () => {
		expect(
			normalizeSourceAudioDeletedRanges([
				{ startMs: 10, endMs: 30 },
				{ startMs: 0, endMs: 10 },
				{ startMs: 20, endMs: 40 },
				{ startMs: 50, endMs: 50 },
				{ startMs: NaN, endMs: 60 },
			]),
		).toEqual([{ startMs: 0, endMs: 40 }]);
	});
	it("keeps audible source positions and handles a fully deleted segment", () => {
		const span = { startMs: 100, endMs: 600 };
		expect(getAudibleSourceAudioRanges(span, [{ startMs: 200, endMs: 400 }])).toEqual([
			{ startMs: 100, endMs: 200 },
			{ startMs: 400, endMs: 600 },
		]);
		expect(getAudibleSourceAudioRanges(span, [{ startMs: 0, endMs: 1000 }])).toEqual([]);
	});
	it("preserves deletions through project normalization and forces audio rendering", () => {
		const settings = {
			system: { volume: 1, normalize: false, deletedRanges: [{ startMs: 200, endMs: 400 }] },
		};
		const restored = normalizeProjectEditor(
			JSON.parse(JSON.stringify({ sourceAudioTrackSettingsByClip: { clip: settings } })),
		);
		expect(restored.sourceAudioTrackSettingsByClip?.clip).toEqual(settings);
		expect(hasNonDefaultSourceTrackSettings(settings)).toBe(true);
		expect(isSourceAudioDeleted(settings.system, 200)).toBe(true);
		expect(isSourceAudioDeleted(settings.system, 400)).toBe(false);
		expect(isSourceAudioDeleted(undefined, 300)).toBe(false);
	});
});
