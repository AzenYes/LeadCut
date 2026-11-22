import { expect, test } from "@playwright/test";
import { installDesktopBridge, installDesktopBridgeOverrides } from "./bridge";

for (const savedRoundness of [undefined, 69]) {
	test(`new recording webcam uses ${savedRoundness === undefined ? "100% by default" : "saved roundness"}`, async ({
		page,
	}) => {
		await installDesktopBridge(page, "broll-blue.mp4");
		await installDesktopBridgeOverrides(
			page,
			(roundness) => {
				if (roundness !== undefined) {
					const getSetting = window.electronAPI.getAppSetting;
					window.electronAPI.getAppSetting = (key) =>
						key === "leadcut.editor.preferences" ? { webcam: { roundness } } : getSetting(key);
				}
				window.electronAPI.getCurrentRecordingSession = async () => ({
					success: true,
					session: {
						videoPath: `${location.origin}/tests/ui/fixtures/broll-blue.mp4`,
						webcamPath: `${location.origin}/tests/ui/fixtures/webcam-red.mp4`,
						timeOffsetMs: 0,
					},
				});
			},
			savedRoundness,
		);
		await page.goto("/?windowType=editor");
		await page.getByRole("radio", { name: "Webcam", exact: true }).click();
		const expected = savedRoundness ?? 100;
		await expect(page.getByRole("slider", { name: "Webcam Roundness" })).toHaveValue(
			String(expected),
		);
		const preview = page.locator(".editor-preview-stage canvas");
		await expect(preview).toHaveCount(1);
		await expect
			.poll(async () => {
				const png = (await preview.screenshot()).toString("base64");
				return page.evaluate(async (base64) => {
					const { getWebcamCornerRadiusPx } = await import("/src/components/video-editor/webcamOverlay.ts");
					const { getSquircleSvgPath } = await import("/src/lib/geometry/squircle.ts");
					const image = new Image();
					image.src = `data:image/png;base64,${base64}`;
					await image.decode();
					const canvas = document.createElement("canvas");
					canvas.width = image.width;
					canvas.height = image.height;
					const ctx = canvas.getContext("2d")!;
					ctx.drawImage(image, 0, 0);
					const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
					let left = canvas.width, top = canvas.height, right = 0, bottom = 0, count = 0;
					const isRed = (index: number) =>
						data[index] > 125 && data[index] > 2 * Math.max(data[index + 1], data[index + 2]);
					for (let pixel = 0; pixel < canvas.width * canvas.height; pixel++) {
						if (!isRed(pixel * 4)) continue;
						const x = pixel % canvas.width, y = Math.floor(pixel / canvas.width);
						left = Math.min(left, x); right = Math.max(right, x);
						top = Math.min(top, y); bottom = Math.max(bottom, y);
						count++;
					}
					if (count < 100) return -1;
					const width = right - left + 1, height = bottom - top + 1;
					const referenceArea = (roundness: number) => {
						const shape = new Path2D(getSquircleSvgPath({
							x: 0, y: 0, width, height,
							radius: getWebcamCornerRadiusPx(roundness, width, height),
						}));
						let area = 0;
						for (let y = 0; y < height; y++) for (let x = 0; x < width; x++)
							if (ctx.isPointInPath(shape, x + 0.5, y + 0.5)) area++;
						return area;
					};
					return [69, 100].sort((a, b) => Math.abs(count - referenceArea(a)) - Math.abs(count - referenceArea(b)))[0];
				}, png);
			}, { timeout: 20000 })
			.toBe(expected);
		await page.screenshot({
			path: `test-results/webcam-new-recording-${expected}.png`,
			animations: "disabled",
		});
	});
}
