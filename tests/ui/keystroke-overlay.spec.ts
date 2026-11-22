import { expect, test, type Page } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { installDesktopBridge, installDesktopBridgeOverrides } from "./bridge";
import type { KeystrokeSidecar, RecordedKeyEvent } from "../../services/leadcut-mcp/src/keystrokeSidecar";

const style = { x: 60, y: 40, fontFamily: "Arial", fontSize: 48, textColor: "#ffffff",
	backgroundColor: "#f00ce2", cornerRadius: 12, opacity: 1, durationMs: 1100, fadeMs: 0 };
const ctrlS: RecordedKeyEvent = {
	timeMs: 250, type: "down", key: "S", keycode: 31, ctrl: true, alt: false, shift: false, meta: false,
};
const ctrlV = { ...ctrlS, key: "V", keycode: 47, timeMs: 450 };

async function seek(page: Page, time: string) {
	const timecode = page.getByRole("textbox", { name: "Timeline timecode" });
	await timecode.fill(time);
	await timecode.press("Enter");
	await expect(timecode).toHaveValue(time);
}

async function openProject(page: Page, capture: KeystrokeSidecar = { events: [ctrlS] }) {
	await installDesktopBridge(page, "waveform.mp4");
	await installDesktopBridgeOverrides(page, ({ style, capture }) => {
		window.electronAPI.getPlatform = async () => "win32";
		const getSetting = window.electronAPI.getAppSetting;
		const setSetting = window.electronAPI.setAppSetting;
		window.electronAPI.getAppSetting = key => key === "leadcut.keystroke.presets"
			? JSON.parse(sessionStorage.getItem(key) ?? "null") : getSetting(key);
		window.electronAPI.setAppSetting = (key, value) => {
			if (key !== "leadcut.keystroke.presets") return setSetting(key, value);
			sessionStorage.setItem(key, JSON.stringify(value));
			return true;
		};
		window.electronAPI.getRecordingKeystrokes = async () => ({ success: true, ...capture });
		window.electronAPI.loadCurrentProjectFile = async () => ({
			success: true, path: "/projects/keystrokes.leadcut", project: {
				version: 2, projectId: "keystroke-overlay", videoPath: `${location.origin}/tests/ui/fixtures/waveform.mp4`,
				editor: { clipRegions: [{ id: "screen", startMs: 0, endMs: 6000, sourceStartMs: 0 }],
					keystrokeOverlay: { enabled: true, hiddenIds: [], style } },
			},
		});
	}, { style, capture });
	await page.goto("/?windowType=editor");
	await expect(page.locator('[data-region-id="screen"]')).toHaveCount(1);
	await expect.poll(() => page.evaluate(() => [...document.querySelectorAll("video")].some(video => video.readyState >= 2))).toBe(true);
	await expect(page.getByLabel("Loading preview", { exact: true })).toHaveCount(0);
}

test("places the captured shortcut over the preview, supports drag, and hides it after its duration", async ({ page }) => {
	await openProject(page);
	await seek(page, "00:00:00.500");
	await expect(page.getByRole("img", { name: "Ctrl + S" })).toBeVisible();
	const handle = page.getByRole("button", { name: "Move keystroke display" });
	const origin = (await handle.boundingBox())!;
	await page.mouse.move(origin.x + origin.width / 2, origin.y + origin.height / 2);
	await page.mouse.down();
	await page.mouse.move(origin.x + origin.width / 2 - 60, origin.y + origin.height / 2 - 30, { steps: 5 });
	await page.mouse.up();
	await expect.poll(async () => (await handle.boundingBox())!.x).toBeLessThan(origin.x - 45);
	await seek(page, "00:00:02.500");
	await expect(page.getByRole("img", { name: "Ctrl + S" })).toHaveCount(0);
});

test("deletes a timeline keystroke, restores it with undo, and can hide the track", async ({ page }) => {
	await openProject(page);
	await seek(page, "00:00:00.500");
	const overlay = page.getByRole("img", { name: "Ctrl + S" });
	const track = page.locator('[data-timeline-row="row-keystrokes"]');
	const item = track.getByRole("button", { name: "Ctrl + S", exact: true });
	await expect(overlay).toBeVisible();
	await item.click();
	await expect(item).toHaveAttribute("aria-pressed", "true");
	await item.press("Delete");
	await expect(overlay).toHaveCount(0);
	await expect(item).toHaveCount(0);
	await page.keyboard.press("Control+z");
	await expect(overlay).toBeVisible();
	await expect(item).toBeVisible();
	await track.getByRole("checkbox", { name: "Show keystrokes" }).uncheck();
	await expect(overlay).toHaveCount(0);
});

test("uses a font picked from installed fonts in the keystroke preview", async ({ page }) => {
	await page.addInitScript(() => {
		Object.assign(window, { queryLocalFonts: async () => [{ family: "IBM Plex Sans SC" }, { family: "Arial" }] });
		const fillText = CanvasRenderingContext2D.prototype.fillText;
		CanvasRenderingContext2D.prototype.fillText = function (text, x, y, maxWidth?) {
			if (text === "Ctrl + S" && this.canvas instanceof HTMLCanvasElement) this.canvas.dataset.drawnFont = this.font;
			if (maxWidth === undefined) return fillText.call(this, text, x, y);
			return fillText.call(this, text, x, y, maxWidth);
		};
	});
	await openProject(page);
	await seek(page, "00:00:00.500");
	await expect(page.getByRole("img", { name: "Ctrl + S" })).toBeVisible();
	await page.getByRole("radio", { name: "Keystroke display", exact: true }).click();
	const panel = page.getByRole("region", { name: "Keystroke display" });
	await panel.getByRole("button", { name: "Font family", exact: true }).click();
	await page.getByRole("textbox", { name: "Search fonts" }).fill("IBM Plex");
	await page.getByRole("option", { name: "IBM Plex Sans SC", exact: true }).click();
	await expect(page.locator("canvas[data-drawn-font]")).toHaveAttribute("data-drawn-font", /px "IBM Plex Sans SC", "Microsoft YaHei", sans-serif$/);
});

test("saves a keystroke style preset and applies it after reload", async ({ page }) => {
	await openProject(page);
	await page.getByRole("radio", { name: "Keystroke display", exact: true }).click();
	const panel = page.getByRole("region", { name: "Keystroke display" });
	await panel.getByRole("combobox", { name: "Position" }).selectOption({ label: "Top left" });
	await panel.getByRole("textbox", { name: "Preset name" }).fill("Upper corner");
	await panel.getByRole("button", { name: "Save preset" }).click();
	await page.reload();
	await page.getByRole("radio", { name: "Keystroke display", exact: true }).click();
	await panel.getByRole("combobox", { name: "Style presets" }).selectOption("Upper corner");
	await expect(panel.getByRole("combobox", { name: "Position" })).toHaveValue("0");
	await expect(panel.getByRole("spinbutton", { name: "Horizontal position (%)" })).toHaveValue("14");
});

for (const [mode, events, message] of [
	["all", [ctrlS], "This recording: all keys, 1 captured"],
	["shortcuts", [ctrlS], "This recording: shortcuts only, 1 captured"],
	[undefined, [ctrlS], "Recorded keys (1)"],
	[undefined, [], "This recording has no keystroke data"],
] as const) {
	test(`shows the keystroke capture status: ${message}`, async ({ page }) => {
		await openProject(page, { mode, events: [...events] });
		await page.getByRole("radio", { name: "Keystroke display", exact: true }).click();
		const status = page.getByRole("region", { name: "Keystroke display" }).getByRole("status");
		await expect(status).toContainText(message);
		if (mode === "shortcuts") await expect(status).toContainText("Choose All keys on the recording toolbar");
	});
}

test("changes only the displayed events when filtering to shortcuts", async ({ page }) => {
	const plainA = { ...ctrlS, key: "A", keycode: 30, ctrl: false, timeMs: 150 };
	await openProject(page, { mode: "all", events: [plainA, ctrlS] });
	await seek(page, "00:00:00.500");
	await page.getByRole("radio", { name: "Keystroke display", exact: true }).click();
	await expect(page.getByRole("img", { name: "a", exact: true })).toBeVisible();
	await page.getByRole("combobox", { name: "Display content" }).selectOption("shortcuts");
	await expect(page.getByRole("img", { name: "a", exact: true })).toHaveCount(0);
	await expect(page.getByRole("img", { name: "Ctrl + S", exact: true })).toBeVisible();
	await expect(page.getByRole("region", { name: "Keystroke display" }).getByRole("status")).toContainText("2 captured");
});

test("puts both stacked shortcuts at the same normalized preview and MP4 positions", async ({ page }, info) => {
	test.setTimeout(90000);
	await openProject(page, { mode: "all", events: [ctrlS, ctrlV] });
	await seek(page, "00:00:00.500");
	const label = page.getByRole("img", { name: "Ctrl + S" });
	await expect(label).toBeVisible();
	await expect(page.getByRole("img", { name: "Ctrl + V" })).toBeVisible();
	const coordinates = [{ x: 0.6, y: 0.3 }, { x: 0.6, y: 0.377 }];
	const preview = await label.evaluate((label, coords) => {
		const canvas = label.parentElement!.querySelector("canvas")!;
		const context = canvas.getContext("2d")!;
		return coords.map(({ x, y }) => [...context.getImageData(Math.round(canvas.width * x), Math.round(canvas.height * y), 1, 1).data]);
	}, coordinates);
	expect(preview).toEqual([[240, 12, 226, 255], [240, 12, 226, 255]]);
	const bytes = await page.evaluate(async style => {
		const { ModernVideoExporter } = await import("/src/lib/exporter/modernVideoExporter.ts");
		const exporter = new ModernVideoExporter({
			width: 960, height: 540, frameRate: 10, bitrate: 5000000, codec: "avc1.640028",
			backendPreference: "webcodecs", preferredRenderBackend: "webgl",
			videoUrl: `${location.origin}/tests/ui/fixtures/broll-blue.mp4`, wallpaper: "#0000ff",
			showShadow: false, shadowIntensity: 0, backgroundBlur: 0, cropRegion: { x: 0, y: 0, width: 1, height: 1 },
			padding: 0, zoomRegions: [], showCursor: false,
			clipRegions: [{ id: "screen", startMs: 0, endMs: 1000, sourceStartMs: 0, speed: 1 }],
			keystrokes: { style, items: [
				{ id: "250:S", label: "Ctrl + S", startMs: 250, endMs: 1000 },
				{ id: "450:V", label: "Ctrl + V", startMs: 450, endMs: 1000 },
			] },
		});
		const result = await exporter.export();
		if (!result.success || !result.blob) throw new Error(result.error ?? "Export generated no video");
		return [...new Uint8Array(await result.blob.arrayBuffer())];
	}, style);
	const filename = info.outputPath("keystroke.mp4");
	fs.writeFileSync(filename, Buffer.from(bytes));
	const frame = execFileSync(path.resolve("node_modules/ffmpeg-static/ffmpeg.exe"),
		["-v", "error", "-ss", "0.5", "-i", filename, "-frames:v", "1", "-f", "rawvideo", "-pix_fmt", "rgb24", "-"],
		{ windowsHide: true, maxBuffer: 960 * 540 * 3 + 1024 });
	for (const [index, { x, y }] of coordinates.entries()) {
		const offset = (Math.round(540 * y) * 960 + Math.round(960 * x)) * 3;
		const rgb = [...frame.subarray(offset, offset + 3)];
		for (const [channel, value] of rgb.entries()) expect(Math.abs(value - preview[index][channel])).toBeLessThan(30);
	}
});
