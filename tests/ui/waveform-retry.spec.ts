import path from "node:path";
import { expect, test } from "@playwright/test";
import { installDesktopBridge, installDesktopBridgeOverrides } from "./bridge";

test("shows the desktop waveform error and retries with progress", async ({ page }) => {
	await installDesktopBridge(page);
	await page.route("**/video?path=*", (route) =>
		route.fulfill({
			path: path.join(process.cwd(), "tests", "ui", "fixtures", "waveform.mp4"),
			contentType: "video/mp4",
		}),
	);
	await installDesktopBridgeOverrides(page, () => {
		const sourcePath = "D:/fixtures/stb2-waveform.mp4";
		let retryClicked = false;
		document.addEventListener(
			"click",
			(event) => {
				if (
					(event.target as HTMLElement).closest("button")?.textContent?.trim() === "Retry"
				) {
					retryClicked = true;
				}
			},
			true,
		);
		const mediaUrl = (file: string) =>
			`${location.origin}/video?path=${encodeURIComponent(file)}`;
		Object.assign(window.electronAPI, {
			getCurrentVideoPath: async () => ({ success: true, path: sourcePath }),
			getLocalMediaUrl: async (file: string) => ({ success: true, url: mediaUrl(file) }),
			onWaveformPeaksProgress: (
				callback: (data: { requestId: number; ratio: number }) => void,
			) => {
				const listener = (event: Event) =>
					callback((event as CustomEvent<{ requestId: number; ratio: number }>).detail);
				window.addEventListener("test-waveform-progress", listener);
				return () => window.removeEventListener("test-waveform-progress", listener);
			},
			generateWaveformPeaks: async (file: string, requestId: number) => {
				if (file.replaceAll("\\", "/") !== sourcePath)
					return { success: true, noAudio: true };
				const counter =
					Number(document.documentElement.dataset.waveformAttempts ?? "0") + 1;
				document.documentElement.dataset.waveformAttempts = String(counter);
				if (!retryClicked) return { success: false, error: "Synthetic decode failure" };
				window.dispatchEvent(
					new CustomEvent("test-waveform-progress", {
						detail: { requestId, ratio: 0.5 },
					}),
				);
				await new Promise<void>((resolve) =>
					window.addEventListener("test-waveform-finish", () => resolve(), {
						once: true,
					}),
				);
				return {
					success: true,
					durationMs: 10_000,
					peaks: new Float32Array([0, 0.5, 1, 0.25]),
				};
			},
		});
	});
	await page.goto("/?windowType=editor");
	await expect(page.getByText("Waveform generation failed", { exact: true })).toBeVisible({ timeout: 25_000 });
	const initialAttempts = Number(
		await page.locator("html").getAttribute("data-waveform-attempts"),
	);
	expect(initialAttempts).toBeGreaterThan(0);
	await page.getByRole("button", { name: "Retry", exact: true }).click();
	await expect(page.getByText("Generating waveform 50%", { exact: true })).toBeVisible();
	expect(
		Number(await page.locator("html").getAttribute("data-waveform-attempts")),
	).toBeGreaterThan(initialAttempts);
	await page.evaluate(() => window.dispatchEvent(new Event("test-waveform-finish")));
	await expect(page.getByText("Generating waveform 50%", { exact: true })).toHaveCount(0);
	await expect(page.getByText("Waveform generation failed", { exact: true })).toHaveCount(0);
});
