import { expect, type Locator, type Page } from "@playwright/test";
import { installDesktopBridge, installDesktopBridgeOverrides } from "./bridge";

export async function openTransportPositionFixture(page: Page) {
	await installDesktopBridge(page, "waveform.mp4");
	await installDesktopBridgeOverrides(page, () => {
		const videoPath = `${location.origin}/tests/ui/fixtures/waveform.mp4`;
		window.electronAPI.loadCurrentProjectFile = async () => ({
			success: true,
			path: "/projects/transport-position.leadcut",
			project: {
				version: 2,
				projectId: "transport-position",
				videoPath,
				editor: {
					clipRegions: [
						{ id: "first", startMs: 0, endMs: 6000, sourceStartMs: 0, speed: 1 },
						{ id: "second", startMs: 6000, endMs: 12000, sourceStartMs: 0, speed: 1 },
					],
				},
			},
		});
	});
	await page.goto("/?windowType=editor");
	await expect(page.locator('[data-variant="clip"][data-region-id]')).toHaveCount(2, { timeout: 25000 });
	await expect(page.getByLabel("Loading preview", { exact: true })).toHaveCount(0, { timeout: 25000 });
	await page.evaluate(() => document.fonts.ready.then(() => undefined));
}

export async function expectStableTransportPosition(
	editor: Page,
	transport: Page,
	switchRate: () => Promise<void>,
) {
	const timecode = editor.getByRole("textbox", { name: "Timeline timecode" });
	const shownTime = transport.getByTestId("preview-current-time");
	const play = transport.getByRole("button", { name: "Play", exact: true });
	const pause = transport.getByRole("button", { name: "Pause", exact: true });
	const seek = async (value: string) => {
		await timecode.fill(value);
		await timecode.press("Enter");
		await expect(shownTime).toHaveText(value);
	};
	const buttonX = async (button: Locator) => (await button.boundingBox())!.x;
	const start = "00:00:00.000";
	await seek(start);
	const baseline = await buttonX(play);
	for (const value of ["00:00:01.111", "00:00:09.999", "00:00:10.000", "00:00:11.111"]) {
		await seek(value);
		expect.soft(Math.abs(await buttonX(play) - baseline), value).toBeLessThan(0.01);
	}
	await seek(start);
	await play.click();
	const offsets = await pause.evaluate(button => new Promise<number[]>((resolve) => {
		const started = performance.now();
		const positions: number[] = [];
		const sample = (now: number) => {
			positions.push(button.getBoundingClientRect().x);
			if (now - started >= 2000) resolve(positions);
			else requestAnimationFrame(sample);
		};
		requestAnimationFrame(sample);
	}));
	expect(offsets.length).toBeGreaterThan(1);
	await expect(shownTime).not.toHaveText(start);
	expect.soft(Math.max(...offsets.map(x => Math.abs(x - baseline)))).toBeLessThan(0.01);
	await pause.click();
	await switchRate();
	expect(Math.abs(await buttonX(play) - baseline)).toBeLessThan(0.01);
}
