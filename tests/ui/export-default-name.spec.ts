import { expect, test } from "@playwright/test";
import { installDesktopBridge, installDesktopBridgeOverrides } from "./bridge";

test("suggests the complete dotted project name at export", async ({ page }) => {
	await installDesktopBridge(page, "waveform.mp4");
	await installDesktopBridgeOverrides(page, () => {
		window.electronAPI.loadCurrentProjectFile = async () => ({
			success: true, path: "/projects/试剪 v1.2 demo.leadcut", revision: "named-export",
			project: {
				version: 2, projectId: "named-export",
				videoPath: `${location.origin}/tests/ui/fixtures/waveform.mp4`,
				editor: { clipRegions: [{ id: "screen", startMs: 0, endMs: 6000, sourceStartMs: 0, speed: 1 }] },
			},
		});
		window.electronAPI.chooseExportPath = async fileName => {
			document.documentElement.dataset.proposedExportName = fileName;
			return { success: false, canceled: true };
		};
	});
	await page.goto("/?windowType=editor");
	await expect(page.locator('[data-region-id="screen"]')).toHaveCount(1, { timeout: 25000 });
	await expect(page.getByLabel("Loading preview", { exact: true })).toHaveCount(0, { timeout: 25000 });
	await page.getByRole("button", { name: "Export video", exact: true }).click();
	await page.getByRole("button", { name: "Export MP4", exact: true }).click();
	await expect(page.locator("html")).toHaveAttribute("data-proposed-export-name", "试剪 v1.2 demo.mp4");
});
