import { expect, test } from "@playwright/test";
import { installDesktopBridge, installDesktopBridgeOverrides } from "./bridge";
import { execFileSync } from "node:child_process";
import path from "node:path";

declare global {
	interface Window {
		layerVideos: HTMLVideoElement[];
	}
}

test.beforeEach(async ({ page }) => {
	await installDesktopBridge(page, "filmstrip.mp4");
	await page.goto("/?windowType=editor");
	await expect(page.locator('[data-variant="clip"]')).toHaveCount(1, { timeout: 20000 });
	await expect(page.getByLabel("Loading preview", { exact: true })).toHaveCount(0, { timeout: 20000 });
});

test("timeline resizes, seeks precisely, cuts and ripple-deletes with F2/F3", async ({ page }) => {
	const resize = page.getByRole("separator", { name: "Resize timeline" });
	const initial = Number(await resize.getAttribute("aria-valuenow"));
	const box = (await resize.boundingBox())!;
	await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
	await page.mouse.down(); await page.mouse.move(box.x + box.width / 2, box.y - 150); await page.mouse.up();
	await expect.poll(async () => Number(await resize.getAttribute("aria-valuenow"))).toBeGreaterThan(initial + 100);
	const timecode = page.getByRole("textbox", { name: "Timeline timecode", exact: true });
	await timecode.fill("00:00:02.125"); await timecode.press("Enter");
	await expect(timecode).toHaveValue("00:00:02.125");
	await page.keyboard.press("F2");
	const clips = page.locator('[data-variant="clip"]');
	await expect(clips).toHaveCount(2);
	await expect(clips.nth(0)).toHaveAttribute("data-end-ms", "2125");
	const left = (await clips.nth(0).boundingBox())!, right = (await clips.nth(1).boundingBox())!;
	expect(Math.abs(right.x - (left.x + left.width))).toBeLessThan(2);
	await clips.nth(0).click({ position: { x: 40, y: 20 } });
	await page.keyboard.press("F3");
	await expect(clips).toHaveCount(1);
	await expect(clips.first()).toHaveAttribute("data-start-ms", "0");
	await expect(clips.first()).toHaveAttribute("data-end-ms", "3875");
	await page.keyboard.press("Meta+z");
	await expect(clips).toHaveCount(2);
});

test("L shuttles forward while keeping the authored cut timing", async ({ page }) => {
	await page.locator('[data-timeline-panel]').focus();
	await page.keyboard.press("L");
	await expect(page.getByRole("button", { name: "Pause", exact: true })).toBeVisible();
	await page.keyboard.press("L");
	const rate = () => page.locator('video[aria-hidden="true"]').evaluate((video: HTMLVideoElement) => video.playbackRate);
	await expect.poll(rate).toBe(2);
	await expect(page.getByRole("combobox", { name: "Review playback speed" })).toHaveValue("1");
	await page.keyboard.press("Space");
	await expect(page.getByRole("button", { name: "Play", exact: true })).toBeVisible();
	await expect.poll(rate).toBe(1);
	await expect(page.locator('[data-variant="clip"]')).toHaveAttribute("data-end-ms", "6000");
});

test("imports B-roll into an independent track and undoes its split", async ({ page }) => {
	const errors: string[] = []; page.on("pageerror", (error) => errors.push(error.message));
	await page.evaluate(() => { window.electronAPI.openVideoFilePicker = async () => ({ success: true, path: `${location.origin}/tests/ui/fixtures/filmstrip.mp4` }); });
	await page.getByRole("button", { name: "Import B-roll", exact: true }).click();
	const video = page.locator('[data-variant="video"]');
	await expect(video).toHaveCount(1);
	await expect(page.locator('[data-variant="clip"]')).toHaveCount(1);
	const timecode = page.getByRole("textbox", { name: "Timeline timecode", exact: true });
	await timecode.fill("00:00:01.500"); await timecode.press("Enter");
	await video.click({ position: { x: 30, y: 20 } });
	await page.keyboard.press("F2");
	await expect(video).toHaveCount(2);
	await expect(page.locator('[data-variant="clip"]')).toHaveCount(1);
	await page.keyboard.press("Meta+z");
	await expect(video).toHaveCount(1);
	await page.screenshot({ path: "test-results/professional-multitrack.png" });
	expect(errors).toEqual([]);
});

test("preview detaches and docks using the same editor transport", async ({ page, context }) => {
	const popupPromise = context.waitForEvent("page");
	await page.getByRole("button", { name: "Detach preview", exact: true }).click();
	const popup = await popupPromise;
	await expect(popup.getByRole("button", { name: "Dock preview", exact: true })).toBeVisible();
	await expect(popup.locator("canvas")).toHaveCount(1, { timeout: 20000 });
	await page.getByRole("textbox", { name: "Timeline timecode", exact: true }).fill("00:00:01.234");
	await page.getByRole("textbox", { name: "Timeline timecode", exact: true }).press("Enter");
	await expect.poll(() => page.locator('video[aria-hidden="true"]').first().evaluate((video: HTMLVideoElement) => video.currentTime)).toBeCloseTo(1.234, 2);
	await popup.getByRole("button", { name: "Dock preview", exact: true }).click();
	await expect(page.getByRole("button", { name: "Detach preview", exact: true })).toBeVisible();
	await expect(page.locator(".editor-preview-stage canvas")).toHaveCount(1, { timeout: 20000 });
});

test("moving a playing preview retains its video and GPU canvas through repeated docking and window close", async ({ page, context }) => {
	test.setTimeout(120000);
	await installDesktopBridgeOverrides(page, () => {
		window.electronAPI.loadCurrentProjectFile = async () => ({
			success: true, path: "/projects/Long preview.leadcut", project: {
				version: 2, projectId: "long-dock-preview",
				videoPath: `${location.origin}/tests/ui/fixtures/filmstrip.mp4`,
				editor: { clipRegions: Array.from({ length: 10 }, (_, index) => ({
					id: `clip-${index}`, startMs: index * 6000, endMs: (index + 1) * 6000, sourceStartMs: 0, speed: 1,
				})) },
			},
		});
	});
	await page.reload();
	await expect(page.locator('[data-variant="clip"]')).toHaveCount(10, { timeout: 20000 });
	await expect(page.getByLabel("Loading preview", { exact: true })).toHaveCount(0, { timeout: 20000 });
	const errors: string[] = []; page.on("pageerror", (error) => errors.push(error.message));
	await page.locator(".editor-preview-stage canvas").evaluate((canvas) => { canvas.dataset.previewIdentity = "original-gpu-canvas"; });
	await page.locator("video").first().evaluate((video) => { video.dataset.previewIdentity = "original-video"; });
	for (let cycle = 0; cycle < 4; cycle++) {
		const timecode = page.getByRole("textbox", { name: "Timeline timecode", exact: true });
		await timecode.fill("00:00:00.500"); await timecode.press("Enter");
		await page.getByRole("button", { name: "Play", exact: true }).click();
		const next = context.waitForEvent("page");
		await page.getByRole("button", { name: "Detach preview", exact: true }).click();
		const popup = await next;
		await expect(popup.locator("canvas")).toHaveAttribute("data-preview-identity", "original-gpu-canvas");
		const video = page.locator('video[data-preview-identity="original-video"]');
		await expect(video).toHaveAttribute("data-preview-identity", "original-video");
		const time = await video.evaluate((video: HTMLVideoElement) => video.currentTime);
		try {
			await expect.poll(() => video.evaluate((video: HTMLVideoElement) => video.currentTime)).toBeGreaterThan(time + 0.2);
		} catch (error) {
			console.log("MOVE-DIAGNOSTIC", { cycle, parent: await page.getByRole("button", { name: /^(Play|Pause)$/ }).allTextContents(), media: await video.evaluate((video: HTMLVideoElement) => ({ paused: video.paused, readyState: video.readyState, seeking: video.seeking, currentTime: video.currentTime, owner: video.ownerDocument.URL, visibility: video.ownerDocument.visibilityState, error: video.error?.message })) });
			throw error;
		}
		await popup.setViewportSize({ width: 750 + cycle * 80, height: 500 + cycle * 40 });
		if (cycle % 2) await popup.close({ runBeforeUnload: true });
		else await popup.getByRole("button", { name: "Dock preview", exact: true }).click();
		await expect(page.locator(".editor-preview-stage canvas")).toHaveAttribute("data-preview-identity", "original-gpu-canvas");
		await page.getByRole("button", { name: "Pause", exact: true }).press("Space");
		await expect(page.getByRole("button", { name: "Play", exact: true })).toBeVisible();
	}
	expect(errors).toEqual([]);
});

test("A selects all footage after the pointer and F3 removes the selection as one edit", async ({ page }) => {
	const timecode = page.getByRole("textbox", { name: "Timeline timecode", exact: true });
	for (const position of ["00:00:02.000", "00:00:04.000"]) {
		await timecode.fill(position); await timecode.press("Enter"); await page.keyboard.press("F2");
	}
	const clips = page.locator('[data-variant="clip"]');
	await expect(clips).toHaveCount(3);
	await page.keyboard.press("A");
	await expect(page.getByRole("button", { name: "Select forward A", exact: true })).toHaveAttribute("aria-pressed", "true");
	const second = (await clips.nth(1).boundingBox())!;
	await page.mouse.click(second.x + 20, second.y + 20);
	await expect(page.locator('[data-variant="clip"][data-selected="true"]')).toHaveCount(2);
	await page.keyboard.press("F3");
	await expect(clips).toHaveCount(1);
	await expect(clips.first()).toHaveAttribute("data-end-ms", "2000");
	await page.keyboard.press("Meta+z");
	await expect(clips).toHaveCount(3);
});

test("canceling the destination dialog performs no video encoding", async ({ page }) => {
	await page.evaluate(() => {
		window.electronAPI.chooseExportPath = async () => { document.documentElement.dataset.destinationAsked = "true"; return { success: false, canceled: true }; };
		const Encoder = window.VideoEncoder;
		window.VideoEncoder = class extends Encoder { constructor(init: VideoEncoderInit) { super(init); document.documentElement.dataset.encodingStarted = "true"; } };
	});
	await page.getByRole("button", { name: "Export video", exact: true }).click();
	await page.getByRole("button", { name: "Export MP4", exact: true }).click();
	await expect(page.locator("html")).toHaveAttribute("data-destination-asked", "true");
	await expect(page.locator("html")).not.toHaveAttribute("data-encoding-started");
	await expect(page.getByRole("button", { name: "Export MP4", exact: true })).toBeEnabled();
});

test("paused B-roll paints immediately, stops its media clock and survives project reload", async ({ page }) => {
	const errors: string[] = []; page.on("pageerror", (error) => errors.push(error.message));
	await page.evaluate(() => {
		const create = document.createElement.bind(document);
		window.layerVideos = [];
		document.createElement = ((tag: string, options?: ElementCreationOptions) => {
			const element = create(tag, options);
			if (element instanceof HTMLVideoElement) window.layerVideos.push(element);
			return element;
		}) as typeof document.createElement;
		window.electronAPI.openVideoFilePicker = async () => ({ success: true, path: `${location.origin}/tests/ui/fixtures/broll-blue.mp4` });
		window.electronAPI.saveProjectFile = async (project, _name, projectPath) => {
			sessionStorage.setItem("multitrack-project", JSON.stringify(project));
			return { success: true, path: projectPath || "/projects/test.leadcut" };
		};
	});
	await page.getByRole("button", { name: "Import B-roll", exact: true }).click();
	await expect(page.locator('[data-variant="video"]')).toHaveCount(1);
	const canvas = page.locator(".editor-preview-stage canvas");
	const pixel = async () => {
		const png = await canvas.screenshot();
		return [...execFileSync(path.resolve("node_modules/ffmpeg-static/ffmpeg.exe"), ["-v", "error", "-i", "pipe:0", "-vf", "scale=1:1", "-f", "rawvideo", "-pix_fmt", "rgb24", "-"], { input: png, windowsHide: true })];
	};
	await expect.poll(async () => (await pixel())[2] - (await pixel())[0]).toBeGreaterThan(120);
	await page.locator('[data-timeline-panel]').focus(); await page.keyboard.press("L");
	await expect.poll(() => page.evaluate(() => window.layerVideos.some((video) => video.src.endsWith("broll-blue.mp4") && !video.paused))).toBe(true);
	await page.keyboard.press("Space");
	await expect.poll(() => page.evaluate(() => window.layerVideos.filter((video) => video.src.endsWith("broll-blue.mp4")).every((video) => video.paused))).toBe(true);
	await expect.poll(() => page.evaluate(() => JSON.parse(sessionStorage.getItem("multitrack-project") || "{}").editor?.videoRegions?.length)).toBe(1);
	await page.addInitScript(() => {
		window.electronAPI ??= {} as Window["electronAPI"];
		window.electronAPI.loadCurrentProjectFile = async () => ({ success: true, path: "/projects/test.leadcut", project: JSON.parse(sessionStorage.getItem("multitrack-project")!) });
	});
	await page.reload();
	await expect(page.locator('[data-variant="video"]')).toHaveCount(1, { timeout: 20000 });
	await expect(page.getByLabel("Loading preview", { exact: true })).toHaveCount(0, { timeout: 20000 });
	await expect.poll(async () => {
		const [red, , blue] = await pixel();
		return blue - red;
	}, { timeout: 15000 }).toBeGreaterThan(120);
	expect(errors).toEqual([]);
});

test("many video tracks remain scrollable with a full-height playhead", async ({ page }) => {
	for (let i = 0; i < 5; i++) await page.getByRole("button", { name: "+ Video track", exact: true }).click();
	await expect(page.locator('[data-timeline-row^="row-video:"]')).toHaveCount(5);
	const screen = page.locator('[data-timeline-row="row-clip"]');
	await screen.scrollIntoViewIfNeeded();
	await expect(screen).toBeInViewport();
	const top = page.locator('[data-timeline-row^="row-video:"]').first();
	await top.scrollIntoViewIfNeeded();
	await expect(top).toBeInViewport();
});

test("an existing webcam recording becomes an editable camera track with its original gaps", async ({ page }) => {
	await page.addInitScript(() => {
		window.electronAPI ??= {} as Window["electronAPI"];
		window.electronAPI.loadCurrentProjectFile = async () => ({ success: true, path: "/projects/camera.leadcut", project: { version: 2, projectId: "camera-project", videoPath: `${location.origin}/tests/ui/fixtures/filmstrip.mp4`, editor: {
			clipRegions: [{ id: "screen", startMs: 0, endMs: 6000, sourceStartMs: 0, speed: 1 }],
			webcam: { enabled: true, sourcePath: `${location.origin}/tests/ui/fixtures/webcam-red.mp4`, timeOffsetMs: 0, visibleRanges: [{ startMs: 0, endMs: 1000 }, { startMs: 2000, endMs: 3000 }] },
		} } });
	});
	await page.reload();
	const camera = page.locator('[data-variant="video"]');
	await expect(camera).toHaveCount(2, { timeout: 20000 });
	await expect(camera.nth(0)).toHaveAttribute("data-start-ms", "0");
	await expect(camera.nth(0)).toHaveAttribute("data-end-ms", "1000");
	await expect(camera.nth(1)).toHaveAttribute("data-start-ms", "2000");
	const timecode = page.getByRole("textbox", { name: "Timeline timecode", exact: true });
	await timecode.fill("00:00:00.500"); await timecode.press("Enter");
	await camera.nth(0).click({ position: { x: 25, y: 20 } }); await page.keyboard.press("F2");
	await expect(camera).toHaveCount(3);
	await expect(page.locator('[data-variant="clip"]')).toHaveCount(1);
	await page.keyboard.press("Meta+z");
	await expect(camera).toHaveCount(2);
});
