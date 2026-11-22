import { afterEach, describe, expect, it, vi } from "vitest";

it("keeps imported subtitle sequence timing when normalizing a saved project", () => {
	const imported = {id:"srt",startMs:500,endMs:2000,text:"字幕",timeBasis:"timeline" as const};
	const restored = normalizeProjectEditor({autoCaptions:[imported]});
	expect(restored.autoCaptions).toEqual([imported]);
	expect(normalizeProjectEditor({autoCaptions:[{...imported,timeBasis:undefined}]}).autoCaptions[0]).not.toHaveProperty("timeBasis");
});

import {
	getDefaultBorderRadiusPercent,
	createProjectData,
	legacyBorderRadiusPixelsToPercent,
	normalizeProjectEditor,
	resolveVideoUrl,
} from "./projectPersistence";
import {
	createEditorHistoryStack,
	recordEditorHistorySnapshot,
	undoEditorHistoryStack,
	type EditorHistorySnapshot,
} from "./editorHistory";
import { ADVANCED_VERTICAL_PADDING_MAX, DEFAULT_KEYSTROKE_OVERLAY, type TimelineMarker } from "./types";

afterEach(() => vi.unstubAllGlobals());

it("defaults the keystroke overlay in old projects and retains its filter, style and hidden source IDs", () => {
	expect(normalizeProjectEditor({}).keystrokeOverlay).toEqual(DEFAULT_KEYSTROKE_OVERLAY);
	const settings = { enabled: false, filter: "shortcuts", hiddenIds: ["123:S"], style: { ...DEFAULT_KEYSTROKE_OVERLAY.style, fontSize: 48 } };
	const reopened = normalizeProjectEditor(JSON.parse(JSON.stringify({ keystrokeOverlay: { ...settings, events: [{ key: "S" }] } })));
	expect(reopened.keystrokeOverlay).toEqual(settings);
	expect(normalizeProjectEditor({ keystrokeOverlay: { filter: "invalid" } }).keystrokeOverlay.filter).toBe("all");
});

it("keeps elevated caption positions and normalizes the horizontal offset on reopen", () => {
	expect(normalizeProjectEditor({ autoCaptionSettings: { bottomOffset: 66 } }).autoCaptionSettings)
		.toMatchObject({ bottomOffset: 66, horizontalOffset: 0 });
	expect(normalizeProjectEditor({ autoCaptionSettings: { bottomOffset: 120, horizontalOffset: -80 } }).autoCaptionSettings)
		.toMatchObject({ bottomOffset: 95, horizontalOffset: -50 });
	expect(normalizeProjectEditor({ autoCaptionSettings: { bottomOffset: 3, horizontalOffset: 12 } }).autoCaptionSettings)
		.toMatchObject({ bottomOffset: 3, horizontalOffset: 12 });
});

describe("resolveVideoUrl", () => {
	it("does not send an already renderable URL through the local-path IPC", async () => {
		const getLocalMediaUrl = vi.fn();
		vi.stubGlobal("window", { electronAPI: { getLocalMediaUrl } });

		await expect(resolveVideoUrl("http://127.0.0.1:1234/video?path=test")).resolves.toBe(
			"http://127.0.0.1:1234/video?path=test",
		);
		expect(getLocalMediaUrl).not.toHaveBeenCalled();
	});

	it("normalizes a file URL before requesting a local media URL", async () => {
		const getLocalMediaUrl = vi.fn().mockResolvedValue({
			success: true,
			url: "http://127.0.0.1:1234/video?path=clip",
		});
		vi.stubGlobal("window", { electronAPI: { getLocalMediaUrl } });

		await resolveVideoUrl("file:///Users/demo/My%20Clip.mp4");
		expect(getLocalMediaUrl).toHaveBeenCalledWith("/Users/demo/My Clip.mp4");
	});
});

describe("normalizeProjectEditor", () => {
	it("round-trips a source transcript independently of edited captions", () => {
		const transcript = {
			version: 1 as const, timeBasis: "source" as const, engine: "qwen3-asr",
			createdAt: "2026-11-20T00:00:00.000Z", model: "local-qwen",
			segments: [{
				id: "original", startMs: 1140, endMs: 1850, text: "Raw text",
				words: [
					{ startMs: 1140, endMs: 1450, text: "Raw", confidence: 0.9 },
					{ startMs: 1490, endMs: 1490, text: "text", leadingSpace: true, flags: ["timing-unreliable"] },
				],
			}],
		};
		const captions = [{ id: "reviewed", startMs: 1200, endMs: 1820, text: "Reviewed text" }];
		const editor = normalizeProjectEditor({ transcript, autoCaptions: captions });
		const saved = createProjectData("source.mp4", editor);
		const restored = normalizeProjectEditor(JSON.parse(JSON.stringify(saved)).editor);
		expect(restored.transcript).toEqual(transcript);
		expect(restored.autoCaptions).toEqual(captions);
	});
	it("keeps a blank caption available for quality review", () => {
		expect(normalizeProjectEditor({
			autoCaptions: [{ id: "blank", startMs: 100, endMs: 500, text: "   ", timeBasis: "timeline" }],
		}).autoCaptions).toEqual([{ id: "blank", startMs: 100, endMs: 500, text: "", timeBasis: "timeline" }]);
	});
	it("round-trips valid source-time markers and drops malformed or duplicate entries", () => {
		const markers: TimelineMarker[] = [
			{ id: "review", sourceTimeMs: 7200, origin: "editor", note: "Recheck this", color: "blue" },
			{ id: "during-recording", sourceTimeMs: 3500, origin: "recording" },
		];
		const editor = normalizeProjectEditor({
			markers: [
				{ id: "review", sourceTimeMs: NaN, origin: "editor" },
				...markers,
				{ ...markers[0], sourceTimeMs: 9900 },
				{ id: "infinite", sourceTimeMs: Infinity, origin: "editor" },
				{ id: "negative", sourceTimeMs: -1, origin: "editor" },
			],
		});
		expect(editor.markers).toEqual(markers);
		const saved = createProjectData("clip.mp4", editor);
		expect(normalizeProjectEditor(JSON.parse(JSON.stringify(saved)).editor).markers).toEqual(markers);
		expect(normalizeProjectEditor({}).markers).toEqual([]);
	});
	it("round-trips the change log and unknown fields across saved project snapshots", () => {
		const changeLog = { version: 1 as const, entries: [{
			id: "old-cut", kind: "cut" as const, source: "agent" as const, createdAt: "2026-11-19T12:30:00.000Z",
			batchId: "old-batch", rangeIndex: 0, sourceStartMs: 200, sourceEndMs: 650, speed: 1,
			durationMs: 450, timelineMs: 200, review: "pending" as const,
		}] };
		const original = {
			version: 2, videoPath: "old.mp4", projectId: "original",
			futureTop: { value: 7 }, thumbnailPng: "thumbnail is managed in the main process",
			editor: { changeLog, futureField: { tags: ["asr"] }, zoomRegions: [] },
		};
		const normalized = normalizeProjectEditor(original.editor);
		const saved = createProjectData("old.mp4", normalized, original.projectId, original);
		expect(saved).toMatchObject({
			futureTop: { value: 7 },
			editor: { changeLog, futureField: { tags: ["asr"] } },
		});
		expect(saved).not.toHaveProperty("thumbnailPng");
		const edited = createProjectData("old.mp4", { changeLog, wallpaper: "custom" }, original.projectId, saved);
		expect(edited).toMatchObject({
			futureTop: { value: 7 },
			editor: { changeLog, futureField: { tags: ["asr"] }, wallpaper: "custom" },
		});
		expect(edited.editor).not.toHaveProperty("zoomRegions");
	});
	it("normalizes legacy, current and unknown easing values from saved projects", () => {
		const saved = {
			zoomInEasing: "recordly",
			zoomOutEasing: "glide",
			connectedZoomEasing: "custom-unknown",
		};
		expect(normalizeProjectEditor(saved as unknown as Parameters<typeof normalizeProjectEditor>[0])).toMatchObject({
			zoomInEasing: "classic",
			zoomOutEasing: "glide",
			connectedZoomEasing: "glide",
		});
	});
	it("preserves custom subtitle font, outline and shadow settings", () => {
		const autoCaptionSettings = {
			fontFamily: "Microsoft YaHei",
			fontWeight: "bold",
			strokeWidth: 3,
			strokeColor: "#223344",
			shadowEnabled: true,
			shadowColor: "#334455",
			shadowOpacity: 0.7,
			shadowBlur: 8,
			shadowOffsetX: -3,
			shadowOffsetY: 4,
		};
		expect(normalizeProjectEditor({ autoCaptionSettings }).autoCaptionSettings).toMatchObject(
			autoCaptionSettings,
		);
	});

	it("bounds invalid subtitle effects when opening a project", () => {
		expect(
			normalizeProjectEditor({
				autoCaptionSettings: {
					strokeWidth: 500,
					shadowOpacity: -1,
					shadowBlur: 100,
					shadowOffsetX: -100,
				},
			}).autoCaptionSettings,
		).toMatchObject({ strokeWidth: 12, shadowOpacity: 0, shadowBlur: 30, shadowOffsetX: -30 });
	});
	it("ignores retired temporal blur fields when opening an older project", () => {
		const savedEditor = {
			zoomMotionBlur: 0.6,
			zoomTemporalMotionBlur: 0.35,
			zoomMotionBlurSampleCount: 13,
			zoomMotionBlurShutterFraction: 0.94,
		};
		const normalized = normalizeProjectEditor(savedEditor);
		expect(normalized.zoomMotionBlur).toBe(0.6);
		for (const field of [
			"zoomTemporalMotionBlur",
			"zoomMotionBlurSampleCount",
			"zoomMotionBlurShutterFraction",
		]) {
			expect(normalized).not.toHaveProperty(field);
		}
	});
	it("defaults to 8% on macOS and square corners elsewhere", () => {
		expect(getDefaultBorderRadiusPercent("MacIntel")).toBe(8);
		expect(getDefaultBorderRadiusPercent("Win32")).toBe(0);
		expect(getDefaultBorderRadiusPercent("Linux x86_64")).toBe(0);
	});

	it("clamps radius percentages", () => {
		expect(normalizeProjectEditor({ borderRadius: 75 }).borderRadius).toBe(50);
	});

	it("converts legacy 1080p-relative radius pixels to percentages", () => {
		expect(legacyBorderRadiusPixelsToPercent(54)).toBe(5);
	});

	it("preserves the extended advanced vertical padding range", () => {
		const editor = normalizeProjectEditor({
			padding: {
				top: 240,
				bottom: ADVANCED_VERTICAL_PADDING_MAX,
				left: 22,
				right: 22,
				linked: false,
			},
		});

		expect(editor.padding).toMatchObject({
			top: 240,
			bottom: ADVANCED_VERTICAL_PADDING_MAX,
			left: 22,
			right: 22,
			linked: false,
		});
	});

	it("keeps linked padding clamped to the original range", () => {
		const editor = normalizeProjectEditor({
			padding: {
				top: ADVANCED_VERTICAL_PADDING_MAX,
				bottom: ADVANCED_VERTICAL_PADDING_MAX,
				left: ADVANCED_VERTICAL_PADDING_MAX,
				right: ADVANCED_VERTICAL_PADDING_MAX,
				linked: true,
			},
		});

		expect(editor.padding).toMatchObject({
			top: 100,
			bottom: 100,
			left: 100,
			right: 100,
			linked: true,
		});
	});

	it("migrates legacy webcam radius pixels to percentage roundness", () => {
		const editor = normalizeProjectEditor({
			webcam: {
				cornerRadius: 90,
				width: 40,
				height: 40,
			} as never,
		});

		expect(editor.webcam.roundness).toBeCloseTo(17.36, 1);
		expect(editor.webcam.cornerRadius).toBeUndefined();
	});

	it("uses the legacy webcam size when migrating radius pixels", () => {
		const editor = normalizeProjectEditor({
			webcam: {
				cornerRadius: 90,
				size: 80,
			} as never,
		});

		expect(editor.webcam.width).toBe(80);
		expect(editor.webcam.height).toBe(80);
		expect(editor.webcam.roundness).toBeCloseTo(4.34, 1);
	});
});

describe("loaded clip sequence migration", () => {
	const saved = {
		clipRegions: [
			{ id: "a", startMs: 0, endMs: 2000, speed: 1 },
			{ id: "b", startMs: 3000, endMs: 6000, sourceStartMs: 5000, speed: 1 },
		],
		zoomRegions: [{ id: "zoom", startMs: 3500, endMs: 4500, depth: 2 }] as never,
		annotationRegions: [
			{ id: "annotation", startMs: 3500, endMs: 4500, content: "Keep", type: "text" },
		] as never,
		audioRegions: [
			{ id: "music", startMs: 3500, endMs: 7500, audioPath: "/music.wav", volume: 0.7 },
		],
		autoCaptions: [{ id: "cue", startMs: 5500, endMs: 6000, text: "Source timed" }],
		sourceAudioTrackSettingsByClip: { b: { system: { volume: 0.4, muted: false } } } as never,
	};
	it("migrates clips and connected tracks before they become editor state", () => {
		const editor = normalizeProjectEditor(saved);
		expect(editor.clipRegions[1]).toMatchObject({
			id: "b",
			startMs: 2000,
			endMs: 5000,
			sourceStartMs: 5000,
		});
		expect(editor.zoomRegions[0]).toMatchObject({ startMs: 2500, endMs: 3500 });
		expect(editor.annotationRegions[0]).toMatchObject({ startMs: 2500, endMs: 3500 });
		expect(editor.audioRegions[0]).toMatchObject({ startMs: 2500, endMs: 6500 });
		expect(editor.autoCaptions).toEqual(saved.autoCaptions);
		expect(editor.sourceAudioTrackSettingsByClip).toEqual(saved.sourceAudioTrackSettingsByClip);
		expect(normalizeProjectEditor(editor)).toMatchObject({
			clipRegions: editor.clipRegions,
			zoomRegions: editor.zoomRegions,
			annotationRegions: editor.annotationRegions,
			audioRegions: editor.audioRegions,
			autoCaptions: editor.autoCaptions,
		});
	});
	it("starts history at migrated footage, with only real edits to undo", () => {
		const editor = normalizeProjectEditor(saved);
		const snapshot = (
			value: ReturnType<typeof normalizeProjectEditor>,
		): EditorHistorySnapshot => ({
			clipRegions: value.clipRegions,
			zoomRegions: value.zoomRegions,
			annotationRegions: value.annotationRegions,
			audioRegions: value.audioRegions,
			speedRegions: value.speedRegions,
			autoCaptions: value.autoCaptions,
			selectedZoomId: null,
			selectedClipId: null,
			selectedAnnotationId: null,
			selectedAudioId: null,
		});
		const initial = snapshot(editor);
		const history = createEditorHistoryStack();
		expect(recordEditorHistorySnapshot(history, initial)).toBe("initialized");
		expect(recordEditorHistorySnapshot(history, snapshot(normalizeProjectEditor(editor)))).toBe(
			"unchanged",
		);
		expect(history.past).toEqual([]);
		const edited = { ...initial, clipRegions: [editor.clipRegions[0]] };
		expect(recordEditorHistorySnapshot(history, edited)).toBe("recorded");
		expect(undoEditorHistoryStack(history, edited)?.clipRegions).toEqual(editor.clipRegions);
		expect(history.past).toEqual([]);
	});
	it("preserves an explicit empty timeline and independent audio", () => {
		const editor = normalizeProjectEditor({ ...saved, clipRegions: [] });
		expect(editor.clipRegions).toEqual([]);
		expect(editor.audioRegions[0]).toMatchObject({ startMs: 3500, endMs: 7500 });
	});
});

it("reopens persisted local media URLs using the current server port", async () => {
	const getLocalMediaUrl = vi.fn().mockResolvedValue({
		success: true,
		url: "http://127.0.0.1:9999/video?path=%2Ftmp%2Fclip.mp4",
	});
	vi.stubGlobal("window", { electronAPI: { getLocalMediaUrl } });
	await expect(
		resolveVideoUrl("http://127.0.0.1:1234/video?path=%2Ftmp%2Fclip.mp4"),
	).resolves.toContain(":9999/");
	expect(getLocalMediaUrl).toHaveBeenCalledWith("/tmp/clip.mp4");
});

describe("annotations across the canvas and imported webcam ranges", () => {
	it("preserves annotations outside the recording rectangle and webcam visibility when a project is reopened", () => {
		const editor = normalizeProjectEditor({
			annotationRegions: [
				{
					id: "outside",
					startMs: 0,
					endMs: 1000,
					type: "text",
					position: { x: -12, y: 110 },
					size: { width: 140, height: 20 },
				},
			] as never,
			webcam: {
				sourcePath: "/sequence-webcam.mp4",
				visibleRanges: [{ startMs: 1200, endMs: 2000 }],
			} as never,
		});
		expect(editor.annotationRegions[0].position).toEqual({ x: -12, y: 110 });
		expect(editor.annotationRegions[0].size.width).toBe(140);
		expect(normalizeProjectEditor(editor).annotationRegions).toEqual(editor.annotationRegions);
		expect(normalizeProjectEditor(editor).webcam.visibleRanges).toEqual([
			{ startMs: 1200, endMs: 2000 },
		]);
	});
});

it("discards inverted saved source bounds while preserving the in-point", () => {
	const editor = normalizeProjectEditor({
		clipRegions: [
			{
				id: "clip",
				startMs: 0,
				endMs: 1000,
				sourceStartMs: 5000,
				sourceMinMs: 6000,
				sourceMaxMs: 4000,
				speed: 0,
			},
		],
	});
	expect(editor.clipRegions[0]).toMatchObject({ sourceStartMs: 5000, speed: 1 });
	expect(editor.clipRegions[0].sourceMinMs).toBeUndefined();
	expect(editor.clipRegions[0].sourceMaxMs).toBeUndefined();
});

it("ignores legacy export preferences when opening and resaving a project", async () => {
	const { createProjectData } = await import("./projectPersistence");
	const legacyEditor = {
		wallpaper: "#112233",
		exportQuality: "high",
		exportFormat: "gif",
		mp4FrameRate: 60,
		publishDestination: "local",
		whisperModelPath: "/machine/model.bin",
	};
	const loaded = normalizeProjectEditor(legacyEditor);
	expect(loaded.wallpaper).toBe("#112233");
	for (const key of [
		"exportQuality",
		"exportFormat",
		"mp4FrameRate",
		"publishDestination",
		"whisperModelPath",
	]) {
		expect(loaded).not.toHaveProperty(key);
		expect(createProjectData("/clip.mp4", legacyEditor).editor).not.toHaveProperty(key);
	}
	expect(legacyEditor.exportQuality).toBe("high");
});
