import { expect, test } from "@playwright/test";
import { installDesktopBridge, installDesktopBridgeOverrides } from "./bridge";

test("warns when 1 GB is left while keeping Record available", async ({ page }) => {
	await installDesktopBridge(page);
	await installDesktopBridgeOverrides(page, () => {
		window.electronAPI.getRecordingDiskStatus = async () => ({
			freeBytes: 1_000_000_000,
			level: "low",
		});
	});
	await page.goto("/?windowType=hud-overlay");
	await expect(
		page.getByText("Less than 2 GB of disk space remaining", { exact: true }),
	).toBeVisible();
	await expect(page.getByRole("button", { name: "Record", exact: true })).toBeEnabled();
});

test("keeps the warning visible while recording and shows a critical-space stop message", async ({
	page,
}) => {
	await installDesktopBridge(page);
	await installDesktopBridgeOverrides(page, () => {
		window.electronAPI.onRecordingStateChanged = (callback) => {
			const listener = () => callback({ recording: true, sourceName: "Screen" });
			window.addEventListener("test-disk-recording", listener);
			return () => window.removeEventListener("test-disk-recording", listener);
		};
		window.electronAPI.onRecordingDiskLow = (callback) => {
			const listener = (event: Event) => {
				const level = (event as CustomEvent<"low" | "stop">).detail;
				callback({
					freeBytes: level === "stop" ? 400_000_000 : 1_000_000_000,
					level,
				});
			};
			window.addEventListener("test-disk-space", listener);
			return () => window.removeEventListener("test-disk-space", listener);
		};
	});
	await page.goto("/?windowType=hud-overlay");
	await expect(page.getByRole("button", { name: "Record", exact: true })).toBeVisible();
	await page.evaluate(() => window.dispatchEvent(new Event("test-disk-recording")));
	await expect(page.getByRole("button", { name: "Stop", exact: true })).toBeVisible();
	await page.evaluate(() =>
		window.dispatchEvent(new CustomEvent("test-disk-space", { detail: "low" })),
	);
	await expect(page.getByText("Low disk space", { exact: true })).toBeVisible();
	await page.evaluate(() =>
		window.dispatchEvent(new CustomEvent("test-disk-space", { detail: "stop" })),
	);
	await expect(
		page.getByText("Disk almost full. Recording stopped and saved.", { exact: true }),
	).toBeVisible();
});
