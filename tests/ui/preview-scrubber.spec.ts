import { expect, test } from "@playwright/test";
import { installDesktopBridge, installDesktopBridgeOverrides } from "./bridge";

test("drags the actual preview playhead across two source cuts", async ({ page }) => {
	await installDesktopBridge(page, "waveform.mp4");
	await installDesktopBridgeOverrides(page, () => {
		window.electronAPI.loadCurrentProjectFile = async () => ({
			success: true, path: "/projects/Review.leadcut", revision: "review",
			project: {
				version: 2, projectId: "review", videoPath: `${location.origin}/tests/ui/fixtures/waveform.mp4`,
				editor: { clipRegions: [0, 1, 2].map(index => ({
					id: `clip-${index}`, startMs: index * 1000, endMs: (index + 1) * 1000,
					sourceStartMs: index * 2000, speed: 1,
				})) },
			},
		});
	});
	await page.goto("/?windowType=editor");
	await expect(page.getByTestId("scrubber-cut")).toHaveCount(2, { timeout: 25000 });
	const scrubber = page.getByRole("slider", { name: "Preview progress" });
	await expect(scrubber).toHaveAttribute("aria-valuemax", "3000");
	await expect(page.getByLabel("Loading preview", { exact: true })).toHaveCount(0, { timeout: 25000 });
	const bounds = (await scrubber.boundingBox())!;
	const y = bounds.y + bounds.height / 2;
	await page.mouse.move(bounds.x + bounds.width / 4, y);
	await page.mouse.down();
	await page.mouse.move(bounds.x + bounds.width / 2, y, { steps: 6 });
	await page.mouse.up();
	await expect.poll(async () => Number(await scrubber.getAttribute("aria-valuenow")))
		.toBeGreaterThanOrEqual(1480);
	expect(Number(await scrubber.getAttribute("aria-valuenow"))).toBeLessThanOrEqual(1520);
	await expect(page.getByTestId("preview-current-time")).toHaveText(/^00:00:01\.[45]\d{2}$/);
});
