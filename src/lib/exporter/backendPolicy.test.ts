import { describe, expect, it } from "vitest";
import { normalizeLightningRuntimePlatform, planExportRoute } from "./backendPolicy";

const encoder = { scope: "encoder", platform: "win32", backendPreference: "auto" } as const;
const staticLayout = {
	scope: "static-layout", cudaSkipReason: null, d3d11SkipReason: null, gpuOnlyFeatures: [],
} as const;

describe("planExportRoute", () => {
	it.each([
		["Win32", "win32"], ["Linux x86_64", "linux"], ["MacIntel", "darwin"], ["unknown", "unknown"],
	])("normalizes %s to %s", (hint, platform) => {
		expect(normalizeLightningRuntimePlatform(hint)).toBe(platform);
	});

	it.each(["win32", "darwin"] as const)("prefers Breeze streaming on %s auto exports", platform => {
		expect(planExportRoute({ ...encoder, platform })).toMatchObject({
			primary: "breeze-stream",
			fallbacks: ["webcodecs"],
			waitForMetadata: false,
		});
	});

	it("waits for Windows source metadata when native mixed audio is available", () => {
		expect(planExportRoute({ ...encoder, mixedAudioTransport: true })).toMatchObject({
			primary: "breeze-stream", waitForMetadata: true,
		});
		expect(planExportRoute({ ...encoder, mixedAudioTransport: true, requiresFfmpegAudio: false })).toMatchObject({
			primary: "breeze-stream", waitForMetadata: false,
		});
	});

	it("tries static layout first for Breeze or a CUDA opt-in", () => {
		for (const plan of [
			planExportRoute({ ...encoder, backendPreference: "breeze" }),
			planExportRoute({ ...encoder, nvidiaCudaEnabled: true }),
		]) {
			expect(plan.primary).toBe("native-static-layout");
			expect(plan.fallbacks).toEqual(["breeze-stream", "webcodecs"]);
			expect(plan.waitForMetadata).toBe(true);
		}
		expect(planExportRoute({ ...encoder, backendPreference: "breeze", staticLayoutAttempted: true })).toMatchObject({
			primary: "breeze-stream", reasons: { "native-static-layout": ["static-layout-already-attempted"] },
		});
	});

	it("honors WebCodecs when CUDA is enabled or Breeze must be retried", () => {
		expect(planExportRoute({ ...encoder, backendPreference: "webcodecs", nvidiaCudaEnabled: true })).toMatchObject({
			primary: "webcodecs", fallbacks: [], waitForMetadata: false, reasons: { webcodecs: ["explicit-webcodecs"] },
		});
		expect(planExportRoute({ ...encoder, backendPreference: "breeze", retryWithWebCodecs: "native-encoder" })).toMatchObject({
			primary: "webcodecs", fallbacks: [], reasons: { webcodecs: ["retry-after:native-encoder"] },
		});
	});

	it("resolves Linux native streaming after seeing whether audio needs FFmpeg", () => {
		const linux = { ...encoder, platform: "linux", mixedAudioTransport: true } as const;
		expect(planExportRoute(linux).waitForMetadata).toBe(true);
		expect(planExportRoute({ ...linux, requiresFfmpegAudio: true })).toMatchObject({
			primary: "breeze-stream", fallbacks: ["webcodecs"], waitForMetadata: false,
		});
		expect(planExportRoute({ ...linux, requiresFfmpegAudio: false })).toMatchObject({
			primary: "webcodecs", fallbacks: [], waitForMetadata: false,
		});
		expect(planExportRoute({ ...linux, mixedAudioTransport: false })).toMatchObject({
			primary: "webcodecs", fallbacks: ["breeze-stream"], preferBreezeToSoftware: true,
		});
	});

	it("orders CUDA, D3D11 and FFmpeg when all three can render the layout", () => {
		expect(planExportRoute({ ...staticLayout, gpuOnlyFeatures: [] })).toEqual({
			primary: "nvidia-cuda-compositor",
			fallbacks: ["windows-d3d11-compositor", "ffmpeg-static-layout"],
			reasons: {
				"nvidia-cuda-compositor": ["cuda-compositor-available"],
				"windows-d3d11-compositor": ["d3d11-compositor-available"],
				"ffmpeg-static-layout": ["ffmpeg-static-layout-available"],
			},
		});
	});

	it("excludes FFmpeg when GPU-dependent layers would disappear", () => {
		const options = { ...staticLayout, cudaSkipReason: "env-disabled", gpuOnlyFeatures: ["cursor overlay"] };
		expect(planExportRoute(options)).toMatchObject({
			primary: "windows-d3d11-compositor",
			fallbacks: [],
			reasons: { "ffmpeg-static-layout": ["unsupported-layout:cursor overlay"] },
		});
		expect(planExportRoute({ ...options, d3d11SkipReason: "d3d11-helper-unavailable" })).toMatchObject({
			primary: null, fallbacks: [],
		});
		expect(planExportRoute({ ...options, d3d11SkipReason: "d3d11-helper-unavailable", gpuOnlyFeatures: [] })).toMatchObject({
			primary: "ffmpeg-static-layout", fallbacks: [],
		});
	});
});
