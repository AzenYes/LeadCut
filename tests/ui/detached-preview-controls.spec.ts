import { expect, test } from "@playwright/test";
import { installDesktopBridge, installDesktopBridgeOverrides } from "./bridge";
import { expectStableTransportPosition, openTransportPositionFixture } from "./preview-transport-position";

test("detached playback button stays in place while seeking, playing and switching speed", async ({ page, context }) => {
	await openTransportPositionFixture(page);
	const newWindow = context.waitForEvent("page");
	await page.getByRole("button", { name: "Detach preview", exact: true }).click();
	const preview = await newWindow;
	await preview.evaluate(() => document.fonts.ready.then(() => undefined));
	await expectStableTransportPosition(page, preview, () =>
		preview.getByRole("button", { name: "2×", exact: true }).click(),
	);
});

test("detached transport controls the editor and restores the last window position", async ({ page, context }) => {
	await installDesktopBridge(page, "waveform.mp4");
	await installDesktopBridgeOverrides(page, () => {
		window.electronAPI.getAppSetting = key => {
			if (key === "leadcut.onboarding.v1.seen") return true;
			const value = localStorage.getItem(key);
			return value === null ? null : JSON.parse(value);
		};
		window.electronAPI.setAppSetting = (key, value) => {
			localStorage.setItem(key, JSON.stringify(value));
			return true;
		};
		window.electronAPI.getPreviewDisplayBounds = () => [{ x: 0, y: 0, width: 1920, height: 1080 }];
		const open = window.open.bind(window);
		window.open = (url, target, features) => {
			document.documentElement.dataset.previewWindowFeatures = features;
			const child = open(url, target, features);
			if (child && target === "leadcut-preview") {
				Object.defineProperties(child, {
					screenX: { value: 210 },
					screenY: { value: 120 },
					outerWidth: { value: 980 },
					outerHeight: { value: 680 },
				});
			}
			return child;
		};
	});
	await page.goto("/?windowType=editor");
	const clips = page.locator('[data-variant="clip"][data-region-id]');
	await expect(clips).toHaveCount(1, { timeout: 25000 });
	await expect(page.getByLabel("Loading preview", { exact: true })).toHaveCount(0, { timeout: 25000 });
	const timecode = page.getByRole("textbox", { name: "Timeline timecode" });
	await timecode.fill("00:00:01.500");
	await timecode.press("Enter");
	await page.keyboard.press("F2");
	await expect(clips).toHaveCount(2);

	const newWindow = context.waitForEvent("page");
	await page.getByRole("button", { name: "Detach preview", exact: true }).click();
	const preview = await newWindow;
	await expect(preview.locator("canvas")).toHaveCount(1, { timeout: 20000 });
	const rateButtons = preview.getByRole("group", { name: "Review playback speed" }).getByRole("button");
	await expect(rateButtons).toHaveCount(5);
	const rateButtonPositions = await rateButtons.evaluateAll(buttons =>
		buttons.map(button => button.getBoundingClientRect().y),
	);
	expect(new Set(rateButtonPositions).size).toBe(1);
	await preview.getByRole("button", { name: "3×", exact: true }).click();
	await expect(page.getByRole("combobox", { name: "Review playback speed" })).toHaveValue("3");
	await preview.getByRole("button", { name: "1.5×", exact: true }).click();
	await expect(page.getByRole("combobox", { name: "Review playback speed" })).toHaveValue("1.5");
	await preview.getByRole("button", { name: "Play", exact: true }).click();
	await expect(page.getByRole("button", { name: "Pause", exact: true })).toBeVisible();
	await preview.getByRole("button", { name: "Pause", exact: true }).click();
	await expect(page.getByRole("button", { name: "Play", exact: true })).toBeVisible();
	const scrubber = preview.getByRole("slider", { name: "Preview progress" });
	const rect = (await scrubber.boundingBox())!;
	const y = rect.y + rect.height / 2;
	await preview.mouse.move(rect.x + rect.width / 4, y);
	await preview.mouse.down();
	await preview.mouse.move(rect.x + rect.width / 2, y, { steps: 5 });
	await preview.mouse.up();
	const time = async () => Number((await timecode.inputValue()).split(":").at(-1));
	await expect.poll(time).toBeCloseTo(3, 1);
	const beforeStep = await time();
	await preview.getByRole("button", { name: "Next frame", exact: true }).click();
	await expect.poll(time).toBeCloseTo(beforeStep + 0.033, 2);
	await preview.keyboard.press("Meta+z");
	await expect(clips).toHaveCount(1);
	await preview.getByRole("button", { name: "Dock preview", exact: true }).click();

	const nextWindow = context.waitForEvent("page");
	await page.getByRole("button", { name: "Detach preview", exact: true }).click();
	const reopened = await nextWindow;
	await expect(page.locator("html")).toHaveAttribute("data-preview-window-features", /width=980,height=680,left=210,top=120/);
	await reopened.getByRole("button", { name: "Dock preview", exact: true }).click();
	await expect(page.getByRole("slider", { name: "Preview progress" })).toBeVisible();
});
