import { expect, test } from "@playwright/test";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { installDesktopBridge } from "./bridge";

function toneWav(frequency: number) {
	const sampleRate = 48000;
	const frames = sampleRate * 3;
	const wav = Buffer.alloc(44 + frames * 2);
	wav.write("RIFF", 0);
	wav.writeUInt32LE(wav.length - 8, 4);
	wav.write("WAVEfmt ", 8);
	wav.writeUInt32LE(16, 16);
	wav.writeUInt16LE(1, 20);
	wav.writeUInt16LE(1, 22);
	wav.writeUInt32LE(sampleRate, 24);
	wav.writeUInt32LE(sampleRate * 2, 28);
	wav.writeUInt16LE(2, 32);
	wav.writeUInt16LE(16, 34);
	wav.write("data", 36);
	wav.writeUInt32LE(frames * 2, 40);
	for (let frame = 0; frame < frames; frame++)
		wav.writeInt16LE(
			Math.round(6000 * Math.sin((2 * Math.PI * frequency * frame) / sampleRate)),
			44 + frame * 2,
		);
	return wav;
}

for (const backend of ["modern", "legacy"] as const) {
	test(`source audio deletion survives ${backend} MP4 export with the mic intact`, async ({
		page,
	}, testInfo) => {
		test.setTimeout(90000);
		page.on("console", (message) => {
			if (message.type() === "error" || message.text().includes("[AudioProcessor]"))
				console.log(message.text());
		});
		await installDesktopBridge(page, "broll-blue.mp4");
		fs.writeFileSync(testInfo.outputPath("delete.system.wav"), toneWav(440));
		fs.writeFileSync(testInfo.outputPath("delete.mic.wav"), toneWav(880));
		const audioRoot = `/${path.relative(process.cwd(), path.dirname(testInfo.outputPath("delete.system.wav"))).replaceAll("\\", "/")}/`;
		await page.goto("/?windowType=editor");
		await expect(page.locator('[data-variant="clip"]')).toHaveCount(1, { timeout: 20000 });
		const bytes = await page.evaluate(
			async ({ backend, audioRoot }) => {
				const { ModernVideoExporter } = await import(
					"/src/lib/exporter/modernVideoExporter.ts"
				);
				const { VideoExporter } = await import("/src/lib/exporter/videoExporter.ts");
				const root = `${location.origin}/tests/ui/fixtures/`;
				const Exporter = backend === "modern" ? ModernVideoExporter : VideoExporter;
				const exporter = new Exporter({
					width: 320,
					height: 180,
					frameRate: 15,
					bitrate: 1500000,
					codec: "avc1.42001f",
					backendPreference: "webcodecs",
					preferredRenderBackend: "webgl",
					videoUrl: `${root}broll-blue.mp4`,
					wallpaper: "#000000",
					showShadow: false,
					shadowIntensity: 0,
					backgroundBlur: 0,
					cropRegion: { x: 0, y: 0, width: 1, height: 1 },
					padding: 0,
					zoomRegions: [],
					showCursor: false,
					clipRegions: [
						{ id: "screen", startMs: 0, endMs: 3000, sourceStartMs: 0, speed: 1 },
					],
					sourceAudioFallbackPaths: [
						`${location.origin}${audioRoot}delete.system.wav`,
						`${location.origin}${audioRoot}delete.mic.wav`,
					],
					sourceAudioTrackSettingsByClip: {
						screen: {
							system: {
								volume: 1,
								normalize: false,
								deletedRanges: [{ startMs: 1000, endMs: 2000 }],
							},
						},
					},
				});
				const result = await exporter.export();
				if (!result.success || !result.blob)
					throw new Error(result.error || "No exported blob");
				return Array.from(new Uint8Array(await result.blob.arrayBuffer()));
			},
			{ backend, audioRoot },
		);
		const destination = testInfo.outputPath(`${backend}-audio-delete.mp4`);
		fs.writeFileSync(destination, Buffer.from(bytes));
		const ffmpeg = path.resolve("node_modules/ffmpeg-static/ffmpeg.exe");
		const amplitude = (time: number, frequency: number) => {
			const pcm = execFileSync(
				ffmpeg,
				[
					"-v",
					"error",
					"-ss",
					String(time),
					"-t",
					"0.3",
					"-i",
					destination,
					"-vn",
					"-ac",
					"1",
					"-ar",
					"48000",
					"-f",
					"s16le",
					"-",
				],
				{ windowsHide: true },
			);
			let sin = 0;
			let cos = 0;
			const frames = pcm.length / 2;
			for (let frame = 0; frame < frames; frame++) {
				const sample = pcm.readInt16LE(frame * 2) / 32768;
				sin += sample * Math.sin((2 * Math.PI * frequency * frame) / 48000);
				cos += sample * Math.cos((2 * Math.PI * frequency * frame) / 48000);
			}
			return (2 * Math.hypot(sin, cos)) / frames;
		};
		for (const time of [0.3, 2.3]) expect(amplitude(time, 440)).toBeGreaterThan(0.1);
		expect(amplitude(1.3, 440)).toBeLessThan(0.002);
		for (const time of [0.3, 1.3, 2.3]) expect(amplitude(time, 880)).toBeGreaterThan(0.1);
	});
}
