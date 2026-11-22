import { expect, test } from "@playwright/test";
import { installDesktopBridge, installDesktopBridgeOverrides } from "./bridge";

for (const mode of ["native", "fallback", "cancel during setup", "cancel during native startup", "cancel after native pause"]) {
	test(`countdown starts before slow preparation: ${mode}`, async ({ page }) => {
		await installDesktopBridge(page);
		await installDesktopBridgeOverrides(page, () => {
			const success = async () => ({ success: true });
			let releaseSetup: () => void;
			let releaseNative: () => void;
			let finishCountdown: (value: { success: boolean; cancelled?: boolean }) => void;
			const setup = new Promise<void>((resolve) => {
				releaseSetup = resolve;
			});
			const native = new Promise<void>((resolve) => {
				releaseNative = resolve;
			});
			const countdown = new Promise<{ success: boolean; cancelled?: boolean }>((resolve) => {
				finishCountdown = resolve;
			});
			const source = { id: "screen:1:0", name: "Screen 1", sourceType: "screen" };
			Object.assign(window.electronAPI, {
				getPlatform: async () => "win32",
				getSelectedSource: async () => {
					if (document.documentElement.dataset.delaySetup) await setup;
					return source;
				},
				getRecordingPreferences: async () => ({
					success: true,
					webcamEnabled: false,
					microphoneEnabled: false,
					systemAudioEnabled: true,
				}),
				setRecordingPreferences: async (prefs: { systemAudioEnabled?: boolean }) => {
					if (prefs.systemAudioEnabled !== undefined)
						document.documentElement.dataset.savedSystemAudio = String(
							prefs.systemAudioEnabled,
						);
					return { success: true };
				},
				isNativeWindowsCaptureAvailable: async () => ({ available: true }),
				startCountdown: async () => {
					document.documentElement.dataset.countdownCalls = String(
						Number(document.documentElement.dataset.countdownCalls || 0) + 1,
					);
					return countdown;
				},
				cancelCountdown: async () => {
					finishCountdown({ success: false, cancelled: true });
					return { success: true };
				},
				startNativeScreenRecording: async (
					_source: unknown,
					options: { capturesSystemAudio: boolean },
				) => {
					document.documentElement.dataset.nativeStarted = String(
						options.capturesSystemAudio,
					);
					if (document.documentElement.dataset.delayNative) await native;
					return { success: document.documentElement.dataset.failNative !== "true" };
				},
				pauseNativeScreenRecording: async () => {
					document.documentElement.dataset.nativePaused = "true";
					return { success: true };
				},
				resumeNativeScreenRecording: async () => {
					document.documentElement.dataset.nativeResumed = "true";
					return { success: true };
				},
				stopNativeScreenRecording: async () => {
					document.documentElement.dataset.nativeStopped = "true";
					return { success: true, path: "/recordings/discard.mp4" };
				},
				deleteRecordingFile: success,
				finishRecordingStartup: async () => {
					document.documentElement.dataset.startupFinished = "true";
					return { success: true };
				},
				setRecordingState: success,
			});
			window.addEventListener("test-release-setup", () => releaseSetup());
			window.addEventListener("test-release-native", () => releaseNative());
			window.addEventListener("test-finish-countdown", () =>
				finishCountdown({ success: true }),
			);
		});
		await page.goto("/?windowType=hud-overlay");
		const speaker = page.getByRole("button", { name: "Disable system audio", exact: true });
		await expect(speaker).toHaveAttribute("aria-pressed", "true");
		await speaker.click();
		await expect(page.locator("html")).toHaveAttribute("data-saved-system-audio", "false");
		await page.getByRole("button", { name: "Enable system audio", exact: true }).click();
		await expect(page.locator("html")).toHaveAttribute("data-saved-system-audio", "true");
		await page.evaluate((mode) => {
			document.documentElement.dataset.delaySetup = "true";
			if (mode === "fallback") document.documentElement.dataset.failNative = "true";
			if (mode === "cancel during native startup")
				document.documentElement.dataset.delayNative = "true";
		}, mode);
		await page.getByRole("button", { name: "Record", exact: true }).click();
		await expect(page.locator("html")).toHaveAttribute("data-countdown-calls", "1");
		await expect(page.locator("html")).not.toHaveAttribute("data-native-started");
		if (mode === "cancel during setup")
			await page.evaluate(() => window.electronAPI.cancelCountdown());
		await page.evaluate(() => window.dispatchEvent(new Event("test-release-setup")));
		if (mode === "cancel during setup") {
			await expect(page.locator("html")).toHaveAttribute("data-startup-finished", "true");
			await expect(page.locator("html")).not.toHaveAttribute("data-native-started");
		} else if (mode === "cancel during native startup") {
			await expect(page.locator("html")).toHaveAttribute("data-native-started", "true");
			await page.evaluate(() => window.electronAPI.cancelCountdown());
			await page.evaluate(() => window.dispatchEvent(new Event("test-release-native")));
			await expect(page.locator("html")).toHaveAttribute("data-native-stopped", "true");
			await expect(page.locator("html")).toHaveAttribute("data-startup-finished", "true");
			await expect(page.locator("html")).not.toHaveAttribute("data-native-resumed");
		} else if (mode === "native" || mode === "cancel after native pause") {
			await expect(page.locator("html")).toHaveAttribute("data-native-paused", "true");
			await expect(page.locator("html")).not.toHaveAttribute("data-native-resumed");
			if (mode === "cancel after native pause") {
				await page.evaluate(() => window.electronAPI.cancelCountdown());
				await expect(page.locator("html")).toHaveAttribute("data-native-stopped", "true");
				await expect(page.locator("html")).toHaveAttribute("data-startup-finished", "true");
				await expect(page.locator("html")).not.toHaveAttribute("data-native-resumed");
			} else {
				await page.evaluate(() => window.dispatchEvent(new Event("test-finish-countdown")));
				await expect(page.getByRole("button", { name: "Stop", exact: true })).toBeVisible();
				await expect(page.locator("html")).toHaveAttribute("data-native-resumed", "true");
			}
		} else {
			await expect(page.locator("html")).toHaveAttribute("data-native-started", "true");
			// Fallback must wait on the original countdown, without opening another one.
			await page.evaluate(() => window.electronAPI.cancelCountdown());
			await expect(page.locator("html")).toHaveAttribute("data-startup-finished", "true");
		}
		await expect(page.locator("html")).toHaveAttribute("data-countdown-calls", "1");
	});
}
