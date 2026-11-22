import { expect, test } from "@playwright/test";
import { installDesktopBridge, installDesktopBridgeOverrides } from "./bridge";

test("the timeline displays three recording markers at their original footage positions", async ({ page }) => {
	await installDesktopBridge(page, "filmstrip.mp4");
	await installDesktopBridgeOverrides(page, () => {
		window.electronAPI.getRecordingMarkers = async () => ({
			success: true,
			markers: [
				{ id: "one", timeMs: 500, kind: "cut" },
				{ id: "two", timeMs: 1200, kind: "highlight" },
				{ id: "three", timeMs: 2000, kind: "cut" },
			],
		});
	});
	await page.goto("/?windowType=editor");
	const markers = page.getByTestId("timeline-scroll").getByTestId("recording-marker");
	await expect(markers).toHaveCount(3, { timeout: 25000 });
	await expect(markers.nth(0)).toHaveAttribute("data-timeline-time-ms", "500");
	await expect(markers.nth(1)).toHaveAttribute("data-timeline-time-ms", "1200");
	await expect(markers.nth(2)).toHaveAttribute("data-timeline-time-ms", "2000");
	await expect(markers.nth(0)).toHaveAttribute("data-marker-kind", "cut");
	await expect(markers.nth(1)).toHaveAttribute("data-marker-kind", "highlight");
});

test("recording mark notifications refresh the HUD counter", async ({ page }) => {
	await installDesktopBridge(page);
	await installDesktopBridgeOverrides(page, () => {
		window.electronAPI.getRecordingState = async () => ({
			recording: true, paused: false, elapsedMs: 6000, backend: "native-windows", markerCount: 2,
		});
		window.electronAPI.onRecordingMarkerAdded = callback => {
			const handler = () => callback({ success: true, count: 3, timeMs: 6300, kind: "highlight" });
			window.addEventListener("test-recording-marker", handler);
			return () => window.removeEventListener("test-recording-marker", handler);
		};
	});
	await page.goto("/?windowType=hud-overlay");
	await expect(page.locator("[data-recording-marker-count]")).toHaveText("2 markers", { timeout: 25000 });
	await page.evaluate(() => window.dispatchEvent(new Event("test-recording-marker")));
	await expect(page.locator("[data-recording-marker-count]")).toHaveText("3 markers");
});
