import { expect, test } from "@playwright/test";
import { installDesktopBridge, installDesktopBridgeOverrides } from "./bridge";

test("flags long and overlapping captions, filters issues and keeps the enabled rules", async ({ page }) => {
	test.setTimeout(90000);
	await installDesktopBridge(page, "waveform.mp4");
	await installDesktopBridgeOverrides(page, () => {
		const baseGet = window.electronAPI.getAppSetting;
		const key = "leadcut.captions.qualityRules.v1";
		window.electronAPI.getAppSetting = name => name === key
			? JSON.parse(sessionStorage.getItem(key) ?? "null") : baseGet(name);
		window.electronAPI.setAppSetting = (name, value) => {
			if (name === key) sessionStorage.setItem(key, JSON.stringify(value));
			return true;
		};
		window.electronAPI.loadCurrentProjectFile = async () => ({
			success: true, path: "/projects/Caption quality.leadcut", revision: "quality",
			project: {
				version: 2, projectId: "quality",
				videoPath: `${location.origin}/tests/ui/fixtures/waveform.mp4`,
				editor: {
					clipRegions: [{ id: "quality-clip", startMs: 0, endMs: 6000, sourceStartMs: 0, speed: 1 }],
					autoCaptionSettings: { enabled: true, maxRows: 2 },
					autoCaptions: [
						{ startMs: 500, endMs: 1150, text: "字幕".repeat(50) },
						{ startMs: 1700, endMs: 2500, text: "Overlap one" },
						{ startMs: 2300, endMs: 2900, text: "Overlap two" },
						{ startMs: 3500, endMs: 4400, text: "Clear one" },
						{ startMs: 4500, endMs: 5500, text: "Clear two" },
					].map((cue, index) => ({ id: `quality-${index}`, timeBasis: "timeline", ...cue })),
				},
			},
		});
	});
	await page.goto("/?windowType=editor");
	const open = () => page.getByRole("radio", { name: "Caption transcript", exact: true }).click({ timeout: 50000 });
	await open();
	const panel = page.getByRole("region", { name: "Caption transcript", exact: true });
	const rows = panel.locator("[data-caption-overview-row]");
	await expect(rows).toHaveCount(5);
	await expect(rows.first()).toHaveAttribute("data-issue", "tooWide");
	await expect(rows.first()).toContainText("Exceeds single-line width (wraps)");
	await expect(rows.nth(1)).toHaveAttribute("data-issue", "overlap");
	await expect(rows.nth(2)).toHaveAttribute("data-issue", "overlap");
	const count = panel.getByTestId("caption-quality-count");
	await expect(count).toHaveText("3 captions with issues");
	await panel.getByRole("checkbox", { name: "Only show issues" }).check();
	await expect(rows).toHaveCount(3);
	const next = panel.getByRole("button", { name: "Next issue" });
	await next.click();
	await expect(rows.first()).toHaveAttribute("aria-selected", "true");
	await next.click();
	await expect(rows.nth(1)).toHaveAttribute("aria-selected", "true");
	await panel.locator("summary[aria-label='Transcript options']").click();
	await panel.getByText("Quality rules", { exact: true }).click();
	await panel.getByRole("checkbox", { name: "Exceeds single-line width", exact: true }).uncheck();
	await expect(count).toHaveText("2 captions with issues");
	await expect(rows).toHaveCount(3);
	await expect(rows.first()).toContainText("Resolved");
	await panel.getByRole("checkbox", { name: "Only show issues" }).uncheck();
	await panel.getByRole("checkbox", { name: "Only show issues" }).check();
	await expect(rows).toHaveCount(2);
	await page.reload();
	await open();
	await expect(count).toHaveText("2 captions with issues");
	await expect(rows.first()).not.toHaveAttribute("data-issue", "tooWide");
});

test("keeps a resolved caption in the issue filter after splitting it", async ({ page }) => {
	await installDesktopBridge(page, "waveform.mp4");
	await installDesktopBridgeOverrides(page, () => {
		window.electronAPI.loadCurrentProjectFile = async () => ({
			success: true, path: "/projects/Caption split quality.leadcut", revision: "quality",
			project: {
				version: 2, projectId: "quality-split",
				videoPath: `${location.origin}/tests/ui/fixtures/waveform.mp4`,
				editor: {
					clipRegions: [{ id: "clip", startMs: 0, endMs: 6000, sourceStartMs: 0, speed: 1 }],
					autoCaptionSettings: { enabled: true },
					autoCaptions: [{ id: "long", startMs: 0, endMs: 1800, text: "字幕校对", timeBasis: "timeline" }],
				},
			},
		});
	});
	await page.goto("/?windowType=editor");
	await page.getByRole("radio", { name: "Caption transcript", exact: true }).click();
	const panel = page.getByRole("region", { name: "Caption transcript", exact: true });
	await panel.locator("summary[aria-label='Transcript options']").click();
	await panel.getByText("Quality rules", { exact: true }).click();
	const maximum = panel.getByRole("spinbutton", { name: "Maximum duration (ms)" });
	await maximum.fill("1000");
	await maximum.press("Enter");
	await panel.locator("summary[aria-label='Transcript options']").click();
	const issueFilter = panel.getByRole("checkbox", { name: "Only show issues" });
	await issueFilter.check();
	await panel.locator("[data-caption-text]").click();
	const input = panel.getByRole("textbox", { name: "Edit caption text" });
	await input.evaluate(element => (element as HTMLTextAreaElement).setSelectionRange(2, 2));
	await input.press("Enter");
	const resolved = panel.locator("[data-caption-id='long']");
	await expect(resolved).toContainText("Resolved");
	await issueFilter.uncheck();
	await issueFilter.check();
	await expect(resolved).toHaveCount(0);
});
