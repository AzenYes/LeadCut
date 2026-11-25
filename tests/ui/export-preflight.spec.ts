import { expect, test, type Page } from "@playwright/test";
import { installDesktopBridge, installDesktopBridgeOverrides } from "./bridge";

async function loadEditor(page: Page, status: "off" | "confirm" | "stale" | "disk" | "font") {
	await installDesktopBridge(page, "waveform.mp4");
	await installDesktopBridgeOverrides(page, (status) => {
		const clipRegions = [{ id: "screen", startMs: 0, endMs: 6000, sourceStartMs: 0, speed: 1 }];
		const project = {
			version: 2, projectId: "preflight",
			videoPath: `${location.origin}/tests/ui/fixtures/waveform.mp4`,
			editor: {
				clipRegions,
				chapterProgress: { enabled: false, confirmed: false, chapters: [{ id: "chapter", title: "Start", startMs: 0, endMs: 6000 }] },
				...(status === "font" ? {
					autoCaptionSettings: { enabled: true, fontFamily: "Missing Test Font" },
					autoCaptions: [{ id: "cue", startMs: 0, endMs: 1000, text: "Test" }],
				} : {}),
			},
		};
		const writes: string[] = [];
		Object.assign(window, { preflightPaths: writes, queryLocalFonts: async () => [{ family: "Microsoft YaHei" }] });
		window.electronAPI.loadCurrentProjectFile = async () => ({ success: true, path: "/projects/preflight.leadcut", project });
		window.electronAPI.saveProjectFile = async (data) => {
			sessionStorage.setItem("preflight-project", JSON.stringify(data));
			return { success: true, projectId: data.projectId, path: "/projects/preflight.leadcut" };
		};
		window.electronAPI.chooseExportPath = async () => {
			const path = `/exports/movie-${writes.length + 1}.mp4`;
			writes.push(path);
			return status === "disk" ? { success: true, path } : { success: false, canceled: true };
		};
		window.electronAPI.getExportDiskSpace = async () => ({ targetFreeBytes: 1, tempFreeBytes: 2 });
	}, status);
	await page.goto("/?windowType=editor");
	await expect(page.locator('[data-region-id="screen"]')).toHaveCount(1);
	await expect(page.getByLabel("Loading preview", { exact: true })).toHaveCount(0);
	if (status === "confirm" || status === "stale") {
		await page.getByRole("radio", { name: "Chapters", exact: true }).click();
		await page.getByRole("button", { name: "Confirm chapters and enable", exact: true }).click();
		if (status === "stale") {
			const timecode = page.getByRole("textbox", { name: "Timeline timecode" });
			await timecode.fill("00:00:02.000");
			await timecode.press("Enter");
			await page.keyboard.press("F2");
			await expect(page.locator('[data-variant="clip"][data-region-id]')).toHaveCount(2);
		}
	}
	await page.getByRole("button", { name: "Export video", exact: true }).click();
	await page.getByRole("button", { name: "Export MP4", exact: true }).click();
}

const pathsChosen = (page: Page) => page.evaluate(() => (window as Window & { preflightPaths: string[] }).preflightPaths.length);

test("blocks stale chapters before choosing a path, then saves the decision and continues", async ({ page }) => {
	await loadEditor(page, "stale");
	const checks = page.getByRole("region", { name: "Export checks" });
	await expect(checks).toContainText("The timeline has changed");
	expect(await pathsChosen(page)).toBe(0);
	await checks.getByRole("button", { name: "Turn off chapters and export" }).click();
	await expect.poll(() => pathsChosen(page)).toBe(1);
	await expect.poll(() => page.evaluate(() => JSON.parse(sessionStorage.getItem("preflight-project") ?? "{}").editor?.chapterProgress.enabled)).toBe(false);
});

test("proceeds straight to the picker when chapters are confirmed", async ({ page }) => {
	await loadEditor(page, "confirm");
	await expect.poll(() => pathsChosen(page)).toBe(1);
	await expect(page.getByRole("region", { name: "Export checks" })).toHaveCount(0);
});

test("reports the selected missing font before opening the picker", async ({ page }) => {
	await loadEditor(page, "font");
	const checks = page.getByRole("region", { name: "Export checks" });
	await expect(checks).toContainText("Missing Test Font is unavailable");
	expect(await pathsChosen(page)).toBe(0);
	await checks.getByRole("button", { name: "Export anyway" }).click();
	await expect.poll(() => pathsChosen(page)).toBe(1);
});

test("reports low space in both folders and can pick another location", async ({ page }) => {
	await loadEditor(page, "disk");
	const checks = page.getByRole("region", { name: "Export checks" });
	await expect(checks).toContainText("Export folder has");
	await expect(checks).toContainText("Temporary folder has");
	expect(await pathsChosen(page)).toBe(1);
	await checks.getByRole("button", { name: "Choose another location" }).click();
	await expect.poll(() => pathsChosen(page)).toBe(2);
	await expect(checks).toBeVisible();
});

test("cancelling export keeps the paused preview frame without seeking again", async ({ page }) => {
	await installDesktopBridge(page, "waveform.mp4");
	await installDesktopBridgeOverrides(page, () => {
		window.electronAPI.chooseExportPath = async () => ({ success: true, path: "/exports/paused.mp4" });
		window.electronAPI.getExportDiskSpace = async () => ({ targetFreeBytes: 10e9, tempFreeBytes: 10e9 });
	});
	await page.route(/\/src\/lib\/exporter\/(?:documentVideoExporter|modernVideoExporter|videoExporter)\.ts(?:\?.*)?$/, route => route.fulfill({
		contentType: "text/javascript",
		body: `
			class PendingExporter {
				export() {
					document.body.dataset.testExport = "started";
					return new Promise(resolve => { this.finish = resolve; });
				}
				cancel() { this.finish({ success: false, error: "Export cancelled" }); }
			}
			export { PendingExporter as DocumentVideoExporter, PendingExporter as ModernVideoExporter, PendingExporter as VideoExporter };
		`,
	}));
	await page.goto("/?windowType=editor");
	await expect(page.getByLabel("Loading preview", { exact: true })).toHaveCount(0);
	const video = page.locator('video[src*="waveform.mp4"]');
	await expect.poll(() => video.evaluate(element => (element as HTMLVideoElement).readyState)).toBeGreaterThanOrEqual(2);
	const timecode = page.getByRole("textbox", { name: "Timeline timecode" });
	await timecode.fill("00:00:02.000");
	await timecode.press("Enter");
	await expect.poll(() => video.evaluate(element => {
		const media = element as HTMLVideoElement;
		return media.paused && !media.seeking ? media.currentTime : -1;
	})).toBeCloseTo(2, 2);

	const exportButton = page.getByRole("button", { name: "Export video", exact: true });
	await exportButton.click();
	const startExport = page.getByRole("button", { name: "Export MP4", exact: true });
	await startExport.click();
	await expect(page.locator("body")).toHaveAttribute("data-test-export", "started");
	await video.evaluate(media => {
		media.setAttribute("data-test-seeks", "0");
		media.addEventListener("seeking", () => media.setAttribute("data-test-seeks", "1"), { once: true });
	});
	await page.getByRole("button", { name: "Cancel", exact: true }).click();
	await expect(startExport).toBeHidden();
	await exportButton.click();
	await expect(startExport).toBeVisible({ timeout: 3000 });
	await expect(video).toHaveAttribute("data-test-seeks", "0");
	expect(await video.evaluate(element => {
		const media = element as HTMLVideoElement;
		return { paused: media.paused, time: media.currentTime };
	})).toEqual({ paused: true, time: 2 });
});

test("finishing export resumes the preview when it was playing", async ({ page }) => {
	await installDesktopBridge(page, "waveform.mp4");
	await installDesktopBridgeOverrides(page, () => {
		window.electronAPI.chooseExportPath = async () => ({ success: true, path: "/exports/playing.mp4" });
		window.electronAPI.getExportDiskSpace = async () => ({ targetFreeBytes: 10e9, tempFreeBytes: 10e9 });
		window.electronAPI.finalizeExportedVideo = async () => ({ success: true, path: "/exports/playing.mp4" });
	});
	await page.route(/\/src\/lib\/exporter\/(?:documentVideoExporter|modernVideoExporter|videoExporter)\.ts(?:\?.*)?$/, route => route.fulfill({
		contentType: "text/javascript",
		body: `
			class PendingExporter {
				export() {
					document.body.dataset.testExport = "started";
					return new Promise(resolve => {
						document.addEventListener("finish-test-export", () => resolve({ success: true, tempFilePath: "/tmp/playing.mp4" }), { once: true });
					});
				}
			}
			export { PendingExporter as DocumentVideoExporter, PendingExporter as ModernVideoExporter, PendingExporter as VideoExporter };
		`,
	}));
	await page.goto("/?windowType=editor");
	await expect(page.getByLabel("Loading preview", { exact: true })).toHaveCount(0);
	const video = page.locator('video[src*="waveform.mp4"]');
	const position = () => video.evaluate(media => (media as HTMLVideoElement).currentTime);
	await expect.poll(() => video.evaluate(media => (media as HTMLVideoElement).readyState)).toBeGreaterThanOrEqual(2);
	await page.getByRole("button", { name: "Play", exact: true }).click();
	await expect.poll(position).toBeGreaterThan(0.1);

	await page.getByRole("button", { name: "Export video", exact: true }).click();
	await page.getByRole("button", { name: "Export MP4", exact: true }).click();
	await expect(page.locator("body")).toHaveAttribute("data-test-export", "started");
	await expect.poll(() => video.evaluate(media => (media as HTMLVideoElement).paused)).toBe(true);
	const pausedAt = await position();
	await page.evaluate(() => document.dispatchEvent(new Event("finish-test-export")));

	await expect(page.getByRole("button", { name: "Pause", exact: true })).toBeVisible();
	await expect.poll(position).toBeGreaterThan(pausedAt + 0.1);
});
