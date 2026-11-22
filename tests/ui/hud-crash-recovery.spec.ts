import { expect, test } from "@playwright/test";
import { installDesktopBridge, installDesktopBridgeOverrides } from "./bridge";

test("a recovered recording bar resumes its native controls and elapsed time", async ({ page }) => {
	await installDesktopBridge(page);
	await installDesktopBridgeOverrides(page, () => {
		window.electronAPI.getRecordingState = async () => ({
			recording: true, backend: "native-windows", elapsedMs: 65000, paused: true,
		});
		window.electronAPI.resumeNativeScreenRecording = async () => {
			document.documentElement.dataset.resumedNativeCapture = "true";
			return { success: true };
		};
	});
	await page.goto("/?windowType=hud-overlay&hudRecovered=1");
	const controls = page.getByRole("group", { name: "Recording controls" });
	await expect(controls.getByText("01:05", { exact: true })).toBeVisible({ timeout: 25000 });
	await expect(page.getByText("The recording bar recovered. Camera or microphone recording may have been interrupted.")).toBeVisible();
	await controls.getByRole("button", { name: "Resume", exact: true }).click();
	await expect(page.locator("html")).toHaveAttribute("data-resumed-native-capture", "true");
	await expect(controls.getByRole("button", { name: "Pause", exact: true })).toBeVisible();
	await expect.poll(async () => {
		const elapsed = (await controls.getByRole("status").textContent())?.trim() ?? "";
		return elapsed.split(":").reduce((seconds, part) => seconds * 60 + Number(part), 0);
	}).toBeGreaterThanOrEqual(66);
});

test("a crashed browser capture is reported and cleared", async ({ page }) => {
	await installDesktopBridge(page);
	await installDesktopBridgeOverrides(page, () => {
		window.electronAPI.getRecordingState = async () => ({
			recording: true, backend: "browser", elapsedMs: 2000, paused: false,
		});
		window.electronAPI.setRecordingState = async recording => {
			document.documentElement.dataset.recordingState = String(recording);
		};
	});
	await page.goto("/?windowType=hud-overlay&hudRecovered=1");
	await expect(page.getByText("The recording bar recovered, but the browser recording was interrupted.")).toBeVisible({ timeout: 25000 });
	await expect(page.locator("html")).toHaveAttribute("data-recording-state", "false");
	await expect(page.getByRole("button", { name: "Record", exact: true })).toBeVisible();
});
