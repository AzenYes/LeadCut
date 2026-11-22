import { expect, test } from "@playwright/test";
import { installDesktopBridge } from "./bridge";

test("explicit zoom, adaptive lanes, clip edges, volume and playhead", async ({ page }) => {
	test.setTimeout(90000);
	await installDesktopBridge(page, "filmstrip.mp4");
	await page.goto("/?windowType=editor");
	const clip = page.locator('[data-variant="clip"]');
	await expect(clip.locator("img").first()).toBeVisible({ timeout: 20000 });
	const scroll = page.getByTestId("timeline-scroll");
	const zoomRow = page.locator('[data-timeline-row="row-zoom"]');
	const clipRow = page.locator('[data-timeline-row="row-clip"]');
	for (const height of [800, 1000]) {
		await page.setViewportSize({ width: 1440, height });
		expect(
			await scroll.evaluate((el) => el.scrollHeight - el.clientHeight),
		).toBeLessThanOrEqual(1);
	}
	expect((await zoomRow.boundingBox())!.height).toBe((await clipRow.boundingBox())!.height);
	await zoomRow.hover({ position: { x: 250, y: 25 } });
	await zoomRow.click({ position: { x: 250, y: 25 } });
	const zoom = page.locator('[data-variant="zoom"]');
	await expect(zoom).toHaveCount(0);
	await clip.click({ position: { x: 42, y: 20 } });
	await page.getByRole("button", { name: "Add Zoom (Z)", exact: true }).click();
	await expect(zoom).toHaveCount(1);
	await expect(zoom.locator(".timeline-block")).toHaveCSS("background-image", "none");
	const normalHeight = (await zoomRow.boundingBox())!.height;
	await scroll.click({ position: { x: 600, y: 5 } });
	await page.keyboard.press("Shift+a");
	const annotation = page.locator('[data-variant="annotation"]');
	await expect(annotation).toHaveCount(1);
	expect((await zoomRow.boundingBox())!.height).toBe(normalHeight / 2);
	const annotationBox = (await annotation.boundingBox())!;
	const zoomBox = (await zoomRow.boundingBox())!;
	const scrollBox = (await scroll.boundingBox())!;
	expect(annotationBox.y).toBeGreaterThanOrEqual(zoomBox.y + zoomBox.height);
	expect(annotationBox.y + annotationBox.height).toBeLessThanOrEqual(
		scrollBox.y + scrollBox.height,
	);
	for (const height of [800, 1000]) {
		await page.setViewportSize({ width: 1440, height });
		expect(
			await scroll.evaluate((el) => el.scrollHeight - el.clientHeight),
		).toBeLessThanOrEqual(1);
	}
	await expect(annotation.locator(".timeline-block")).toHaveCSS("background-image", "none");
	// Clip grips are decoration outside the true clip boundaries.
	const block = clip.locator(".timeline-block");
	const blockBox = (await block.boundingBox())!;
	expect((await clip.getByTitle("Resize left").boundingBox())!.x + 4).toBeLessThan(blockBox.x);
	expect((await clip.getByTitle("Resize right").boundingBox())!.x).toBeGreaterThan(
		blockBox.x + blockBox.width,
	);
	const before = (await clip.boundingBox())!;
	const beforeLabel = await clip.getAttribute("aria-label");
	await page.mouse.move(before.x + before.width - 2, before.y + before.height / 2);
	await page.mouse.down();
	await page.mouse.move(before.x + before.width - 90, before.y + before.height / 2, {
		steps: 10,
	});
	await page.mouse.up();
	await expect(clip).not.toHaveAttribute("aria-label", beforeLabel!);
	expect((await clip.boundingBox())!.x).toBeCloseTo(before.x, 0);
	const volumeButton = page.getByRole("button", { name: "Preview volume", exact: true });
	await volumeButton.click();
	const dialog = page.getByRole("dialog", { name: "Preview volume" });
	await expect(dialog).toBeVisible();
	const volume = dialog.getByRole("slider");
	await volume.focus();
	await page.keyboard.press("ArrowDown");
	await expect(volume).toHaveValue("0.99");
	await expect.poll(async () => {
		const [popover, trigger] = await Promise.all([dialog.boundingBox(), volumeButton.boundingBox()]);
		return popover && trigger ? popover.y + popover.height - trigger.y : Infinity;
	}).toBeLessThan(0);
	await page.keyboard.press("Escape");
	await expect(dialog).toHaveCount(0);
	const cap = page.getByTestId("playhead-cap");
	await cap.hover();
	await expect(cap).toHaveCSS("width", "68px");
	await expect(cap.locator("span")).toHaveCSS("opacity", "1");
	await expect(page.getByTestId("timeline-playhead").locator(":scope > div")).toHaveCSS(
		"box-shadow",
		"none",
	);
	await expect(page.locator(".timeline-axis")).toHaveCount(0);
	await page.screenshot({ path: "test-results/timeline-redesign.png", animations: "disabled" });
	await page.mouse.move(600, 200);
	await expect(cap).toHaveCSS("width", "16px");
	// Removing the third lane restores full zoom height.
	await annotation.click();
	await page.getByRole("button", { name: "Delete Annotation", exact: true }).click();
	await expect(annotation).toHaveCount(0);
	expect((await zoomRow.boundingBox())!.height).toBe(normalHeight);
});
