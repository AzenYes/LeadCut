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
