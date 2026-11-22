import { describe, expect, it } from "vitest";
import { DEFAULT_WEBCAM_OVERLAY, DEFAULT_ZOOM_DEPTH, ZOOM_DEPTH_SCALES } from "./types";
import { getWebcamOverlayDimensionsPx } from "./webcamOverlay";
import { normalizeProjectEditor } from "./projectPersistence";
import { normalizeEditorPreferences } from "./editorPreferences";
import { getVideoRegionAudio, normalizeVideoRegions } from "./videoTracks";

describe("editor six improvements", () => {
 it("scales both camera dimensions together from 0.2 to 2", () => {
  const base = { containerWidth: 1920, containerHeight: 1080, widthPercent: 40, heightPercent: 25, margin: 24, zoomScale: 1, reactToZoom: false };
  const unit = getWebcamOverlayDimensionsPx(base);
  for (const scale of [0.2, 0.55, 1, 1.5, 2]) expect(getWebcamOverlayDimensionsPx({ ...base, scale })).toEqual({ width: unit.width * scale, height: unit.height * scale });
 });
 it("preserves multiplier in project/preferences and clamps invalid values", () => {
  for (const scale of [0.2, 0.7, 2]) {
   expect(normalizeProjectEditor({ webcam: { ...DEFAULT_WEBCAM_OVERLAY, scale } }).webcam.scale).toBe(scale);
   expect(normalizeEditorPreferences({ webcam: { ...DEFAULT_WEBCAM_OVERLAY, scale } }).webcam.scale).toBe(scale);
  }
  for (const [input, expected] of [[-3, 0.2], [3, 2], [NaN, 1], [Infinity, 1]]) expect(normalizeProjectEditor({ webcam: { ...DEFAULT_WEBCAM_OVERLAY, scale: input } }).webcam.scale).toBe(expected);
 });
 it("defaults screen zoom to 1.5", () => { expect(ZOOM_DEPTH_SCALES[DEFAULT_ZOOM_DEPTH]).toBe(1.5); });
 it("retains per-clip camera/video identity and sound routing after cross-track moves", () => {
  const tracks = [{ id: "video", kind: "video" as const, name: "Video" }, { id: "cam", kind: "webcam" as const, name: "Camera" }];
  const base = { sourcePath: "/media.mp4", sourceDurationMs: 6000, sourceStartMs: 0, startMs: 0, endMs: 1000, speed: 1, volume: 1 };
  const regions = normalizeVideoRegions([{ ...base, id: "cam", trackId: "video", kind: "webcam" }, { ...base, id: "video", trackId: "cam", kind: "video" }], tracks);
  expect(regions.map(region => region.kind)).toEqual(["webcam", "video"]);
  expect(getVideoRegionAudio(regions, tracks).map(region => region.id)).toEqual(["video-audio:video"]);
 });
});
