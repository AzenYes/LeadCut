import { expect, test, type Page } from "@playwright/test";
import { installDesktopBridge, installDesktopBridgeOverrides } from "./bridge";

async function openEditor(page: Page, emptyTimeline = false) {
	await installDesktopBridge(page, "waveform.mp4");
	await installDesktopBridgeOverrides(page, empty => {
		window.electronAPI.loadCurrentProjectFile = async () => ({
			success: true, path: "/projects/Empty state.leadcut",
			project: {
				version: 2, videoPath: `${location.origin}/tests/ui/fixtures/waveform.mp4`, editor: {
					clipRegions: empty ? [] : [{ id: "screen", startMs: 0, endMs: 5000, sourceStartMs: 0, speed: 1 }],
				},
			},
		});
		window.electronAPI.importSrtCaptions = async () => ({
			success: true, path: "/captions/example.srt",
			cues: [{ id: "imported", text: "First imported caption", startMs: 200, endMs: 1200, timeBasis: "timeline" }],
		});
	}, emptyTimeline);
	await page.goto("/?windowType=editor");
}

test("an empty caption transcript links to model setup and imports SRT directly", async ({ page }) => {
	await openEditor(page);
	const captionTab = page.getByRole("radio", { name: "Caption transcript", exact: true });
	await captionTab.click({ timeout: 20_000 });
	await page.getByRole("button", { name: "Set up caption recognition", exact: true }).click();
	await expect(page.getByRole("button", { name: "Download Model", exact: true })).toBeVisible();
	await captionTab.click();
	const transcript = page.getByRole("region", { name: "Caption transcript", exact: true });
	await transcript.getByRole("button", { name: "Import SRT", exact: true }).click();
	await expect(transcript.getByRole("row")).toContainText("First imported caption");
	await expect(transcript.getByRole("button", { name: "Import SRT", exact: true })).toHaveCount(0);
});

test("an empty timeline opens the clips library from the timeline", async ({ page }) => {
	await openEditor(page, true);
	await page.getByRole("button", { name: "Browse clips", exact: true }).click({ timeout: 20_000 });
	await expect(page.getByRole("button", { name: "Clips", exact: true })).toHaveAttribute("aria-expanded", "true");
	await expect(page.locator('[data-variant="clip"]')).toHaveCount(0);
});
