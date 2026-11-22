import { expect, test } from "@playwright/test";
import { installDesktopBridge, installDesktopBridgeOverrides } from "./bridge";

test("the global pause shortcut pauses the native recording in the HUD", async ({ page }) => {
	await installDesktopBridge(page);
	await installDesktopBridgeOverrides(page, () => {
		window.electronAPI.getRecordingState = async () => ({
			recording: true, paused: false, elapsedMs: 65000, backend: "native-windows",
		});
		window.electronAPI.onRecordingShortcut = callback => {
			const handler = () => callback("togglePause");
			window.addEventListener("test-recording-shortcut", handler);
			return () => window.removeEventListener("test-recording-shortcut", handler);
		};
		window.electronAPI.pauseNativeScreenRecording = async () => ({ success: true });
		window.electronAPI.pauseCursorCapture = async () => ({ success: true });
		window.electronAPI.setRecordingPaused = paused => {
			document.documentElement.dataset.recordingPaused = String(paused);
		};
	});
	await page.goto("/?windowType=hud-overlay");
	await expect(page.getByRole("button", { name: "Pause", exact: true })).toBeVisible({ timeout: 25000 });
	await page.evaluate(() => window.dispatchEvent(new Event("test-recording-shortcut")));
	await expect(page.getByRole("button", { name: "Resume", exact: true })).toBeVisible();
	await expect(page.locator("html")).toHaveAttribute("data-recording-paused", "true");
});

test("recording shortcut settings show system registration conflicts", async ({ page }) => {
	test.setTimeout(90000);
	await installDesktopBridge(page, "filmstrip.mp4");
	await installDesktopBridgeOverrides(page, () => {
		window.electronAPI.getPlatform = async () => "win32";
		window.electronAPI.setRecordingShortcuts = async config => {
			document.documentElement.dataset.recordingShortcut = config.toggleRecording.key;
			return { success: true, failed: ["toggleRecording"] };
		};
	});
	await page.goto("/?windowType=editor");
	await expect(page.locator('[data-variant="clip"][data-region-id]')).toHaveCount(1, { timeout: 65000 });
	await expect(page.getByLabel("Loading preview", { exact: true })).toHaveCount(0, { timeout: 25000 });
	const help = page.getByRole("button", { name: "Keyboard Shortcuts", exact: true });
	await help.click();
	await page.getByRole("dialog", { name: "Keyboard Shortcuts", exact: true })
		.getByRole("button", { name: "Customize shortcuts", exact: true }).click();
	const settings = page.getByRole("region", { name: "Recording (global)" });
	const change = settings.getByRole("button", { name: /^Change Start \/ Stop recording shortcut/ });
	await expect(change).toHaveText("Ctrl + Alt + R");
	await change.click();
	await page.keyboard.press("Control+Alt+V");
	await expect(change).toHaveText("Ctrl + Alt + V");
	await page.getByRole("button", { name: "Save", exact: true }).click();
	await expect(page.locator("html")).toHaveAttribute("data-recording-shortcut", "v");
	await expect(settings.getByText("Already used by another application")).toBeVisible();
});
