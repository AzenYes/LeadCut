import { expect, test, type Page } from "@playwright/test";
import { installDesktopBridge, installDesktopBridgeOverrides } from "./bridge";

async function openRecording(page: Page, mode: "default" | "disabled" | "saved" | "no-clicks" = "default") {
	await installDesktopBridge(page, "filmstrip.mp4");
	await installDesktopBridgeOverrides(page, mode => {
		localStorage.setItem("leadcut.locale", "en");
		const source = `${location.origin}/tests/ui/fixtures/filmstrip.mp4`;
		window.electronAPI.getPlatform = async () => "win32";
		window.electronAPI.getCurrentRecordingSession = async () => ({ success: true, session: { videoPath: source } });
		window.electronAPI.getCursorTelemetry = async () => ({ success: true, samples: [
			{ timeMs: 0, cx: 0.3, cy: 0.4, interactionType: "move" },
			{ timeMs: 1000, cx: 0.3, cy: 0.4, interactionType: mode === "no-clicks" ? "move" : "click" },
			{ timeMs: 4000, cx: 0.7, cy: 0.6, interactionType: mode === "no-clicks" ? "move" : "click" },
			{ timeMs: 5900, cx: 0.7, cy: 0.6, interactionType: "move" },
		] });
		if (mode === "disabled") {
			window.electronAPI.getAppSetting = key => key === "leadcut.editor.preferences"
				? { autoApplyFreshRecordingAutoZooms: false } : key === "leadcut.onboarding.v1.seen" ? true : null;
		}
		if (mode === "saved") {
			window.electronAPI.loadCurrentProjectFile = async () => ({ success: true, path: "/projects/saved.leadcut", project: {
				version: 2, projectId: "saved", videoPath: source, editor: {
					clipRegions: [{ id: "clip-1", startMs: 0, endMs: 6000, sourceStartMs: 0, speed: 1 }],
					zoomRegions: [{ id: "zoom-7", startMs: 2000, endMs: 2800, depth: 2, focus: { cx: 0.5, cy: 0.5 }, mode: "manual" }],
				},
			} });
		}
	}, mode);
	await page.goto("/?windowType=editor");
	await expect(page.locator("[data-preview-overlay]")).toBeVisible({ timeout: 20000 });
}

test("fresh recordings automatically receive click zooms with default preferences", async ({ page }) => {
	await openRecording(page);
	const zooms = page.locator('[data-variant="zoom"]');
	await expect(zooms).toHaveCount(2, { timeout: 10000 });
	await expect(zooms.nth(0)).toHaveAttribute("data-start-ms", "500");
	await expect(zooms.nth(1)).toHaveAttribute("data-start-ms", "3500");
	// Removing the generated effects is an edit, not a request to generate them again.
	await zooms.first().click({ position: { x: 20, y: 16 } });
	await page.keyboard.press("Delete");
	await expect(zooms).toHaveCount(1);
	await zooms.first().click({ position: { x: 20, y: 16 } });
	await page.keyboard.press("Delete");
	await expect(zooms).toHaveCount(0);
	await page.waitForTimeout(1200);
	await expect(zooms).toHaveCount(0);
});

for (const mode of ["disabled", "saved", "no-clicks"] as const) {
	test(`automatic zoom respects ${mode}`, async ({ page }) => {
		await openRecording(page, mode);
		await page.waitForTimeout(1500);
		const zooms = page.locator('[data-variant="zoom"]');
		await expect(zooms).toHaveCount(mode === "saved" ? 1 : 0);
		if (mode === "saved") await expect(zooms).toHaveAttribute("data-start-ms", "2000");
	});
}
