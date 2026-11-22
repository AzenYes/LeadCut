import { expect, test } from "@playwright/test";
import { installDesktopBridge, installDesktopBridgeOverrides } from "./bridge";

test("manual ripple deletion saves a source-time record and undo removes only that record", async ({ page }) => {
	await installDesktopBridge(page, "filmstrip.mp4");
	await installDesktopBridgeOverrides(page, () => {
		const project = {
			version: 2,
			projectId: "change-log-test",
			videoPath: `${location.origin}/tests/ui/fixtures/filmstrip.mp4`,
			futureTop: { value: true },
			editor: {
				futureField: { note: "keep" },
				clipRegions: [
					{ id: "clip-1", startMs: 0, endMs: 2000, sourceStartMs: 0, speed: 1 },
					{ id: "clip-2", startMs: 2000, endMs: 3000, sourceStartMs: 3500, speed: 2 },
				],
				changeLog: { version: 1, entries: [{
					id: "agent-cut", kind: "cut", source: "agent", batchId: "before",
					createdAt: "2026-11-19T12:30:00.000Z", rangeIndex: 0,
					sourceStartMs: 2100, sourceEndMs: 3100, speed: 1, durationMs: 1000,
					timelineMs: 2000, reason: "Repeated phrase", confidence: "high", review: "accepted",
				}] },
			},
		};
		window.electronAPI.loadCurrentProjectFile = async () => ({
			success: true, path: "/projects/change-log.leadcut", revision: "initial", project,
		});
		window.electronAPI.saveProjectFile = async (data, _name, file) => {
			sessionStorage.setItem("test-change-log-save", JSON.stringify(data));
			return { success: true, path: file, projectId: project.projectId, revision: "latest" };
		};
	});
	await page.goto("/?windowType=editor");
	const clips = page.locator('[data-variant="clip"]');
	await expect(clips).toHaveCount(2, { timeout: 20000 });
	await page.getByRole("button", { name: /^Clip 2x/ }).click();
	await page.keyboard.press("F3");
	await expect(clips).toHaveCount(1);
	const readSaved = () => page.evaluate(() => JSON.parse(sessionStorage.getItem("test-change-log-save") ?? "null"));
	await expect.poll(readSaved).toMatchObject({
		futureTop: { value: true },
		editor: {
			futureField: { note: "keep" },
			changeLog: { entries: [
				{ id: "agent-cut", review: "accepted", reason: "Repeated phrase" },
				{ kind: "cut", source: "manual", timelineMs: 2000, sourceStartMs: 3500, sourceEndMs: 5500, speed: 2, durationMs: 1000 },
			] },
		},
	});
	await page.getByRole("button", { name: "Undo", exact: true }).click();
	await expect(clips).toHaveCount(2);
	await expect.poll(readSaved).toMatchObject({
		editor: { changeLog: { entries: [{ id: "agent-cut", review: "accepted" }] } },
	});
});
