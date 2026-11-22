import { expect, test } from "@playwright/test";
import { installDesktopBridge, installDesktopBridgeOverrides } from "./bridge";

test("stores source-time markers, keeps notes and colors on reload, and undoes one marker operation", async ({ page }) => {
	test.setTimeout(90000);
	await installDesktopBridge(page, "waveform.mp4");
	await installDesktopBridgeOverrides(page, () => {
		const project = {
			version: 2,
			projectId: "marker-test",
			videoPath: `${location.origin}/tests/ui/fixtures/waveform.mp4`,
			editor: { clipRegions: [{ id: "marker-test-clip", startMs: 0, endMs: 6000, sourceStartMs: 0, speed: 1 }] },
		};
		const path = "/projects/marker-test.leadcut";
		window.electronAPI.loadCurrentProjectFile = async () => ({
			success: true, path, revision: "initial",
			project: JSON.parse(sessionStorage.getItem("marker-test-project") ?? JSON.stringify(project)),
		});
		window.electronAPI.saveProjectFile = async (data) => {
			sessionStorage.setItem("marker-test-project", JSON.stringify(data));
			return { success: true, path, projectId: project.projectId, revision: "updated" };
		};
	});

	await page.goto("/?windowType=editor");
	await expect(page.locator('[data-region-id="marker-test-clip"]')).toBeVisible({ timeout: 50000 });
	await expect(page.getByLabel("Loading preview", { exact: true })).toHaveCount(0, { timeout: 30000 });
	const scrubber = page.getByRole("slider", { name: "Preview progress" });
	const markers = page.getByTestId("timeline-marker");
	const seekAndMark = async (second: number) => {
		await scrubber.press("Home");
		await expect(scrubber).toHaveAttribute("aria-valuenow", "0");
		for (let step = 1; step <= second; step++) {
			await scrubber.press("ArrowRight");
			await expect(scrubber).toHaveAttribute("aria-valuenow", String(step * 1000));
		}
		await expect(scrubber).toHaveAttribute("aria-valuenow", String(second * 1000));
		await page.keyboard.press("f");
	};
	await seekAndMark(1);
	await expect(markers).toHaveCount(1);
	await markers.first().click();
	const note = page.getByRole("textbox", { name: "Marker note" });
	await note.fill("Review the opening");
	await page.getByRole("button", { name: "Marker color: Blue" }).click();
	await expect(page.getByRole("button", { name: "Marker color: Blue" })).toHaveAttribute("aria-pressed", "true");
	await seekAndMark(3);
	await seekAndMark(4);
	await expect(markers).toHaveCount(3);

	const readSavedMarkers = () => page.evaluate(() =>
		JSON.parse(sessionStorage.getItem("marker-test-project") ?? "{}").editor?.markers,
	);
	await expect.poll(readSavedMarkers).toMatchObject([
		{ sourceTimeMs: 1000, origin: "editor", note: "Review the opening", color: "blue" },
		{ sourceTimeMs: 3000, origin: "editor" },
		{ sourceTimeMs: 4000, origin: "editor" },
	]);
	await page.reload();
	await expect(markers).toHaveCount(3);
	await markers.first().click();
	await expect(note).toHaveValue("Review the opening");
	await expect(page.getByRole("button", { name: "Marker color: Blue" })).toHaveAttribute("aria-pressed", "true");

	const undo = page.getByRole("button", { name: "Undo", exact: true });
	await undo.click();
	await expect(markers).toHaveCount(2);
	await expect.poll(readSavedMarkers).toHaveLength(2);

	// Dragging previews a new position. Undo restores the position at mouse-down in one operation.
	const first = markers.first();
	const box = (await first.boundingBox())!;
	await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
	await page.mouse.down();
	await page.mouse.move(box.x + box.width / 2 + 95, box.y + box.height / 2, { steps: 8 });
	await expect(first).toHaveAttribute("data-source-time-ms", "1000");
	await page.mouse.up();
	await expect(first).not.toHaveAttribute("data-source-time-ms", "1000");
	await undo.click();
	await expect(first).toHaveAttribute("data-source-time-ms", "1000");
});
