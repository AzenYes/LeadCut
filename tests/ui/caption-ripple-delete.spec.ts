import { expect, test, type Page } from "@playwright/test";
import { installDesktopBridge, installDesktopBridgeOverrides } from "./bridge";

async function openCaptionList(page: Page, timedWords = false) {
	await installDesktopBridge(page, "waveform.mp4");
	await installDesktopBridgeOverrides(page, (timedWords) => {
		const video = `${location.origin}/tests/ui/fixtures/waveform.mp4`;
		const broll = `${location.origin}/tests/ui/fixtures/broll-blue.mp4`;
		const path = "/projects/caption-ripple.leadcut";
		const captions = timedWords ? [{
			id: "words", startMs: 700, endMs: 1500, text: "Keep well rest",
			words: [
				{ text: "Keep", startMs: 700, endMs: 850 },
				{ text: "well", startMs: 900, endMs: 1100, leadingSpace: true },
				{ text: "rest", startMs: 1150, endMs: 1500, leadingSpace: true },
			],
		}] : [
			{ id: "one", startMs: 1000, endMs: 1800, text: "First remove" },
			{ id: "two", startMs: 1800, endMs: 3000, text: "Second remove" },
			{ id: "three", startMs: 3500, endMs: 4300, text: "Keep this" },
		];
		window.electronAPI.loadCurrentProjectFile = async () => ({
			success: true, path, revision: "before",
			project: {
				version: 2, projectId: "caption-ripple", videoPath: video,
				editor: {
					clipRegions: [{ id: "primary", startMs: 0, endMs: 6000, sourceStartMs: 0, speed: 1 }],
					autoCaptionSettings: { enabled: true },
					autoCaptions: captions.map(cue => ({ ...cue, timeBasis: "timeline" })),
					videoTracks: [{ id: "visual", kind: "video", name: "B-roll" }],
					videoRegions: [{ id: "broll", trackId: "visual", sourcePath: broll, sourceDurationMs: 6000, sourceStartMs: 0, startMs: 3000, endMs: 5600, speed: 1, volume: 1 }],
					audioRegions: [{ id: "audio", audioPath: video, sourceStartMs: 0, startMs: 0, endMs: 6000, volume: 1 }],
				},
			},
		});
		window.electronAPI.saveProjectFile = async (data) => {
			sessionStorage.setItem("caption-ripple-project", JSON.stringify(data));
			return { success: true, path, revision: "after", projectId: "caption-ripple" };
		};
	}, timedWords);
	await page.goto("/?windowType=editor");
	await page.getByRole("radio", { name: "Caption transcript", exact: true }).click({ timeout: 50000 });
	return page.getByRole("region", { name: "Caption transcript", exact: true });
}

test("cuts two captions across the picture and sound tracks and restores everything in one undo", async ({ page }) => {
	test.setTimeout(90000);
	const panel = await openCaptionList(page);
	const scrubber = page.getByRole("slider", { name: "Preview progress" });
	const rows = panel.locator("[data-caption-overview-row]");
	await expect(scrubber).toHaveAttribute("aria-valuemax", "6000");
	await panel.getByText("First remove", { exact: true }).click();
	await panel.getByText("Second remove", { exact: true }).click({ modifiers: ["Shift"] });
	await expect(rows.nth(0)).toHaveAttribute("aria-selected", "true");
	await expect(rows.nth(1)).toHaveAttribute("aria-selected", "true");
	await panel.locator("summary[aria-label='Caption actions']").click();
	await panel.getByRole("button", { name: "Delete corresponding footage" }).click();
	const dialog = page.getByRole("dialog", { name: "Delete corresponding footage" });
	await expect(dialog).toContainText("2 selected captions (2 seconds)");
	await dialog.getByRole("button", { name: "Delete picture and sound" }).click();
	await expect(scrubber).toHaveAttribute("aria-valuemax", "4000");
	await expect(rows).toHaveCount(1);
	await expect(rows.first()).toHaveAttribute("data-start-ms", "1500");

	const readSaved = () => page.evaluate(() =>
		JSON.parse(sessionStorage.getItem("caption-ripple-project") ?? "{}").editor,
	);
	await expect.poll(readSaved).toMatchObject({
		videoRegions: [{ id: "broll", startMs: 1000, endMs: 3600 }],
		audioRegions: [{ id: "audio", startMs: 0, endMs: 1000 }, { startMs: 1000, endMs: 4000, sourceStartMs: 3000 }],
		changeLog: { entries: [{ source: "manual", reason: "Cut by caption", sourceStartMs: 1000, sourceEndMs: 3000 }] },
	});
	await page.getByRole("button", { name: "Undo", exact: true }).click();
	await expect(scrubber).toHaveAttribute("aria-valuemax", "6000");
	await expect(rows).toHaveCount(3);
	await expect(rows.last()).toHaveAttribute("data-start-ms", "3500");
	await expect.poll(readSaved).toMatchObject({
		videoRegions: [{ id: "broll", startMs: 3000, endMs: 5600 }],
		audioRegions: [{ id: "audio", startMs: 0, endMs: 6000 }],
		changeLog: { entries: [] },
	});
});

test("Shift+Delete cuts the selected timed word with forty milliseconds of padding on either side", async ({ page }) => {
	test.setTimeout(90000);
	const panel = await openCaptionList(page, true);
	await panel.getByText("Keep well rest", { exact: true }).click();
	const input = panel.getByRole("textbox", { name: "Edit caption text" });
	await expect(input).toBeFocused();
	await input.evaluate((element: HTMLInputElement) => element.setSelectionRange(5, 9));
	await input.press("Shift+Delete");
	const dialog = page.getByRole("dialog", { name: "Delete corresponding footage" });
	await expect(dialog).toContainText("selected words (0.28 seconds)");
	await expect(dialog).toContainText("Listen after cutting");
	await dialog.getByRole("button", { name: "Delete picture and sound" }).click();
	await expect(page.getByRole("slider", { name: "Preview progress" })).toHaveAttribute("aria-valuemax", "5720");
	await expect.poll(() => page.evaluate(() =>
		JSON.parse(sessionStorage.getItem("caption-ripple-project") ?? "{}").editor?.changeLog.entries,
	)).toMatchObject([{ sourceStartMs: 860, sourceEndMs: 1140, durationMs: 280 }]);
	await expect(panel.getByText("well", { exact: true })).toHaveCount(0);
});
