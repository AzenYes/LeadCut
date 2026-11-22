import { describe, expect, it } from "vitest";
import { estimateMp4OutputBytes, getMp4ExportBitrate, getSourceQualityBitrate } from "./exportBitrate";

describe("export bitrate policy", () => {
	it("uses the supplied manual Mbps instead of encoding mode or frame-rate scaling", () => {
		const options = { width: 3840, height: 2160, frameRate: 60, quality: "source", encodingMode: "fast" } as const;
		expect(getMp4ExportBitrate({ ...options, manualBitrateMbps: 10 })).toBe(10_000_000);
		expect(getMp4ExportBitrate({ ...options, manualBitrateMbps: 1 })).toBe(1_000_000);
		expect(getMp4ExportBitrate({ ...options, manualBitrateMbps: null })).toBe(getMp4ExportBitrate(options));
	});

	it("estimates decimal bytes including 128 kbps for audio", () => {
		expect(estimateMp4OutputBytes(10_000_000, 60)).toBe(75_960_000);
	});
	it("uses the web-delivery source-quality caps", () => {
		expect(getSourceQualityBitrate(1280, 720)).toBe(8_000_000);
		expect(getSourceQualityBitrate(1920, 1080)).toBe(12_000_000);
		expect(getSourceQualityBitrate(3840, 2160)).toBe(45_000_000);
		expect(
			getMp4ExportBitrate({
				width: 1920,
				height: 1080,
				frameRate: 30,
				quality: "source",
				encodingMode: "quality",
			}),
		).toBe(12_000_000);
		expect(
			getMp4ExportBitrate({
				width: 1920,
				height: 1080,
				frameRate: 30,
				quality: "source",
				encodingMode: "balanced",
			}),
		).toBe(9_600_000);
	});

	it("raises high-resolution 60fps source-quality exports above the 30fps budget", () => {
		const sharedOptions = {
			width: 2560,
			height: 1440,
			quality: "source" as const,
			encodingMode: "quality" as const,
		};

		const thirtyFpsBitrate = getMp4ExportBitrate({
			...sharedOptions,
			frameRate: 30,
		});
		const sixtyFpsBitrate = getMp4ExportBitrate({
			...sharedOptions,
			frameRate: 60,
		});

		expect(thirtyFpsBitrate).toBe(20_555_556);
		expect(sixtyFpsBitrate).toBeGreaterThan(thirtyFpsBitrate);
		expect(sixtyFpsBitrate).toBe(29_069_946);
	});

	it("keeps modern native static-layout source exports high enough for screen text", () => {
		expect(
			getMp4ExportBitrate({
				width: 1920,
				height: 1080,
				frameRate: 30,
				quality: "source",
				encodingMode: "balanced",
				useModernNativeStaticLayout: true,
			}),
		).toBe(9_600_000);
		expect(
			getMp4ExportBitrate({
				width: 1920,
				height: 1080,
				frameRate: 30,
				quality: "source",
				encodingMode: "quality",
				useModernNativeStaticLayout: true,
			}),
		).toBe(12_000_000);
	});

	it("scales modern native static-layout source exports at 60fps", () => {
		const sharedOptions = {
			width: 1920,
			height: 1080,
			quality: "source" as const,
			encodingMode: "quality" as const,
			useModernNativeStaticLayout: true,
		};

		const thirtyFpsBitrate = getMp4ExportBitrate({
			...sharedOptions,
			frameRate: 30,
		});
		const sixtyFpsBitrate = getMp4ExportBitrate({
			...sharedOptions,
			frameRate: 60,
		});

		expect(thirtyFpsBitrate).toBe(12_000_000);
		expect(sixtyFpsBitrate).toBeGreaterThan(thirtyFpsBitrate);
		expect(sixtyFpsBitrate).toBe(16_970_563);
	});

	it("does not raise fast exports when the requested bitrate is already lower than the cap", () => {
		expect(
			getMp4ExportBitrate({
				width: 1920,
				height: 1080,
				frameRate: 30,
				quality: "source",
				encodingMode: "fast",
				useModernNativeStaticLayout: true,
			}),
		).toBe(6_000_000);
	});

	it("scales the modern native cap with output pixel rate", () => {
		expect(
			getMp4ExportBitrate({
				width: 3840,
				height: 2160,
				frameRate: 30,
				quality: "source",
				encodingMode: "quality",
				useModernNativeStaticLayout: true,
			}),
		).toBe(45_000_000);
	});
});
