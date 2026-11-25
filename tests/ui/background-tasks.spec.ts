import { expect, test } from "@playwright/test";
import { installDesktopBridge, installDesktopBridgeOverrides } from "./bridge";

for (const operation of ["model", "captions"] as const) {
	test(`can monitor and cancel ${operation} after changing editor tools`, async ({ page }) => {
		test.setTimeout(90_000);
		await installDesktopBridge(page, "waveform.mp4");
		await installDesktopBridgeOverrides(page, task => {
			const api = window.electronAPI;
			api.getCurrentVideoPath = async () => ({ success: true, path: "/recordings/background-task.mp4" });
			api.getLocalMediaUrl = async () => ({ success: true, url: `${location.origin}/tests/ui/fixtures/waveform.mp4` });
			let onModelProgress: Parameters<typeof api.onWhisperSmallModelDownloadProgress>[0] | undefined;
			let onCaptionProgress: Parameters<NonNullable<typeof api.onAutoCaptionProgress>>[0] | undefined;
			let cancel: (() => void) | undefined;
			api.getWhisperSmallModelStatus = async () => task === "captions"
				? { success: true, exists: true, path: "/models/whisper.bin" }
				: { success: true, exists: false };
			api.onWhisperSmallModelDownloadProgress = listener => {
				onModelProgress = listener;
				return () => { onModelProgress = undefined; };
			};
			api.onAutoCaptionProgress = listener => {
				onCaptionProgress = listener;
				return () => { onCaptionProgress = undefined; };
			};
			api.downloadWhisperSmallModel = () => new Promise(resolve => {
				onModelProgress?.({ status: "downloading", progress: 43 });
				cancel = () => resolve({ success: false, canceled: true });
			});
			api.generateAutoCaptions = () => new Promise(resolve => {
				onCaptionProgress?.(43);
				cancel = () => resolve({ success: false, canceled: true });
			});
			api.cancelWhisperModelDownload = async () => cancel?.();
			api.cancelAutoCaptions = async () => cancel?.();
		}, operation);
		await page.goto("/?windowType=editor", { waitUntil: "domcontentloaded" });
		await page.getByRole("radio", { name: "Caption transcript", exact: true }).click({ timeout: 60_000 });
		if (operation === "model") {
			await page.getByRole("button", { name: "Set up caption recognition", exact: true }).click();
			await page.getByRole("button", { name: "Download Model", exact: true }).click();
		} else {
			await page.getByRole("button", { name: "Generate Captions", exact: true }).click();
		}
		const title = operation === "model" ? "Downloading caption model" : "Generating captions";
		const active = page.locator("[data-background-task]").filter({ has: page.getByRole("progressbar", { name: title, exact: true }) });
		await expect(active.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "43");
		await page.getByRole("radio", { name: "Scene", exact: true }).click();
		await expect(active).toBeVisible();
		await expect(active).toContainText("43%");
		await active.getByRole("button", { name: "Cancel", exact: true }).click();
		await expect(active).toHaveCount(0);
	});
}
