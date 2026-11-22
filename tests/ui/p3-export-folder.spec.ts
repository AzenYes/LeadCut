import { expect, test } from "@playwright/test";
import { installDesktopBridge, installDesktopBridgeOverrides } from "./bridge";

test("opens the folder after the selected MP4 has finished saving", async ({ page }) => {
	test.setTimeout(90000);
	await installDesktopBridge(page, "broll-blue.mp4");
	await installDesktopBridgeOverrides(page, () => {
		window.electronAPI.loadCurrentProjectFile = async () => ({ success: true, path: "/projects/reveal.leadcut", project: {
			version: 2, projectId: "reveal-export", videoPath: `${location.origin}/tests/ui/fixtures/broll-blue.mp4`,
			editor: { clipRegions: [{ id: "screen", startMs: 0, endMs: 1000, sourceStartMs: 0, speed: 1 }] },
		} });
		window.electronAPI.chooseExportPath = async () => ({ success: true, path: "/exports/finished.mp4" });
		window.electronAPI.writeExportedVideoToPath = async (bytes, file) => {
			if (!bytes.byteLength) return { success: false };
			sessionStorage.setItem("finishedExport", file);
			return { success: true, path: file };
		};
		window.electronAPI.getExportDiskSpace = async () => ({ targetFreeBytes: 10e9, tempFreeBytes: 10e9 });
		window.electronAPI.revealInFolder = async file => {
			if (sessionStorage.getItem("finishedExport") !== file) return { success: false };
			sessionStorage.setItem("revealedExport", file);
			return { success: true };
		};
	});
	await page.goto("/?windowType=editor");
	await expect(page.locator('[data-region-id="screen"]')).toHaveCount(1, { timeout: 20000 });
	await expect.poll(() => page.evaluate(() => [...document.querySelectorAll("video")].some(video => video.readyState >= 2)), { timeout: 20000 }).toBe(true);
	await expect(page.getByLabel("Loading preview", { exact: true })).toHaveCount(0, { timeout: 20000 });
	await page.getByRole("button", { name: "Export video", exact: true }).click();
	const autoReveal = page.getByRole("switch", { name: "Show the file in its folder after export" });
	await expect(autoReveal).not.toBeChecked();
	await autoReveal.press("Space");
	await expect(autoReveal).toBeChecked();
	await page.getByRole("button", { name: "Export MP4", exact: true }).click();
	await expect.poll(() => page.evaluate(() => sessionStorage.getItem("revealedExport")), { timeout: 45000 }).toBe("/exports/finished.mp4");
	await expect(page.getByText("Exported successfully to /exports/finished.mp4", { exact: true })).toBeVisible();
});
