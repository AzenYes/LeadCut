import { expect, test } from "@playwright/test";
import { installDesktopBridge, installDesktopBridgeOverrides } from "./bridge";

test("the configured split key works without timeline focus and updates shortcut hints", async ({ page }) => {
	await installDesktopBridge(page, "waveform.mp4");
	await installDesktopBridgeOverrides(page, () => {
		window.electronAPI.getPlatform = async () => "win32";
		window.electronAPI.getShortcuts = async () => ({ splitClip: { key: "b", ctrl: true } });
		window.electronAPI.loadCurrentProjectFile = async () => ({
			success: true,
			path: "/projects/Shortcut test.leadcut",
			revision: "shortcut-test",
			project: {
				version: 2,
				projectId: "shortcut-test",
				videoPath: `${location.origin}/tests/ui/fixtures/waveform.mp4`,
				editor: { clipRegions: [{ id: "screen", startMs: 0, endMs: 6000, sourceStartMs: 0, speed: 1 }] },
			},
		});
	});
	await page.goto("/?windowType=editor");
	const clips = page.locator('[data-variant="clip"][data-region-id]');
	await expect(clips).toHaveCount(1, { timeout: 25000 });
	await expect(page.getByLabel("Loading preview", { exact: true })).toHaveCount(0, { timeout: 25000 });
	const time = page.getByRole("textbox", { name: "Timeline timecode", exact: true });
	await time.fill("00:00:02.000");
	await time.press("Enter");
	await expect(time).toHaveValue("00:00:02.000");
	await expect(page.getByTestId("timeline-scroll")).not.toBeFocused();
	await page.keyboard.press("F2");
	await expect(clips).toHaveCount(1);
	await page.keyboard.press("Control+b");
	await expect(clips).toHaveCount(2);
	await expect(page.getByRole("button", { name: /^Split Ctrl/ }).locator("kbd")).toHaveText("Ctrl + B");
	await page.getByRole("button", { name: "Keyboard Shortcuts", exact: true }).click();
	const help = page.getByRole("dialog", { name: "Keyboard Shortcuts", exact: true });
	await expect(help.getByText("Ripple delete", { exact: true })).toBeVisible();
	await expect(help.getByText("Undo", { exact: true })).toBeVisible();
	await expect(help.getByText("Redo", { exact: true })).toBeVisible();
});
