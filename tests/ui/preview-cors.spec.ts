import { expect, test } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { approvedLocalReadPaths } from "../../electron/ipc/state";
import { buildMediaUrl, ensureMediaServer } from "../../electron/mediaServer";
import { installDesktopBridge, installDesktopBridgeOverrides } from "./bridge";

test("editor opens, plays and seeks video from the separate local media server", async ({ page }, testInfo) => {
	const fixture = fs.realpathSync(path.resolve("tests/ui/fixtures/filmstrip.mp4"));
	approvedLocalReadPaths.add(fixture);
	const mediaUrl = buildMediaUrl(await ensureMediaServer(), fixture);
	const errors: string[] = [];
	page.on("pageerror", error => errors.push(error.message));
	page.on("console", message => {
		if (message.type() === "error") errors.push(message.text());
	});
	await installDesktopBridge(page, "filmstrip.mp4");
	await installDesktopBridgeOverrides(page, ({ fixture, mediaUrl }) => {
		localStorage.setItem("leadcut.locale", "en");
		window.electronAPI.getCurrentVideoPath = async () => ({ success: true, path: fixture });
		window.electronAPI.getLocalMediaUrl = async () => ({ success: true, url: mediaUrl });
	}, { fixture, mediaUrl });
	await page.goto("/?windowType=editor");
	expect(new URL(mediaUrl).origin).not.toBe(new URL(page.url()).origin);
	const overlay = page.locator("[data-preview-overlay]");
	await expect(overlay).toBeVisible({ timeout: 20000 });
	const video = page.locator("body > video");
	await expect.poll(() => video.evaluate((element: HTMLVideoElement) => element.readyState)).toBeGreaterThanOrEqual(2);
	const preview = overlay.locator("..").locator("canvas").first();
	await expect(preview).toBeVisible();
	const sample = () => preview.evaluate(async (canvas: HTMLCanvasElement) => {
		await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
		const copy = document.createElement("canvas");
		copy.width = 64; copy.height = 36;
		const context = copy.getContext("2d")!;
		context.drawImage(canvas, 0, 0, 64, 36);
		const pixels = [...context.getImageData(0, 0, 64, 36).data];
		return { pixels, colored: pixels.some((value, index) => index % 4 !== 3 && value > 30) };
	});
	await expect.poll(async () => (await sample()).colored).toBe(true);
	const first = await sample();
	await page.getByRole("button", { name: "Play", exact: true }).click();
	await expect.poll(() => video.evaluate((element: HTMLVideoElement) => element.currentTime)).toBeGreaterThan(0.3);
	await page.getByRole("button", { name: "Pause", exact: true }).click();
	await video.evaluate(async (element: HTMLVideoElement) => {
		await new Promise<void>(resolve => {
			element.addEventListener("seeked", () => resolve(), { once: true });
			element.currentTime = 2.2;
		});
	});
	await expect.poll(async () => {
		const next = await sample();
		return next.pixels.reduce((sum, value, index) => sum + Math.abs(value - first.pixels[index]), 0) / next.pixels.length;
	}).toBeGreaterThan(5);
	await expect(overlay).toBeVisible();
	expect(errors.filter(message => /SecurityError|tainted|texSubImage2D|Failed to initialize preview/i.test(message))).toEqual([]);
	await page.screenshot({ path: testInfo.outputPath("cross-origin-preview.png") });
});
