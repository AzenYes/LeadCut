import { expect, test } from "@playwright/test";
import { installDesktopBridge } from "./bridge";

for (const basis of ["timeline", "source"] as const) {
	test(`F2/F3 keep ${basis} captions and all media synchronized without changing the zoomed viewport`, async ({
		page,
	}) => {
		await installDesktopBridge(page, "filmstrip.mp4");
		await page.addInitScript((basis) => {
			window.electronAPI.loadCurrentProjectFile = async () => ({
				success: true,
				path: "/projects/cuts.leadcut",
				project: {
					version: 2,
					projectId: "cut-sync",
					videoPath: `${location.origin}/tests/ui/fixtures/filmstrip.mp4`,
					editor: {
						clipRegions: [
							{ id: "screen", startMs: 0, endMs: 6000, sourceStartMs: 0, speed: 1 },
						],
						autoCaptionSettings: { enabled: true },
						autoCaptions: [
							{
								id: "caption",
								...(basis === "timeline" ? { timeBasis: "timeline" } : {}),
								startMs: 0,
								endMs: 6000,
								text: "这是一句没有逐字时间的字幕",
							},
						],
						videoTracks: [{ id: "video-track", name: "B-roll", kind: "video" }],
						videoRegions: [
							{
								id: "video",
								trackId: "video-track",
								sourcePath: `${location.origin}/tests/ui/fixtures/filmstrip.mp4`,
								sourceDurationMs: 6000,
								sourceStartMs: 0,
								startMs: 0,
								endMs: 6000,
								speed: 1,
								volume: 1,
							},
						],
						audioRegions: [
							{
								id: "audio",
								audioPath: `${location.origin}/tests/ui/fixtures/filmstrip.mp4`,
								sourceStartMs: 0,
								startMs: 0,
								endMs: 6000,
								volume: 1,
							},
						],
					},
				},
			});
			window.electronAPI.saveProjectFile = async (project) => {
				sessionStorage.setItem("cut-sync", JSON.stringify(project));
				return { success: true, path: "/projects/cuts.leadcut" };
			};
		}, basis);
		await page.goto("/?windowType=editor");
		const clips = page.locator('[data-variant="clip"]');
		const captions = page.locator('[data-variant="caption"]');
		await expect(clips).toHaveCount(1, { timeout: 20000 });
		await expect(captions).toHaveCount(1);
		await expect(page.getByLabel("Loading preview", { exact: true })).toHaveCount(0, {
			timeout: 20000,
		});
		const timecode = page.getByRole("textbox", { name: "Timeline timecode", exact: true });
		for (const time of ["00:00:02.000", "00:00:04.000"]) {
			// Selecting the primary clip must still split its connected caption/media tracks.
			await clips.last().click({ position: { x: 40, y: 20 } });
			await timecode.fill(time);
			await timecode.press("Enter");
			await page.keyboard.press("F2");
		}
		for (const variant of ["clip", "caption", "video", "audio"])
			await expect(page.locator(`[data-variant="${variant}"]`)).toHaveCount(3);
		const originalWidth = (await clips.first().boundingBox())!.width;
		const row = (await page.locator('[data-timeline-row="row-clip"]').boundingBox())!;
		await page.mouse.move(row.x + 10, row.y + 20);
		await page.keyboard.down("Control");
		await page.mouse.wheel(0, -200);
		await page.keyboard.up("Control");
		await expect
			.poll(async () => (await clips.first().boundingBox())!.width)
			.toBeGreaterThan(originalWidth + 10);
		await clips.nth(1).click({ position: { x: 40, y: 20 } });
		const before = (await clips.first().boundingBox())!;
		await page.keyboard.press("F3");
		for (const variant of ["clip", "caption", "video", "audio"]) {
			const regions = page.locator(`[data-variant="${variant}"]`);
			await expect(regions).toHaveCount(2);
			await expect(regions.nth(0)).toHaveAttribute("data-start-ms", "0");
			await expect(regions.nth(0)).toHaveAttribute("data-end-ms", "2000");
			await expect(regions.nth(1)).toHaveAttribute("data-start-ms", "2000");
			await expect(regions.nth(1)).toHaveAttribute("data-end-ms", "4000");
		}
		const after = (await clips.first().boundingBox())!;
		expect(after.x).toBeCloseTo(before.x, 0);
		expect(after.width).toBeCloseTo(before.width, 0);
		await expect
			.poll(() =>
				page.evaluate(
					() =>
						JSON.parse(sessionStorage.getItem("cut-sync") || "{}").editor?.clipRegions
							?.length,
				),
			)
			.toBe(2);
		const saved = await page.evaluate(
			() => JSON.parse(sessionStorage.getItem("cut-sync")!).editor,
		);
		for (const regions of [saved.clipRegions, saved.videoRegions, saved.audioRegions])
			expect(regions[1].sourceStartMs).toBe(4000);
		await page.keyboard.press("Meta+z");
		for (const variant of ["clip", "caption", "video", "audio"])
			await expect(page.locator(`[data-variant="${variant}"]`)).toHaveCount(3);
		expect((await clips.first().boundingBox())!.width).toBeCloseTo(before.width, 0);
		await page.locator('[data-variant="video"]').nth(1).click({ position: { x: 40, y: 20 } });
		await page.keyboard.press("Delete");
		await expect(page.locator('[data-variant="video"]')).toHaveCount(2);
		for (const variant of ["clip", "caption", "audio"])
			await expect(page.locator(`[data-variant="${variant}"]`)).toHaveCount(3);
	});
}
