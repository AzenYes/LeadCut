import { describe, expect, it } from "vitest";
import {
	deleteTimelineCaptionRanges,
	deleteTimelineRanges,
	getCaptionWordCutRange,
	mergeEditRanges,
	planRippleDelete,
	splitTimelineCaptions,
	timelineRangesToSourceRanges,
} from "./sequenceEdits";
import { projectCaptionCues } from "./captionTimeline";
import type { CaptionCue, ClipRegion } from "./types";
import type { VideoRegion } from "./videoTracks";

describe("sequence time deletion", () => {
	it("plans the same ripple cut across all unlocked tracks and keeps the source audio settings", () => {
		const broll: VideoRegion = {
			id: "broll", trackId: "visual", sourcePath: "broll.mp4", sourceDurationMs: 12000,
			sourceStartMs: 500, startMs: 1000, endMs: 5800, speed: 1.5, volume: 1,
		};
		const locked = { ...broll, id: "locked", trackId: "locked-visual" };
		const settings = { microphone: { volume: 0.4 } };
		const original = {
			clipRegions: [{ id: "clip", startMs: 0, endMs: 6000, sourceStartMs: 1000, speed: 2 }],
			videoTracks: [
				{ id: "visual", name: "B-roll", kind: "video" as const },
				{ id: "locked-visual", name: "Locked", kind: "video" as const, locked: true },
			],
			videoRegions: [broll, locked],
			audioRegions: [{ id: "sound", audioPath: "sound.wav", sourceStartMs: 300, startMs: 1750, endMs: 4500, volume: 1 }],
			annotationRegions: [],
			zoomRegions: [{ id: "zoom", startMs: 3800, endMs: 5000, focus: { cx: 0.5, cy: 0.5 }, depth: 2 as const }],
			autoCaptions: [{ id: "cue", text: "after", timeBasis: "timeline" as const, startMs: 4000, endMs: 4500 }],
			sourceAudioTrackSettingsByClip: { clip: settings },
		};
		const cut = planRippleDelete(original, [{ startMs: 2000, endMs: 3500 }], () => "split-clip");
		expect(cut.clipRegions).toEqual([
			{ id: "clip", startMs: 0, endMs: 2000, sourceStartMs: 1000, speed: 2 },
			{ id: "split-clip", startMs: 2000, endMs: 4500, sourceStartMs: 8000, speed: 2 },
		]);
		expect(cut.sourceAudioTrackSettingsByClip["split-clip"]).toEqual(settings);
		expect(cut.videoRegions).toMatchObject([
			{ id: "broll", startMs: 1000, endMs: 2000, sourceStartMs: 500 },
			{ startMs: 2000, endMs: 4300, sourceStartMs: 4250 },
			locked,
		]);
		expect(cut.videoRegions[2]).toBe(locked);
		expect(cut.audioRegions).toMatchObject([
			{ id: "sound", startMs: 1750, endMs: 2000, sourceStartMs: 300 },
			{ startMs: 2000, endMs: 3000, sourceStartMs: 2050 },
		]);
		expect(cut.zoomRegions).toMatchObject([{ id: "zoom", startMs: 2300, endMs: 3500 }]);
		expect(cut.autoCaptions).toMatchObject([{ id: "cue", startMs: 2500, endMs: 3000 }]);
	});
	it("maps a single cut across clip bounds and respects faster source playback", () => {
		const clips = [
			{ id: "slow", startMs: 0, endMs: 1000, sourceStartMs: 100, speed: 1 },
			{ id: "fast", startMs: 1000, endMs: 2000, sourceStartMs: 3500, speed: 2 },
		];
		expect(timelineRangesToSourceRanges([{ startMs: 800, endMs: 1300 }], clips)).toEqual([
			{ rangeIndex: 0, sourceStartMs: 900, sourceEndMs: 1100, speed: 1, durationMs: 200, timelineStartMs: 800, timelineEndMs: 1000 },
			{ rangeIndex: 0, sourceStartMs: 3500, sourceEndMs: 4100, speed: 2, durationMs: 300, timelineStartMs: 1000, timelineEndMs: 1300 },
		]);
	});
	it("merges overlapping track selections without removing time twice", () => {
		expect(
			mergeEditRanges([
				{ startMs: 2, endMs: 5 },
				{ startMs: 1, endMs: 3 },
				{ startMs: 5, endMs: 6 },
			]),
		).toEqual([{ startMs: 1, endMs: 6 }]);
	});
	it("preserves the prefix, removes covered regions, and moves later content by only the deleted duration", () => {
		const before = { id: "before", startMs: 0, endMs: 1000 };
		const result = deleteTimelineRanges(
			[
				before,
				{ id: "deleted", startMs: 2000, endMs: 3000 },
				{ id: "after", startMs: 6000, endMs: 9000 },
			],
			[{ startMs: 2000, endMs: 4000 }],
		);
		expect(result).toEqual([before, { id: "after", startMs: 4000, endMs: 7000 }]);
		expect(result[0]).toBe(before);
	});
	it("cuts spanning media and preserves the source in-point at non-unit speed", () => {
		const result = deleteTimelineRanges(
			[{ id: "audio", startMs: 0, endMs: 10000, sourceStartMs: 500, speed: 2 }],
			[
				{ startMs: 2000, endMs: 4000 },
				{ startMs: 6000, endMs: 7000 },
			],
			(region, startMs) => ({
				...region,
				sourceStartMs: region.sourceStartMs + (startMs - region.startMs) * region.speed,
			}),
			() => "part",
		);
		expect(
			result.map(({ startMs, endMs, sourceStartMs }) => ({ startMs, endMs, sourceStartMs })),
		).toEqual([
			{ startMs: 0, endMs: 2000, sourceStartMs: 500 },
			{ startMs: 2000, endMs: 4000, sourceStartMs: 8500 },
			{ startMs: 4000, endMs: 7000, sourceStartMs: 14500 },
		]);
	});
});

describe("caption sequence edits", () => {
	const clip: ClipRegion = { id: "clip", startMs: 0, endMs: 6000, sourceStartMs: 0, speed: 1 };
	it("maps a selected word to its occurrence plus padding on either caption clock", () => {
		const cue: CaptionCue = {
			id: "timed", text: "well well end", startMs: 1000, endMs: 3000,
			words: [
				{ text: "well", startMs: 1000, endMs: 1400 },
				{ text: "well", startMs: 1750, endMs: 2150, leadingSpace: true },
				{ text: "end", startMs: 2250, endMs: 2600, leadingSpace: true },
			],
		};
		const [source] = projectCaptionCues([cue], [{ ...clip, startMs: 500, endMs: 1500, sourceStartMs: 1000, speed: 2 }]);
		expect(getCaptionWordCutRange(source, 5, 9, 6000)).toEqual({ startMs: 835, endMs: 1115 });
		const [sequence] = projectCaptionCues([{ ...cue, timeBasis: "timeline" }], [clip]);
		expect(getCaptionWordCutRange(sequence, 5, 7, 6000)).toEqual({ startMs: 1710, endMs: 2190 });
		expect(getCaptionWordCutRange(sequence, 4, 5, 6000)).toBeNull();
		expect(getCaptionWordCutRange({ ...sequence, sourceCue: { ...cue, words: undefined } }, 5, 9, 6000)).toBeNull();
		const words = cue.words?.map((word, index) => ({ ...word, ...(index === 1 ? { timingUnreliable: true } : {}) }));
		expect(getCaptionWordCutRange({ ...sequence, sourceCue: { ...cue, words } }, 5, 9, 6000)).toBeNull();
	});
	it("splits a Chinese cue without word timings exactly at F2", () => {
		const cues: CaptionCue[] = [
			{ id: "cue", timeBasis: "timeline", startMs: 0, endMs: 6000, text: "这是一句中文字幕" },
		];
		const result = splitTimelineCaptions(cues, [clip], 2125);
		expect(result.map(({ startMs, endMs, text }) => ({ startMs, endMs, text }))).toEqual([
			{ startMs: 0, endMs: 2125, text: cues[0].text },
			{ startMs: 2125, endMs: 6000, text: cues[0].text },
		]);
		expect(result[0].id).not.toBe(result[1].id);
		expect(splitTimelineCaptions(result, [clip], 2125)).toEqual(result);
	});
	it("maps source-timed splits through trimmed, sped-up footage", () => {
		const sped = { ...clip, sourceStartMs: 1000, speed: 2, endMs: 2000 };
		const result = splitTimelineCaptions(
			[{ id: "cue", startMs: 1000, endMs: 5000, text: "字幕" }],
			[sped],
			500,
		);
		expect(result.map(({ startMs, endMs }) => [startMs, endMs])).toEqual([
			[1000, 2000],
			[2000, 5000],
		]);
		expect(
			projectCaptionCues(result, [sped]).map(({ startMs, endMs }) => [startMs, endMs]),
		).toEqual([
			[0, 500],
			[500, 2000],
		]);
	});
	it("trims deleted words and shifts all remaining imported word timings", () => {
		const cue: CaptionCue = {
			id: "cue",
			timeBasis: "timeline",
			startMs: 0,
			endMs: 6000,
			text: "before removed after",
			words: [
				{ text: "before", startMs: 0, endMs: 2000 },
				{ text: "removed", startMs: 2000, endMs: 4000, leadingSpace: true },
				{ text: "after", startMs: 4000, endMs: 6000, leadingSpace: true },
			],
		};
		const result = deleteTimelineCaptionRanges([cue], [{ startMs: 2000, endMs: 4000 }]);
		expect(
			result.map(({ startMs, endMs, text, words }) => ({ startMs, endMs, text, words })),
		).toEqual([
			{
				startMs: 0,
				endMs: 2000,
				text: "before",
				words: [{ text: "before", startMs: 0, endMs: 2000 }],
			},
			{
				startMs: 2000,
				endMs: 4000,
				text: "after",
				words: [{ text: "after", startMs: 2000, endMs: 4000, leadingSpace: true }],
			},
		]);
	});
	it("leaves source captions in source time so the edited clips project them only once", () => {
		const source: CaptionCue = { id: "source", startMs: 4000, endMs: 6000, text: "after" };
		const cuts = [{ startMs: 2000, endMs: 4000 }];
		const clips = deleteTimelineRanges([clip], cuts, (region, startMs) => ({
			...region,
			sourceStartMs: startMs,
		}));
		const captions = deleteTimelineCaptionRanges([source], cuts);
		expect(captions[0]).toBe(source);
		expect(projectCaptionCues(captions, clips)).toMatchObject([{ startMs: 2000, endMs: 4000 }]);
	});
});
