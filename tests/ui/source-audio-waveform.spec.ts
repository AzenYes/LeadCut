import { expect, type Locator, test } from "@playwright/test";
import { installDesktopBridge, installDesktopBridgeOverrides } from "./bridge";

declare global {
	interface Window {
		__sourceAudioElements: HTMLAudioElement[];
	}
}

test("microphone preview honors the companion start delay when seeking and playing", async ({ page }) => {
	await installDesktopBridge(page, "waveform.mp4");
	await page.route(/waveform\.mic\.wav(?:\?|$)/, route => route.continue({
		url: route.request().url().replace("waveform.mic.wav", "waveform.mp4"),
	}));
	await installDesktopBridgeOverrides(page, () => {
		const mediaPath = `${location.origin}/tests/ui/fixtures/waveform.mic.wav`;
		window.electronAPI.getVideoAudioFallbackPaths = async () => ({
			success: true, paths: [mediaPath], startDelayMsByPath: { [mediaPath]: 1140 },
		});
		window.__sourceAudioElements = [];
		window.Audio = new Proxy(window.Audio, { construct(target, args) {
			const audio: HTMLAudioElement = Reflect.construct(target, args);
			window.__sourceAudioElements.push(audio);
			return audio;
		} });
	});
	await page.goto("/?windowType=editor");
	await expect(page.locator('[data-variant="clip"]')).toHaveCount(1, { timeout: 20000 });
	await expect(page.getByLabel("Loading preview", { exact: true })).toHaveCount(0, { timeout: 20000 });
	await expect(page.locator('[data-timeline-row="row-source-audio-mic"] [data-source-audio-clip]')).toBeVisible();
	const timecode = page.getByRole("textbox", { name: "Timeline timecode", exact: true });
	await timecode.fill("00:00:02.500");
	await timecode.press("Enter");
	await expect(timecode).toHaveValue("00:00:02.500");
	const readClocks = () => page.evaluate(() => {
		const mic = window.__sourceAudioElements.find(audio => audio.dataset.sourceAudioPath?.includes(".mic."));
		const video = document.querySelector<HTMLVideoElement>('video[aria-hidden="true"]');
		return mic && video && mic.readyState >= 2 && !mic.seeking && !video.seeking
			? { delta: video.currentTime - mic.currentTime, videoTime: video.currentTime, playing: !mic.paused && !video.paused }
			: null;
	});
	await expect.poll(async () => {
		const clocks = await readClocks();
		return clocks && clocks.videoTime >= 2.49 ? Math.abs(clocks.delta - 1.14) : Infinity;
	}, { timeout: 15000 }).toBeLessThan(0.15);
	await page.getByRole("button", { name: "Play", exact: true }).click();
	await expect.poll(async () => {
		const clocks = await readClocks();
		return clocks?.playing ? Math.abs(clocks.delta - 1.14) : Infinity;
	}).toBeLessThan(0.15);
});

test("system audio range deletion preserves mic, picture and timing through preview, undo and reopening", async ({ page }) => {
	test.setTimeout(90000);
	await installDesktopBridge(page, "waveform.mp4");
	await page.route(/waveform\.(system|mic)\.wav/, (route) => route.fulfill({ path: "tests/ui/fixtures/waveform.mp4", contentType: "audio/mp4" }));
	await page.addInitScript(() => {
		const NativeAudio = window.Audio;
		const audioElements: HTMLAudioElement[] = [];
		window.__sourceAudioElements = audioElements;
		window.Audio = new Proxy(NativeAudio, { construct(target, args) {
			const audio = Reflect.construct(target, args) as HTMLAudioElement;
			audioElements.push(audio);
			return audio;
		} });
		const videoPath = `${location.origin}/tests/ui/fixtures/waveform.mp4`;
		window.electronAPI.getVideoAudioFallbackPaths = async () => ({ success: true, paths: [videoPath.replace(".mp4", ".system.wav"), videoPath.replace(".mp4", ".mic.wav")] });
		window.electronAPI.loadCurrentProjectFile = async () => ({
			success: true, path: "/projects/audio-delete.leadcut", project: JSON.parse(sessionStorage.getItem("audio-delete") || JSON.stringify({
				version: 2, projectId: "audio-delete", videoPath,
				editor: { clipRegions: [{ id: "clip", startMs: 0, endMs: 6000, sourceStartMs: 0, speed: 1 }] },
			})),
		});
		window.electronAPI.saveProjectFile = async (project) => {
			sessionStorage.setItem("audio-delete", JSON.stringify(project));
			return { success: true, path: "/projects/audio-delete.leadcut" };
		};
	});
	await page.goto("/?windowType=editor");
	const system = page.locator('[data-timeline-row="row-source-audio-system"] [data-source-audio-clip]');
	const mic = page.locator('[data-timeline-row="row-source-audio-mic"] [data-source-audio-clip]');
	await expect(system).toBeVisible({ timeout: 20000 });
	await expect(mic).toBeVisible();
	const clip = page.locator('[data-variant="clip"]');
	await clip.click({ position: { x: 20, y: 20 } });
	const originalWidth = (await clip.boundingBox())!.width;
	const box = (await system.boundingBox())!;
	await page.mouse.move(box.x + box.width / 6, box.y + 12);
	await page.mouse.down();
	await page.mouse.move(box.x + box.width / 3, box.y + 12, { steps: 8 });
	await page.mouse.up();
	await expect(system.locator("[data-source-audio-selection]")).toBeVisible();
	await page.keyboard.press("Delete");
	await expect(system.locator("[data-source-audio-audible]")).toHaveCount(2);
	await expect(mic).toHaveAttribute("data-deleted-ranges", "[]");
	await expect(clip).toHaveCount(1);
	expect((await clip.boundingBox())!.width).toBeCloseTo(originalWidth, 1);
	const deleted = JSON.parse((await system.getAttribute("data-deleted-ranges"))!);
	expect(deleted[0].startMs).toBeCloseTo(1000, -1);
	expect(deleted[0].endMs).toBeCloseTo(2000, -1);
	const timecode = page.getByRole("textbox", { name: "Timeline timecode", exact: true });
	await timecode.fill("00:00:01.500");
	await timecode.press("Enter");
	const sourceVolume = (suffix: string) => page.evaluate((suffix) => window.__sourceAudioElements.find((audio) => audio.dataset.sourceAudioPath?.includes(suffix))?.volume, suffix);
	await expect.poll(() => sourceVolume(".system.")).toBe(0);
	await expect.poll(() => sourceVolume(".mic.")).toBe(1);
	await timecode.fill("00:00:02.500");
	await timecode.press("Enter");
	await expect.poll(() => sourceVolume(".system.")).toBe(1);
	await page.locator("[data-timeline-panel]").focus();
	await page.keyboard.press("Meta+z");
	await expect(system).toHaveAttribute("data-deleted-ranges", "[]");
	await page.keyboard.press("Meta+Shift+z");
	await expect(system).toHaveAttribute("data-deleted-ranges", JSON.stringify(deleted));
	await expect.poll(() => page.evaluate(() => JSON.parse(sessionStorage.getItem("audio-delete") || "{}").editor?.sourceAudioTrackSettingsByClip?.clip?.system?.deletedRanges)).toEqual(deleted);
	await page.reload();
	await expect(system).toHaveAttribute("data-deleted-ranges", JSON.stringify(deleted), { timeout: 20000 });
	await expect(mic).toHaveAttribute("data-deleted-ranges", "[]");
	await system.dblclick({ position: { x: box.width / 2, y: 12 } });
	await system.getByRole("button", { name: "Delete selected audio", exact: true }).click();
	await expect(system.locator("[data-source-audio-audible]")).toHaveCount(0);
	await expect(mic.locator("[data-source-audio-audible]")).toHaveCount(1);
	await expect(clip).toHaveCount(1);
});

async function inkAt(waveform: Locator, fraction: number) {
	return waveform.evaluate((clip, fraction) => {
		const canvas = clip.parentElement!.querySelector<HTMLCanvasElement>("[data-source-audio-waveform]")!;
		const context = canvas.getContext("2d")!;
		const bounds = canvas.getBoundingClientRect();
		const clipBounds = clip.getBoundingClientRect();
		const clipX = clipBounds.left + clipBounds.width * fraction - bounds.left;
		const x = Math.min(canvas.width - 1, Math.floor(clipX / bounds.width * canvas.width));
		const pixels = context.getImageData(x, 0, 1, canvas.height).data;
		let ink = 0;
		for (let y = 0; y < canvas.height; y++) {
			if (Math.abs(y - canvas.height / 2) > 2 && pixels[y * 4 + 3] > 0) ink++;
		}
		return ink;
	}, fraction);
}

test("embedded speech waveform is automatic, silence stays flat, and clicking seeks", async ({
	page,
}) => {
	await installDesktopBridge(page, "waveform.mp4");
	const sidecarRequests: string[] = [];
	page.on("request", request => {
		if (/waveform\.(system|mic)\./.test(request.url())) sidecarRequests.push(request.url());
	});
	await page.goto("/?windowType=editor");
	const waveform = page.locator("[data-source-audio-clip]");
	await expect(waveform).toBeVisible({ timeout: 20000 });
	expect(sidecarRequests).toEqual([]);
	await expect.poll(() => inkAt(waveform, 0.1)).toBeGreaterThan(8);
	await expect.poll(() => inkAt(waveform, 0.25)).toBe(0);
	await expect.poll(() => waveform.evaluate(element => Math.abs(element.getBoundingClientRect().width - element.parentElement!.getBoundingClientRect().width))).toBeLessThan(1);
	const waveBox = (await waveform.boundingBox())!;
	const clipBox = (await page.locator('[data-variant="clip"]').boundingBox())!;
	expect(waveBox.x).toBeCloseTo(clipBox.x, 0);
	expect(waveBox.width).toBeCloseTo(clipBox.width, 0);
	await page.mouse.click(waveBox.x + waveBox.width / 2, waveBox.y + 12);
	await expect
		.poll(() =>
			page
				.locator('video[aria-hidden="true"]')
				.evaluate((video: HTMLVideoElement) => video.currentTime),
		)
		.toBeCloseTo(3, 1);
	await page.screenshot({
		path: "test-results/source-audio-waveform.png",
		animations: "disabled",
	});
});

test("split, speed changes, deletion and undo preserve source audio alignment", async ({
	page,
}) => {
	await installDesktopBridge(page, "waveform.mp4");
	await page.goto("/?windowType=editor");
	const clips = page.locator('[data-variant="clip"]');
	const waves = page.locator("[data-source-audio-clip]");
	await expect(waves).toBeVisible({ timeout: 20000 });
	const box = (await waves.boundingBox())!;
	await waves.click({ position: { x: box.width / 2, y: 12 } });
	await page.getByRole("button", { name: "Split Clip (F2)", exact: true }).click();
	await expect(waves).toHaveCount(2);
	await expect(page.locator("[data-source-audio-waveform]")).toHaveCount(1);
	const sourceStart = await waves.nth(1).getAttribute("data-source-start-ms");
	const sourceEnd = await waves.nth(1).getAttribute("data-source-end-ms");
	const clipWidth = (await clips.nth(1).boundingBox())!.width;
	await clips.nth(1).click({ position: { x: 40, y: 20 } });
	const speed = page.getByRole("slider", { name: "Speed", exact: true });
	await speed.focus();
	while (Number(await speed.inputValue()) < 2) await speed.press("ArrowRight");
	await expect(waves.nth(1)).toHaveAttribute("data-source-start-ms", sourceStart!);
	// Timeline speed edits round to whole milliseconds, within one frame of source time.
	expect(
		Math.abs(Number(await waves.nth(1).getAttribute("data-source-end-ms")) - Number(sourceEnd)),
	).toBeLessThanOrEqual(4);
	expect((await waves.nth(1).boundingBox())!.width).toBeLessThan(clipWidth);
	for (let index = 0; index < 2; index++) {
		const clip = (await clips.nth(index).boundingBox())!;
		const wave = (await waves.nth(index).boundingBox())!;
		expect(wave.x).toBeCloseTo(clip.x, 0);
		expect(wave.width).toBeCloseTo(clip.width, 0);
	}
	await clips.first().click({ position: { x: 40, y: 20 } });
	await page.keyboard.press("Delete");
	await expect(waves).toHaveCount(1);
	await expect(waves).toHaveAttribute("data-source-start-ms", sourceStart!);
	await page.locator("[data-timeline-panel]").focus();
	await page.keyboard.press("Meta+z");
	await expect(waves).toHaveCount(2);
});

test("video with no audio does not show an empty waveform lane", async ({ page }) => {
	await installDesktopBridge(page, "preview.mp4");
	await page.goto("/?windowType=editor");
	await expect(page.locator('[data-variant="clip"]')).toBeVisible({ timeout: 20000 });
	await expect(page.getByLabel("Loading preview")).toHaveCount(0);
	await expect(page.locator("[data-source-audio-clip]")).toHaveCount(0);
});
