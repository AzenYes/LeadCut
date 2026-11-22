import { expect, test } from "@playwright/test";
import { installDesktopBridge, installDesktopBridgeOverrides } from "./bridge";

test("draws a visible stroke, undoes it through the bridge, and switches to the rectangle tool", async ({ page }) => {
	await installDesktopBridge(page);
	await installDesktopBridgeOverrides(page, () => {
		window.electronAPI.onLiveAnnotationOptions = callback => {
			Object.assign(window, { annotationOptions: callback });
			return () => undefined;
		};
		window.electronAPI.onLiveAnnotationCommand = callback => {
			Object.assign(window, { annotationCommand: callback });
			return () => undefined;
		};
	});
	await page.goto("/?windowType=live-annotation-canvas");
	const surface = page.getByTestId("live-annotation-surface");
	const canvas = page.getByTestId("live-annotation-canvas");
	const alphaPresent = () => canvas.evaluate(node => {
		const canvas = node as HTMLCanvasElement;
		const pixels = canvas.getContext("2d")!.getImageData(0, 0, canvas.width, canvas.height).data;
		return pixels.some((value, index) => index % 4 === 3 && value > 0);
	});
	await expect(surface).toBeVisible();
	const draw = async () => {
		await page.mouse.move(60, 70);
		await page.mouse.down();
		await page.mouse.move(190, 160, { steps: 10 });
		await page.mouse.up();
	};
	await draw();
	await expect(surface).toHaveAttribute("data-shape-tools", "pen");
	await expect.poll(alphaPresent).toBe(true);
	await page.evaluate(() => (window as unknown as { annotationCommand: (command: "undo") => void }).annotationCommand("undo"));
	await expect(surface).toHaveAttribute("data-shape-tools", "");
	await expect.poll(alphaPresent).toBe(false);
	await page.evaluate(() => (window as unknown as { annotationOptions: (options: unknown) => void }).annotationOptions({
		tool: "rectangle", color: "#3b82f6", weight: 6, fadeSeconds: 0,
	}));
	await draw();
	await expect(surface).toHaveAttribute("data-shape-tools", "rectangle");
	await expect.poll(alphaPresent).toBe(true);
});
