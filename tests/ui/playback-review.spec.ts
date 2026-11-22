import { expect, test } from "@playwright/test";
import { installDesktopBridge, installDesktopBridgeOverrides } from "./bridge";
import { expectStableTransportPosition, openTransportPositionFixture } from "./preview-transport-position";

test("main playback button stays in place while seeking, playing and switching speed", async ({ page }) => {
	await openTransportPositionFixture(page);
	await expectStableTransportPosition(page, page, () =>
		page.getByRole("combobox", { name: "Review playback speed" }).selectOption("2").then(() => undefined),
	);
});

test("review playback preserves pitch and speed, steps by a frame, and can stop a reverse shuttle", async ({ page }) => {
	await installDesktopBridge(page, "waveform.mp4");
	await installDesktopBridgeOverrides(page, () => {
		window.electronAPI.getAppSetting = key => {
			if (key === "leadcut.onboarding.v1.seen") return true;
			const stored = localStorage.getItem(key);
			return stored === null ? null : JSON.parse(stored);
		};
		window.electronAPI.setAppSetting = (key, value) => {
			localStorage.setItem(key, JSON.stringify(value));
			return true;
		};
	});
	await page.goto("/?windowType=editor");
	const play = page.getByRole("button", { name: "Play", exact: true });
	const pause = page.getByRole("button", { name: "Pause", exact: true });
	const rate = page.getByRole("combobox", { name: "Review playback speed" });
	const timecode = page.getByTestId("preview-current-time");
	await expect(page.locator('[data-variant="clip"][data-region-id]')).toHaveCount(1, { timeout: 25000 });
	await expect(page.getByLabel("Loading preview", { exact: true })).toHaveCount(0, { timeout: 25000 });
	await expect(rate).toHaveValue("1");
	for (const value of ["1.25", "1.5", "2"]) {
		await page.keyboard.press("Shift+.");
		await expect(rate).toHaveValue(value);
	}
	await page.keyboard.press("Shift+>");
	await expect(rate).toHaveValue("3");
	await page.keyboard.press("Shift+.");
	await expect(rate).toHaveValue("3");
	await page.keyboard.press("Shift+<");
	await expect(rate).toHaveValue("2");
	await rate.selectOption("1.5");
	await play.click();
	await expect(pause).toBeVisible();
	const source = page.locator('video[aria-hidden="true"]');
	await expect.poll(() => source.evaluate((video: HTMLVideoElement) => [video.playbackRate, video.preservesPitch]))
		.toEqual([1.5, true]);
	await pause.click();
	await expect(play).toBeVisible();
	await play.click();
	await expect(pause).toBeVisible();
	await expect(rate).toHaveValue("1.5");
	await pause.click();
	await expect(play).toBeVisible();
	await page.keyboard.press("Home");
	await expect(timecode).toHaveText("00:00:00.000");
	await page.keyboard.press("ArrowRight");
	await expect(timecode).toHaveText("00:00:00.033");
	await page.keyboard.press("Shift+ArrowRight");
	await expect(timecode).toHaveText("00:00:01.033");
	await page.keyboard.press("Shift+ArrowRight");
	await expect(timecode).toHaveText("00:00:02.033");
	await page.keyboard.press("j");
	await expect(pause).toBeVisible();
	await expect.poll(async () => Number((await timecode.textContent())?.split(":").at(-1))).toBeLessThan(2);
	await page.keyboard.press("k");
	await expect(play).toBeVisible();
	const pausedAt = await timecode.textContent();
	await page.waitForTimeout(150);
	await expect(timecode).toHaveText(pausedAt ?? "");
	await rate.selectOption("3");
	await expect.poll(() => source.evaluate((video: HTMLVideoElement) => [video.playbackRate, video.preservesPitch]))
		.toEqual([3, true]);
	await page.reload();
	await expect(rate).toHaveValue("3", { timeout: 25000 });
	await expect(timecode).toHaveText(/^\d{2}:\d{2}:\d{2}\.\d{3}$/);
});
