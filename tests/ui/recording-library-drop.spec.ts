import { expect, test } from "@playwright/test";
import { installDesktopBridge, installDesktopBridgeOverrides } from "./bridge";

for (const panned of [false, true]) {
	test(`a recording drop follows the timeline scale (${panned ? "panned" : "dense"})`, async ({
		page,
	}) => {
		await page.setViewportSize({ width: 840, height: 800 });
		await installDesktopBridge(page, "waveform.mp4");
		await installDesktopBridgeOverrides(
			page,
			() => {
				const source = `${location.origin}/tests/ui/fixtures/waveform.mp4`;
				window.electronAPI.loadCurrentProjectFile = async () => ({
					success: true,
					path: "/projects/drop.leadcut",
					project: {
						version: 2,
						videoPath: source,
						editor: {
							clipRegions: Array.from({ length: 200 }, (_, index) => ({
								id: `clip-${index + 1}`,
								startMs: index * 30,
								endMs: (index + 1) * 30,
								sourceStartMs: index * 30,
								speed: 1,
							})),
						},
					},
				});
				window.electronAPI.importRecording = async () => ({
					success: true,
					value: {
						path: source,
						url: source,
						sourceStartMs: 6000,
						durationMs: 110,
						totalDurationMs: 6110,
					},
				});
				window.electronAPI.finishRecordingImport = async () => ({ success: true });
			},
			null,
		);
		await page.goto("/?windowType=editor");
		const row = page.locator('[data-timeline-row="row-clip"]');
		const firstClip = row.locator('[data-variant="clip"][data-start-ms="0"]');
		await expect(firstClip).toHaveCount(1, { timeout: 20_000 });
		const box = (await row.boundingBox())!;
		if (panned) {
			await page.mouse.move(box.x + box.width * 0.55, box.y + box.height * 0.5);
			await page.keyboard.down("Control");
			await page.mouse.wheel(0, -1600);
			await page.keyboard.up("Control");
			await page.mouse.wheel(700, 0);
			await expect(firstClip).toHaveCount(0);
		}
		const anchor = await row.evaluate((node, panned) => {
			const rowRect = node.getBoundingClientRect();
			const center = rowRect.x + rowRect.width * 0.55;
			const clips = Array.from(node.querySelectorAll<HTMLElement>('[data-variant="clip"]'));
			const index = clips.findIndex((clip) => clip.getBoundingClientRect().left >= center);
			const clip = clips[index];
			const rect = clip.getBoundingClientRect();
			const timeWidth = clips[index + 1].getBoundingClientRect().left - rect.left;
			if (!panned && rect.width <= timeWidth * 1.25)
				throw new Error(`Fixture needs a minimum-width clip (${timeWidth}, ${rect.width})`);
			return {
				end: Number(clip.dataset.endMs),
				x: rect.left + timeWidth * 0.65,
				y: rect.top + 10,
			};
		}, panned);
		const transfer = await page.evaluateHandle(() => {
			const transfer = new DataTransfer();
			transfer.setData("application/x-leadcut-recording", '["/recordings/insert.mp4"]');
			return transfer;
		});
		await row.dispatchEvent("drop", {
			dataTransfer: transfer,
			clientX: anchor.x,
			clientY: anchor.y,
			bubbles: true,
		});
		await expect
			.poll(() =>
				row.locator('[data-variant="clip"]').evaluateAll((clips) =>
					clips
						.map((clip) => {
							const { startMs, endMs } = (clip as HTMLElement).dataset;
							return [Number(startMs), Number(endMs)];
						})
						.find(([start, end]) => end - start === 110),
				),
			)
			.toEqual([anchor.end, anchor.end + 110]);
	});
}
