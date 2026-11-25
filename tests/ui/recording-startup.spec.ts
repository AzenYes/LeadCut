import { expect, test } from "@playwright/test";
import { installDesktopBridge, installDesktopBridgeOverrides } from "./bridge";

for (const mode of ["native", "fallback", "cancel during setup", "cancel during native startup", "cancel after native pause", "zero-delay cancel"]) {
	test(`countdown starts before slow preparation: ${mode}`, async ({ page }) => {
		if (mode === "native") test.setTimeout(55_000);
		await installDesktopBridge(page);
		await installDesktopBridgeOverrides(page, (startupMode) => {
			const success = async () => ({ success: true });
			let releaseSetup: () => void;
			let releaseNative: () => void;
			let releaseStop: () => void;
			let releaseEditor: () => void;
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
			const stop = new Promise<void>((resolve) => { releaseStop = resolve; });
			const editor = new Promise<void>((resolve) => { releaseEditor = resolve; });
			const source = { id: "screen:1:0", name: "Screen 1", sourceType: "screen" };
			Object.assign(window.electronAPI, {
				getPlatform: async () => "win32",
				getCountdownDelay: async () => ({ success: true, delay: startupMode === "zero-delay cancel" ? 0 : 3 }),
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
					if (startupMode === "native") await stop;
					return { success: true, path: "/recordings/saved.mp4" };
				},
				onRecordingFinalization: (callback: (status: unknown) => void) => {
					const listener = (event: Event) => callback((event as CustomEvent).detail);
					window.addEventListener("test-recording-finalization", listener);
					return () => window.removeEventListener("test-recording-finalization", listener);
				},
				revealInFolder: async (path: string) => {
					document.documentElement.dataset.revealed = path;
					return { success: true };
				},
				switchToEditor: async () => {
					await editor;
					document.documentElement.dataset.editorOpened = "true";
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
			window.addEventListener("test-release-stop", () => releaseStop());
			window.addEventListener("test-release-editor", () => releaseEditor());
			window.addEventListener("test-finish-countdown", () =>
				finishCountdown({ success: true }),
			);
		}, mode);
		await page.goto("/?windowType=hud-overlay");
		const speaker = page.getByRole("button", { name: "Disable system audio", exact: true });
		await expect(speaker).toHaveAttribute("aria-pressed", "true", { timeout: 20_000 });
		await speaker.click();
		await expect(page.locator("html")).toHaveAttribute("data-saved-system-audio", "false");
		await page.getByRole("button", { name: "Enable system audio", exact: true }).click();
		await expect(page.locator("html")).toHaveAttribute("data-saved-system-audio", "true");
		await page.evaluate((mode) => {
			document.documentElement.dataset.delaySetup = "true";
			if (mode === "fallback") document.documentElement.dataset.failNative = "true";
			if (mode === "cancel during native startup" || mode === "zero-delay cancel")
				document.documentElement.dataset.delayNative = "true";
		}, mode);
		await page.getByRole("button", { name: "Record", exact: true }).click();
		if (mode === "zero-delay cancel") {
			await expect(page.getByRole("status").filter({ hasText: "Starting capture" })).toBeVisible();
			await page.evaluate(() => window.dispatchEvent(new Event("test-release-setup")));
			await expect(page.locator("html")).toHaveAttribute("data-native-started", "true");
			await page.getByRole("button", { name: "Cancel", exact: true }).click();
			await page.evaluate(() => window.dispatchEvent(new Event("test-release-native")));
			await expect(page.locator("html")).toHaveAttribute("data-native-stopped", "true");
			await expect(page.locator("html")).toHaveAttribute("data-startup-finished", "true");
			await expect(page.locator("html")).not.toHaveAttribute("data-countdown-calls");
			return;
		}
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
				await page.getByRole("button", { name: "Stop", exact: true }).click();
				const task = page.locator("[data-background-task]");
				await expect(task.getByRole("status")).toHaveText("Stopping capture");
				await page.evaluate(() => window.dispatchEvent(new CustomEvent("test-recording-finalization", { detail: { stage: "saving" } })));
				await expect(task.getByRole("status")).toHaveText("Saving recording");
				const reveal = task.getByRole("button", { name: /Show recording in folder/ });
				await expect(task.locator("time")).toHaveAttribute("datetime", /^PT[2-9]\dS$/, { timeout: 25_000 });
				await expect(reveal).toHaveCount(0);
				await page.evaluate(() => window.dispatchEvent(new CustomEvent("test-recording-finalization", {
					detail: { stage: "preparing", savedPath: "/recordings/saved.mp4" },
				})));
				await expect(task.getByRole("status")).toHaveText("Preparing recording");
				await expect(reveal).toHaveText("Recording saved at /recordings/saved.mp4");
				await reveal.click();
				await expect(page.locator("html")).toHaveAttribute("data-revealed", "/recordings/saved.mp4");
				await page.evaluate(() => window.dispatchEvent(new Event("test-release-stop")));
				await expect(task.getByRole("status")).toHaveText("Opening the editor");
				await page.evaluate(() => window.dispatchEvent(new Event("test-release-editor")));
				await expect(page.locator("html")).toHaveAttribute("data-editor-opened", "true");
				await expect(task).toHaveCount(0);
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
