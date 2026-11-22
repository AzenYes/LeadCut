import { expect, test } from "@playwright/test";
import { installDesktopBridge, installDesktopBridgeOverrides } from "./bridge";

test("shows the resolution tiers, disables redundant tiers and estimates a persisted manual bitrate", async ({ page }) => {
	test.setTimeout(90000);
	await installDesktopBridge(page, "waveform.mp4");
	await installDesktopBridgeOverrides(page, () => {
		Object.defineProperties(HTMLVideoElement.prototype, {
			videoWidth: { configurable: true, get: () => 3840 },
			videoHeight: { configurable: true, get: () => 2160 },
		});
		if (window.VideoEncoder) {
			VideoEncoder.isConfigSupported = async config => ({ config, supported: true });
		}
		window.electronAPI.loadCurrentProjectFile = async () => ({
			success: true, path: "/projects/export-tiers.leadcut", revision: "export-size",
			project: {
				version: 2, projectId: "export-tiers",
				videoPath: `${location.origin}/tests/ui/fixtures/waveform.mp4`,
				editor: { clipRegions: [{ id: "long", startMs: 0, endMs: 60000, speed: 1 }] },
			},
		});
	});
	await page.goto("/?windowType=editor");
	const open = async () => {
		await expect(page.locator('[data-variant="clip"]')).toHaveCount(1, { timeout: 50000 });
		await expect(page.getByLabel("Loading preview", { exact: true })).toHaveCount(0, { timeout: 40000 });
		await page.getByRole("button", { name: "Export video", exact: true }).click();
	};
	await open();
	const quality = page.getByRole("grid", { name: "Quality", exact: true });
	const tier = (name: string) => quality.getByRole("row").filter({ hasText: name });
	await expect(tier("1080p")).toContainText("1920 × 1080");
	await expect(tier("2K")).toContainText("2560 × 1440");
	await expect(tier("4K")).toHaveAttribute("aria-disabled", "true");
	await expect(tier("Original")).toContainText("3840 × 2160");
	await tier("1080p").click();
	await expect(tier("1080p")).toHaveAttribute("aria-selected", "true");
	const openAdvanced = () => page.getByText("Advanced export settings", { exact: true }).click();
	await openAdvanced();
	await page.getByText("Manual", { exact: true }).click();
	const bitrate = page.getByRole("spinbutton", { name: "Video bitrate (Mbps)" });
	await bitrate.fill("10");
	await bitrate.blur();
	await expect(page.getByTestId("estimated-export-size")).toHaveText("Approx. 75.96 MB");
	await page.reload();
	await open();
	await expect(tier("1080p")).toHaveAttribute("aria-selected", "true");
	await openAdvanced();
	await expect(bitrate).toHaveValue("10");
	await expect(page.getByTestId("estimated-export-size")).toHaveText("Approx. 75.96 MB");
});
