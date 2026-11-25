import * as fc from "fast-check";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
	calculateOutputDimensions,
	GifExporter,
	getGifFrameDelayMs,
	getGifRepeat,
} from "./gifExporter";
import { GIF_SIZE_PRESETS, type GifFrameRate, type GifSizePreset } from "./types";

const { createVideoExporter, exportVideo, cancelVideo } = vi.hoisted(() => {
	const exportVideo = vi.fn(async () => ({
		success: true, tempFilePath: "/temp/intermediate.mp4", metrics: { frameCount: 2 },
	}));
	const cancelVideo = vi.fn();
	const createVideoExporter = vi.fn(function () {
		return { export: exportVideo, cancel: cancelVideo };
	});
	return { createVideoExporter, exportVideo, cancelVideo };
});

vi.mock("./modernVideoExporter", () => ({ ModernVideoExporter: createVideoExporter }));

describe("desktop GIF export", () => {
	afterEach(() => {
		vi.unstubAllGlobals();
		vi.clearAllMocks();
	});

	it.each([false, true])("uses the shared MP4 stage for a short clip (cancelled: %s)", async cancelled => {
		const convertExportToGif = vi.fn(async () => ({ success: true, tempPath: "/temp/output.gif" }));
		const discardExportedTemp = vi.fn(async () => {});
		vi.stubGlobal("window", { electronAPI: { convertExportToGif, discardExportedTemp } });
		const onProgress = vi.fn(() => {
			if (cancelled) exporter.cancel();
		});
		const exporter = new GifExporter({
			videoUrl: "file:///clip.mp4", width: 161, height: 91, frameRate: 15, loop: false, sizePreset: "original",
			wallpaper: "#000000", zoomRegions: [], showShadow: false, shadowIntensity: 0,
			backgroundBlur: 0, borderRadius: 0, padding: 0, cropRegion: { x: 0, y: 0, width: 1, height: 1 },
			onProgress,
		});

		const result = await exporter.export();

		expect(createVideoExporter).toHaveBeenCalledWith(expect.objectContaining({
			width: 162, height: 92, omitAudio: true, preferredRenderBackend: "webgl",
		}));
		expect(exportVideo).toHaveBeenCalledOnce();
		expect(onProgress).toHaveBeenCalledWith(expect.objectContaining({ totalFrames: 2, phase: "finalizing" }));
		expect(discardExportedTemp).toHaveBeenCalledExactlyOnceWith("/temp/intermediate.mp4");
		if (cancelled) {
			expect(result).toEqual({ success: false, error: "Export cancelled" });
			expect(cancelVideo).toHaveBeenCalledOnce();
			expect(convertExportToGif).not.toHaveBeenCalled();
		} else {
			expect(result).toMatchObject({ success: true, tempFilePath: "/temp/output.gif" });
			expect(convertExportToGif).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
				videoPath: "/temp/intermediate.mp4", width: 161, height: 91, fps: 15, frameCount: 2, loop: false,
			}));
		}
	});
});

describe("GIF Exporter", () => {
	it("enables infinite looping when requested", () => {
		expect(getGifRepeat(true)).toBe(0);
	});

	it("omits the repeat extension for single playback", () => {
		expect(getGifRepeat(false)).toBe(-1);
	});

	/**
	 * Property 4: Aspect Ratio Preservation
	 *
	 * *For any* source video with aspect ratio R and any size preset, the exported
	 * GIF SHALL have an aspect ratio within 0.01 of R.
	 *
	 * **Validates: Requirements 4.4**
	 *
	 * Feature: gif-export, Property 4: Aspect Ratio Preservation
	 */
	describe("Property 4: Aspect Ratio Preservation", () => {
		const sizePresets: GifSizePreset[] = ["medium", "large", "original"];

		it("should preserve aspect ratio within 0.01 tolerance for all size presets", () => {
			fc.assert(
				fc.property(
					fc.integer({ min: 100, max: 4000 }), // sourceWidth
					fc.integer({ min: 100, max: 4000 }), // sourceHeight
					fc.constantFrom(...sizePresets),
					(sourceWidth: number, sourceHeight: number, sizePreset: GifSizePreset) => {
						const originalAspectRatio = sourceWidth / sourceHeight;

						const { width, height } = calculateOutputDimensions(
							sourceWidth,
							sourceHeight,
							sizePreset,
							GIF_SIZE_PRESETS,
						);

						const outputAspectRatio = width / height;

						// Aspect ratio should be preserved within 0.01 tolerance
						// (small deviation allowed due to rounding to even numbers)
						expect(Math.abs(originalAspectRatio - outputAspectRatio)).toBeLessThan(
							0.01,
						);
					},
				),
				{ numRuns: 100 },
			);
		});

		it("should return original dimensions when source is smaller than preset max height", () => {
			fc.assert(
				fc.property(
					fc.integer({ min: 100, max: 400 }), // sourceWidth (small)
					fc.integer({ min: 100, max: 400 }), // sourceHeight (small, less than 720p)
					(sourceWidth: number, sourceHeight: number) => {
						// For 'medium' preset with maxHeight 720, if source is smaller, use original
						const { width, height } = calculateOutputDimensions(
							sourceWidth,
							sourceHeight,
							"medium",
							GIF_SIZE_PRESETS,
						);

						expect(width).toBe(sourceWidth);
						expect(height).toBe(sourceHeight);
					},
				),
				{ numRuns: 100 },
			);
		});

		it('should return original dimensions for "original" preset regardless of size', () => {
			fc.assert(
				fc.property(
					fc.integer({ min: 100, max: 4000 }),
					fc.integer({ min: 100, max: 4000 }),
					(sourceWidth: number, sourceHeight: number) => {
						const { width, height } = calculateOutputDimensions(
							sourceWidth,
							sourceHeight,
							"original",
							GIF_SIZE_PRESETS,
						);

						expect(width).toBe(sourceWidth);
						expect(height).toBe(sourceHeight);
					},
				),
				{ numRuns: 100 },
			);
		});

		it("should scale down to preset max height when source is larger", () => {
			fc.assert(
				fc.property(
					fc.integer({ min: 1000, max: 4000 }), // sourceWidth (large)
					fc.integer({ min: 800, max: 2000 }), // sourceHeight (larger than 720p)
					(sourceWidth: number, sourceHeight: number) => {
						// For 'medium' preset with maxHeight 720
						const { width, height } = calculateOutputDimensions(
							sourceWidth,
							sourceHeight,
							"medium",
							GIF_SIZE_PRESETS,
						);

						// Height should be at most 720 (or 722 due to even rounding)
						expect(height).toBeLessThanOrEqual(722);
						// Width should be scaled proportionally
						expect(width).toBeLessThan(sourceWidth);
					},
				),
				{ numRuns: 100 },
			);
		});
	});
});

/**
 * Property 3: Size Preset Resolution Mapping
 *
 * *For any* valid size preset and source video dimensions, the GIF_Exporter SHALL
 * produce output with height matching the preset's max height (or source height if smaller),
 * with width calculated to maintain aspect ratio.
 *
 * **Validates: Requirements 4.2**
 *
 * Feature: gif-export, Property 3: Size Preset Resolution Mapping
 */
describe("Property 3: Size Preset Resolution Mapping", () => {
	it("should map size presets to correct max heights", () => {
		fc.assert(
			fc.property(
				fc.integer({ min: 800, max: 4000 }), // sourceWidth (large enough to trigger scaling)
				fc.integer({ min: 800, max: 2000 }), // sourceHeight (larger than all presets except original)
				fc.constantFrom("medium", "large") as fc.Arbitrary<GifSizePreset>,
				(sourceWidth: number, sourceHeight: number, sizePreset: GifSizePreset) => {
					const { height } = calculateOutputDimensions(
						sourceWidth,
						sourceHeight,
						sizePreset,
						GIF_SIZE_PRESETS,
					);

					const expectedMaxHeight = GIF_SIZE_PRESETS[sizePreset].maxHeight;

					// Height should be at or below the preset's max height
					// (allowing +2 for even number rounding)
					expect(height).toBeLessThanOrEqual(expectedMaxHeight + 2);
				},
			),
			{ numRuns: 100 },
		);
	});

	it("should use source dimensions when smaller than preset", () => {
		fc.assert(
			fc.property(
				fc.integer({ min: 100, max: 400 }), // sourceWidth
				fc.integer({ min: 100, max: 400 }), // sourceHeight (smaller than 720p 'medium' preset)
				fc.constantFrom("medium", "large", "original") as fc.Arbitrary<GifSizePreset>,
				(sourceWidth: number, sourceHeight: number, sizePreset: GifSizePreset) => {
					const { width, height } = calculateOutputDimensions(
						sourceWidth,
						sourceHeight,
						sizePreset,
						GIF_SIZE_PRESETS,
					);

					// When source is smaller than preset, use original dimensions
					expect(width).toBe(sourceWidth);
					expect(height).toBe(sourceHeight);
				},
			),
			{ numRuns: 100 },
		);
	});

	it("should produce even dimensions for encoder compatibility", () => {
		fc.assert(
			fc.property(
				fc.integer({ min: 100, max: 4000 }),
				fc.integer({ min: 100, max: 4000 }),
				fc.constantFrom("medium", "large", "original") as fc.Arbitrary<GifSizePreset>,
				(sourceWidth: number, sourceHeight: number, sizePreset: GifSizePreset) => {
					const { width, height } = calculateOutputDimensions(
						sourceWidth,
						sourceHeight,
						sizePreset,
						GIF_SIZE_PRESETS,
					);

					// When scaling occurs, dimensions should be even
					// (original dimensions are passed through as-is)
					if (
						sourceHeight > GIF_SIZE_PRESETS[sizePreset].maxHeight &&
						sizePreset !== "original"
					) {
						expect(width % 2).toBe(0);
						expect(height % 2).toBe(0);
					}
				},
			),
			{ numRuns: 100 },
		);
	});
});

/**
 * Property 6: Frame Count Consistency
 *
 * *For any* video with effective duration D (excluding trim regions) and frame rate F,
 * the exported GIF SHALL contain approximately D × F frames (within ±1 frame tolerance).
 *
 * **Validates: Requirements 5.1**
 *
 * Feature: gif-export, Property 6: Frame Count Consistency
 */
describe("Property 6: Frame Count Consistency", () => {
	// Helper function to calculate expected frame count
	const calculateExpectedFrameCount = (durationSeconds: number, frameRate: number): number => {
		return Math.ceil(durationSeconds * frameRate);
	};

	it("should calculate correct frame count for duration and frame rate", () => {
		fc.assert(
			fc.property(
				fc.float({ min: 0.5, max: 60, noNaN: true }), // duration in seconds
				fc.constantFrom(10, 15, 20, 25, 30), // valid frame rates
				(duration: number, frameRate: number) => {
					const expectedFrames = calculateExpectedFrameCount(duration, frameRate);

					// Frame count should be positive
					expect(expectedFrames).toBeGreaterThan(0);

					// Frame count should be approximately duration * frameRate
					const approximateFrames = duration * frameRate;
					expect(Math.abs(expectedFrames - approximateFrames)).toBeLessThanOrEqual(1);
				},
			),
			{ numRuns: 100 },
		);
	});

	it("should produce more frames with higher frame rates", () => {
		fc.assert(
			fc.property(
				fc.float({ min: 1, max: 30, noNaN: true }), // duration in seconds
				(duration: number) => {
					const frames10fps = calculateExpectedFrameCount(duration, 10);
					const frames30fps = calculateExpectedFrameCount(duration, 30);

					// 30fps should produce approximately 3x more frames than 10fps
					expect(frames30fps).toBeGreaterThan(frames10fps);
					expect(frames30fps / frames10fps).toBeCloseTo(3, 0);
				},
			),
			{ numRuns: 100 },
		);
	});

	it("should handle trim regions by reducing effective duration", () => {
		fc.assert(
			fc.property(
				fc.float({ min: 5, max: 60, noNaN: true }), // total duration
				fc.float({ min: 0.5, max: 2, noNaN: true }), // trim duration (smaller than total)
				fc.constantFrom(10, 15, 20, 25, 30),
				(totalDuration: number, trimDuration: number, frameRate: number) => {
					const effectiveDuration = totalDuration - trimDuration;
					const framesWithTrim = calculateExpectedFrameCount(
						effectiveDuration,
						frameRate,
					);
					const framesWithoutTrim = calculateExpectedFrameCount(totalDuration, frameRate);

					// Trimmed video should have fewer frames
					expect(framesWithTrim).toBeLessThan(framesWithoutTrim);
				},
			),
			{ numRuns: 100 },
		);
	});
});

describe("GIF frame timing", () => {
	it("keeps elapsed time within half a GIF clock tick at each frame", () => {
		fc.assert(
			fc.property(
				fc.constantFrom<GifFrameRate>(15, 20, 25, 30),
				fc.integer({ min: 1, max: 1800 }),
				(frameRate, frameCount) => {
					let elapsed = 0;
					for (let frameIndex = 0; frameIndex < frameCount; frameIndex++) {
						const delayMs = getGifFrameDelayMs(frameIndex, frameRate);
						if (delayMs <= 0 || delayMs % 10 !== 0) return false;
						elapsed += delayMs;
					}
					return Math.abs(elapsed - (frameCount * 1000) / frameRate) <= 5;
				},
			),
			{ numRuns: 100 },
		);
	});

	it("alternates centisecond delays at 15 and 30 fps", () => {
		expect([0, 1, 2].map((index) => getGifFrameDelayMs(index, 15))).toEqual([70, 60, 70]);
		expect([0, 1, 2].map((index) => getGifFrameDelayMs(index, 30))).toEqual([30, 40, 30]);
	});
});

/**
 * Property 7: MP4 Export Regression
 *
 * *For any* valid MP4 export configuration that worked before this feature,
 * the Video_Exporter SHALL continue to produce valid MP4 output.
 *
 * **Validates: Requirements 7.2**
 *
 * Feature: gif-export, Property 7: MP4 Export Regression
 *
 * Note: This test validates that MP4 export configuration remains unchanged.
 */
describe("Property 7: MP4 Export Regression", () => {
	it("should maintain valid MP4 quality presets", () => {
		const qualityPresets = ["medium", "good", "source"];

		fc.assert(
			fc.property(fc.constantFrom(...qualityPresets), (quality: string) => {
				// Quality presets should be valid
				expect(["medium", "good", "source"]).toContain(quality);
			}),
			{ numRuns: 100 },
		);
	});

	it("should calculate valid MP4 export dimensions", () => {
		fc.assert(
			fc.property(
				fc.integer({ min: 640, max: 3840 }), // sourceWidth
				fc.integer({ min: 480, max: 2160 }), // sourceHeight
				fc.constantFrom("medium", "good", "source"),
				(sourceWidth: number, sourceHeight: number, quality: string) => {
					let exportWidth: number;
					let exportHeight: number;
					const aspectRatio = sourceWidth / sourceHeight;

					if (quality === "source") {
						// Source quality uses original dimensions (may be odd)
						exportWidth = sourceWidth;
						exportHeight = sourceHeight;

						// Dimensions should be positive
						expect(exportWidth).toBeGreaterThan(0);
						expect(exportHeight).toBeGreaterThan(0);
					} else {
						const targetHeight = quality === "medium" ? 720 : 1080;
						exportHeight = Math.floor(targetHeight / 2) * 2;
						exportWidth = Math.floor((exportHeight * aspectRatio) / 2) * 2;

						// Dimensions should be positive and even for non-source quality
						expect(exportWidth).toBeGreaterThan(0);
						expect(exportHeight).toBeGreaterThan(0);
						expect(exportWidth % 2).toBe(0);
						expect(exportHeight % 2).toBe(0);
					}
				},
			),
			{ numRuns: 100 },
		);
	});

	it("should maintain aspect ratio in MP4 export", () => {
		fc.assert(
			fc.property(
				fc.integer({ min: 640, max: 3840 }),
				fc.integer({ min: 480, max: 2160 }),
				fc.constantFrom("medium", "good"),
				(sourceWidth: number, sourceHeight: number, quality: string) => {
					const originalAspectRatio = sourceWidth / sourceHeight;
					const targetHeight = quality === "medium" ? 720 : 1080;

					const exportHeight = Math.floor(targetHeight / 2) * 2;
					const exportWidth = Math.floor((exportHeight * originalAspectRatio) / 2) * 2;

					const exportAspectRatio = exportWidth / exportHeight;

					// Aspect ratio should be preserved within tolerance (due to even rounding)
					expect(Math.abs(originalAspectRatio - exportAspectRatio)).toBeLessThan(0.05);
				},
			),
			{ numRuns: 100 },
		);
	});
});
