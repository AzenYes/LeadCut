import { expect, test } from "@playwright/test";
import { installDesktopBridge, installDesktopBridgeOverrides } from "./bridge";

test("reviews, auditions, restores, and accepts an Agent cut with one-step undo", async ({ page }) => {
	test.setTimeout(90_000);
	await installDesktopBridge(page, "waveform.mp4");
	await installDesktopBridgeOverrides(page, () => {
		const path = "/projects/Agent cut.leadcut";
		window.electronAPI.loadCurrentProjectFile = async () => ({
			success: true, path, revision: "review-mode",
			project: {
				version: 2, projectId: "review-mode",
				videoPath: `${location.origin}/tests/ui/fixtures/waveform.mp4`,
				editor: {
					clipRegions: [
						{ id: "earlier", startMs: 0, endMs: 2000, sourceStartMs: 0, speed: 1 },
						{ id: "later", startMs: 2000, endMs: 4000, sourceStartMs: 4000, speed: 1 },
					],
					autoCaptions: [{ id: "after", startMs: 2500, endMs: 3500, text: "Later", timeBasis: "timeline" }],
					autoCaptionSettings: { enabled: true },
					changeLog: { version: 1, entries: [{
						id: "repeat", kind: "cut", source: "agent", createdAt: "2026-11-19T00:00:00.000Z",
						batchId: "agent-1", rangeIndex: 0, sourceStartMs: 2000, sourceEndMs: 4000,
						speed: 1, durationMs: 2000, timelineMs: 2000, reason: "重复", confidence: "low", review: "pending",
					}] },
				},
			},
		});
	});
	await page.goto("/?windowType=editor");
	const clips = page.locator('[data-variant="clip"][data-region-id]');
	await expect(clips).toHaveCount(2, { timeout: 30000 });
	await expect(page.getByLabel("Loading preview", { exact: true })).toHaveCount(0, { timeout: 30000 });
	await page.getByRole("radio", { name: "Review cuts", exact: true }).click();
	const panel = page.getByRole("region", { name: "Review cuts", exact: true });
	await expect(panel.getByRole("listitem")).toHaveCount(1);
	await expect(panel.getByText("重复", { exact: true })).toBeVisible();
	await expect(page.getByTestId("cut-marker")).toHaveCount(1);
	await expect(page.getByTestId("cut-marker")).toHaveAttribute("data-confidence", "low");
	await page.keyboard.press("]");
	const time = page.getByRole("textbox", { name: "Timeline timecode", exact: true });
	await expect(time).toHaveValue("00:00:02.000");

	await panel.getByRole("button", { name: "Audition cut", exact: true }).click();
	await expect(page.getByRole("button", { name: "Pause", exact: true })).toBeVisible();
	await expect(page.getByRole("button", { name: "Play", exact: true })).toBeVisible({ timeout: 12000 });
	await expect(time).toHaveValue("00:00:04.000");

	await panel.getByRole("button", { name: "Restore segment", exact: true }).click();
	await expect(clips).toHaveCount(3);
	await expect(page.getByTestId("cut-marker")).toHaveCount(0);
	await expect(panel.getByText("1 / 1 reviewed", { exact: true })).toBeVisible();
	await expect(page.locator('[data-variant="caption"]')).toHaveAttribute("data-start-ms", "4500");
	await page.getByRole("button", { name: "Undo", exact: true }).click();
	await expect(clips).toHaveCount(2);
	await expect(panel.getByText("Pending", { exact: true })).toBeVisible();
	await expect(page.locator('[data-variant="caption"]')).toHaveAttribute("data-start-ms", "2500");
	await page.keyboard.press("Shift+a");
	await expect(panel.getByText("Accepted", { exact: true })).toBeVisible();
	await expect(panel.getByText("1 / 1 reviewed", { exact: true })).toBeVisible();
	await expect(clips).toHaveCount(2);
});

test("focuses a cut and exports its saved redo note for an Agent", async ({ page }) => {
	test.setTimeout(120_000);
	await installDesktopBridge(page, "waveform.mp4");
	await installDesktopBridgeOverrides(page, () => {
		const filePath = "/projects/Cut review.leadcut";
		const cut = {
			kind: "cut", source: "agent", batchId: "batch-1", review: "pending", speed: 1,
			createdAt: "2026-11-22T00:00:00.000Z",
		};
		const initial = {
			version: 2, projectId: "redo-review",
			videoPath: `${location.origin}/tests/ui/fixtures/waveform.mp4`,
			editor: {
				clipRegions: [
					{ id: "before", startMs: 0, endMs: 1000, sourceStartMs: 0, speed: 1 },
					{ id: "middle", startMs: 1000, endMs: 3500, sourceStartMs: 2000, speed: 1 },
					{ id: "last", startMs: 3500, endMs: 4500, sourceStartMs: 5000, speed: 1 },
				],
				changeLog: { version: 1, entries: [
					{ ...cut, id: "first-seam", rangeIndex: 0, sourceStartMs: 1000, sourceEndMs: 2000, durationMs: 1000, timelineMs: 1000 },
					{ ...cut, id: "second-seam", rangeIndex: 1, sourceStartMs: 4500, sourceEndMs: 5000, durationMs: 500, timelineMs: 3500 },
				] },
			},
		};
		window.electronAPI.loadCurrentProjectFile = async () => ({
			success: true, path: filePath, revision: "redo",
			project: JSON.parse(sessionStorage.getItem("saved-redo") ?? JSON.stringify(initial)),
		});
		window.electronAPI.saveProjectFile = async data => {
			sessionStorage.setItem("saved-redo", JSON.stringify(data));
			return { success: true, path: filePath, projectId: "redo-review", revision: "redo" };
		};
		window.electronAPI.saveCutReviewHandoff = async markdown => {
			sessionStorage.setItem("redo-handoff", markdown);
			return { success: true };
		};
	});
	await page.goto("/?windowType=editor");
	const scroll = page.getByTestId("timeline-scroll");
	const timeline = page.locator("[data-timeline-panel]");
	const clips = scroll.locator('[data-variant="clip"][data-region-id]');
	await expect(clips).toHaveCount(3, { timeout: 40000 });
	await page.getByRole("radio", { name: "Review cuts", exact: true }).click();
	const panel = page.getByRole("region", { name: "Review cuts", exact: true });
	const first = panel.locator('[data-review-entry="first-seam"]');
	const beforeHeight = (await timeline.boundingBox())!.height;
	await first.getByRole("button", { name: "Focus cut", exact: true }).click();
	await expect(scroll).toHaveAttribute("data-range-start-ms", "0");
	await expect(scroll).toHaveAttribute("data-range-end-ms", "3000");
	await expect(clips).toHaveCount(2);
	await expect(clips.last()).toHaveAttribute("data-region-id", "middle");
	expect((await timeline.boundingBox())!.height).toBeGreaterThan(beforeHeight);
	await panel.getByRole("button", { name: "Next change", exact: true }).click();
	await expect(scroll).toHaveAttribute("data-range-start-ms", "1500");
	await expect(scroll).toHaveAttribute("data-range-end-ms", "4500");
	await expect(clips.first()).toHaveAttribute("data-region-id", "middle");
	await timeline.getByRole("button", { name: "Return to full timeline", exact: true }).click();
	await expect(scroll).toHaveAttribute("data-range-start-ms", "0");
	await expect(scroll).toHaveAttribute("data-range-end-ms", "4500");
	await expect(clips).toHaveCount(3);
	expect((await timeline.boundingBox())!.height).toBe(beforeHeight);

	const note = "保留上一句尾音。\n```";
	await first.getByRole("button", { name: "Mark for redo", exact: true }).click();
	const modal = page.getByRole("dialog", { name: "Mark cut for redo", exact: true });
	await modal.getByRole("textbox", { name: "Redo note (optional)", exact: true }).fill(note);
	await modal.getByRole("button", { name: "Save redo request", exact: true }).click();
	await expect(first.getByText("Needs redo", { exact: true })).toBeVisible();
	await panel.getByRole("button", { name: "Export redo handoff (1)", exact: true }).click();
	const handoff = await page.evaluate(() => sessionStorage.getItem("redo-handoff")!);
	const [, json] = handoff.split("```");
	expect(JSON.parse(json.replace(/^json\n/, ""))).toMatchObject({
		version: 1, project: { path: "/projects/Cut review.leadcut", id: "redo-review" },
		cuts: [{ cutId: "first-seam", sequenceTimeMs: 1000, sourceStartMs: 1000, sourceEndMs: 2000, reviewNote: note }],
	});
	await expect.poll(() => page.evaluate(() => JSON.parse(sessionStorage.getItem("saved-redo") ?? "null")
		?.editor.changeLog.entries[0].redo?.note)).toBe(note);
	await page.reload();
	await page.getByRole("radio", { name: "Review cuts", exact: true }).click();
	await expect(first.getByText("Needs redo", { exact: true })).toBeVisible();
	await first.getByRole("button", { name: "Edit redo note", exact: true }).click();
	await expect(modal.getByRole("textbox")).toHaveValue(note);
	await modal.getByRole("button", { name: "Clear redo request", exact: true }).click();
	await expect(panel.getByRole("button", { name: /Export redo handoff/ })).toHaveCount(0);
});
