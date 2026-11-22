import { expect, test } from "@playwright/test";
import { installDesktopBridge, installDesktopBridgeOverrides } from "./bridge";

test("the timeline renders nearby captions and keeps the selected caption while panning", async ({ page }) => {
	test.setTimeout(120000);
	await installDesktopBridge(page, "waveform.mp4");
	await installDesktopBridgeOverrides(page, () => {
		window.electronAPI.loadCurrentProjectFile = async () => ({
			success: true,
			path: "/projects/Timeline virtualization.leadcut",
			revision: "virtualized",
			project: {
				version: 2,
				projectId: "timeline-virtualization",
				videoPath: `${location.origin}/tests/ui/fixtures/waveform.mp4`,
				editor: {
					clipRegions: Array.from({ length: 200 }, (_, i) => ({
						id: `clip-${i}`, startMs: i * 5000, endMs: (i + 1) * 5000, sourceStartMs: 0, speed: 1,
					})),
					autoCaptions: Array.from({ length: 1000 }, (_, i) => ({
						id: `caption-${i}`, startMs: i * 1000, endMs: (i + 1) * 1000,
						timeBasis: "timeline", text: `Sample ${i + 1}`,
					})),
					autoCaptionSettings: { enabled: true, animationStyle: "none" },
				},
			},
		});
	});
	await page.goto("/?windowType=editor");
	const captions = page.locator('[data-variant="caption"][data-region-id]');
	const caption = (index: number) => captions.and(page.locator(`[data-region-id="caption-${index}"]`));
	const overview = page.locator("[data-caption-overview]");
	await expect(overview).toBeVisible({ timeout: 65000 });
	const clips = page.locator('[data-variant="clip"][data-region-id]');
	await expect(clips).toHaveCount(200);
	const overviewBox = (await overview.boundingBox())!;
	const markX = overviewBox.x + overviewBox.width * 0.0205;
	const markY = overviewBox.y + overviewBox.height / 2;
	await page.mouse.move(markX, markY);
	await expect(caption(20)).toBeVisible();
	await page.mouse.click(markX, markY);
	await expect(caption(20)).toHaveAttribute("data-selected", "true");
	const surface = page.locator("[data-forward-selection]");
	const box = (await surface.boundingBox())!;
	const clientX = box.x + 34;
	const clientY = box.y + 35;
	for (let i = 0; i < 7; i++) {
		await surface.dispatchEvent("wheel", { ctrlKey: true, deltaY: -box.width * 0.45, clientX, clientY });
	}
	await expect.poll(() => captions.count()).toBeLessThan(200);
	await expect.poll(() => clips.count()).toBeLessThan(100);
	await expect(clips.and(page.locator('[data-region-id="clip-199"]'))).toHaveCount(0);
	await expect(caption(999)).toHaveCount(0);
	await caption(5).click();
	await expect(caption(5)).toHaveAttribute("data-selected", "true");

	await surface.dispatchEvent("wheel", { deltaX: box.width * 400, clientX, clientY });
	await expect(caption(999)).toBeInViewport();
	await expect(clips.and(page.locator('[data-region-id="clip-199"]'))).toBeInViewport();
	await expect(caption(6)).toHaveCount(0);
	await expect(caption(5)).toHaveCount(1);
	await expect(caption(5)).toHaveAttribute("data-selected", "true");
	await expect.poll(() => captions.count()).toBeLessThan(200);
});
