import { expect, test } from "@playwright/test";
import { installDesktopBridge } from "./bridge";

test("loads an export cursor atlas for the requested style on first use", async ({ page }) => {
	await installDesktopBridge(page);
	await page.goto("/?windowType=hud-overlay");
	const result = await page.evaluate(async () => {
		const { buildNativeCursorAtlas } = await import("/src/components/video-editor/videoPlayback/cursorRenderer.ts");
		const images = () => performance.getEntriesByType("resource")
			.filter(entry => (entry as PerformanceResourceTiming).initiatorType === "img")
			.map(entry => new URL(entry.name).pathname);
		const baseline = images().length;
		const tahoe = await buildNativeCursorAtlas("tahoe");
		const requestedImages = images().slice(baseline);
		const [macos, windows, inverted, dot, figma] = await Promise.all([
			buildNativeCursorAtlas("macos"), buildNativeCursorAtlas("windows11"),
			buildNativeCursorAtlas("tahoe-inverted"), buildNativeCursorAtlas("dot"), buildNativeCursorAtlas("figma"),
		]);
		return {
			otherStyleFetchedWithTahoe: requestedImages.some(name => /\/cursors\/(macos|windows11)\//.test(name)),
			atlases: [tahoe, macos, windows, inverted, dot, figma].map(atlas => ({
				style: atlas?.style, count: atlas?.entries.length ?? 0, image: atlas?.dataUrl,
			})),
		};
	});
	expect(result.otherStyleFetchedWithTahoe).toBe(false);
	expect(result.atlases.map(atlas => atlas.style)).toEqual(["tahoe", "macos", "windows11", "tahoe-inverted", "dot", "figma"]);
	for (const atlas of result.atlases) {
		expect(atlas.count).toBeGreaterThan(1);
		expect(atlas.image).toMatch(/^data:image\/png;base64,/);
	}
	expect(new Set(result.atlases.map(atlas => atlas.image)).size).toBe(result.atlases.length);
});
