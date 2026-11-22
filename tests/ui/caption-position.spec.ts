import { expect, test } from "@playwright/test";
import { installDesktopBridge, installDesktopBridgeOverrides } from "./bridge";

test("drags captions vertically, commits once, and keeps inline editing", async ({ page }) => {
	await installDesktopBridge(page, "waveform.mp4");
	await installDesktopBridgeOverrides(page, () => {
		const path = "/projects/Caption position.leadcut";
		window.electronAPI.loadCurrentProjectFile = async () => ({
			success: true, path, revision: "caption-position",
			project: {
				version: 2, projectId: "caption-position",
				videoPath: `${location.origin}/tests/ui/fixtures/waveform.mp4`,
				editor: {
					clipRegions: [{ id: "clip", startMs: 0, endMs: 6000, sourceStartMs: 0, speed: 1 }],
					autoCaptions: [{ id: "line", startMs: 0, endMs: 6000, text: "Move this caption", timeBasis: "timeline" }],
					autoCaptionSettings: { enabled: true, animationStyle: "none", bottomOffset: 3 },
				},
			},
		});
		window.electronAPI.saveProjectFile = async project => {
			const editor = project.editor as { autoCaptionSettings: { bottomOffset: number; horizontalOffset?: number } };
			const root = document.documentElement;
			root.dataset.bottomOffset = String(editor.autoCaptionSettings.bottomOffset);
			root.dataset.horizontalOffset = String(editor.autoCaptionSettings.horizontalOffset ?? 0);
			root.dataset.positionSaveCount = String(Number(root.dataset.positionSaveCount ?? 0) + 1);
			return { success: true, path, projectId: "caption-position", revision: "caption-position" };
		};
	});
	await page.goto("/?windowType=editor");
	const caption = page.getByRole("button", { name: "Edit current caption", exact: true });
	await expect(caption).toBeVisible({ timeout: 25000 });
	await expect(page.getByLabel("Loading preview", { exact: true })).toHaveCount(0, { timeout: 25000 });
	const frame = (await page.locator(".editor-preview-frame").boundingBox())!;
	const before = (await caption.boundingBox())!;
	const x = before.x + before.width / 2;
	const y = before.y + before.height / 2;
	const html = page.locator("html");
	const savesBefore = await html.getAttribute("data-position-save-count");
	await page.mouse.move(x, y);
	await page.mouse.down();
	await page.mouse.move(x + 24, y - 300, { steps: 10 });
	await page.waitForTimeout(650);
	expect(await html.getAttribute("data-position-save-count")).toBe(savesBefore);
	await page.mouse.up();
	const moved = (await caption.boundingBox())!;
	expect(Math.abs(moved.y - (before.y - 300))).toBeLessThan(3);
	expect(Math.abs(moved.x - before.x)).toBeLessThan(1);
	const expectedOffset = 3 + 300 / frame.height * 100;
	await expect.poll(async () => Math.abs(Number(await html.getAttribute("data-bottom-offset")) - expectedOffset)).toBeLessThan(1);
	await expect(html).toHaveAttribute("data-horizontal-offset", "0");

	await page.getByRole("button", { name: "Undo", exact: true }).click();
	await expect(html).toHaveAttribute("data-bottom-offset", "3");
	expect(Math.abs((await caption.boundingBox())!.y - before.y)).toBeLessThan(2);

	await page.keyboard.down("Shift");
	await page.mouse.move(x, y);
	await page.mouse.down();
	await page.mouse.move(x + 60, y, { steps: 6 });
	await page.mouse.up();
	await page.keyboard.up("Shift");
	await expect.poll(async () => Math.abs(Number(await html.getAttribute("data-horizontal-offset")) - 60 / frame.width * 100))
		.toBeLessThan(1);
	expect(Math.abs((await caption.boundingBox())!.x - before.x - 60)).toBeLessThan(3);
	await caption.dblclick();
	await expect(page.getByRole("textbox", { name: "Edit current caption", exact: true })).toBeFocused();
});
