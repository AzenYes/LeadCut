import { expect, type Page, test } from "@playwright/test";
import type { CaptionCue, ClipRegion } from "../../src/components/video-editor/types";
import { installDesktopBridge, installDesktopBridgeOverrides } from "./bridge";

// Use the installed app's Windows GPU backend when measuring preview playback.
test.use({ launchOptions: process.platform === "win32" ? {
	args: ["--enable-gpu", "--use-angle=d3d11", "--ignore-gpu-blocklist"],
} : undefined });

const projectPath = "/projects/Caption transcript.leadcut";
const longText = "这是一条用来验证字幕文稿能够自动换行并完整呈现全部内容的中文字幕这段文字总共四十字";
const cue = (id: string, text: string, startMs: number, endMs: number): CaptionCue =>
	({ id, text, startMs, endMs, timeBasis: "timeline" });
const defaultCues = [cue("first", longText, 0, 1000), cue("second", "Second caption", 1000, 2000)];
const clip = (id: string, startMs: number, endMs: number, sourceStartMs: number): ClipRegion =>
	({ id, startMs, endMs, sourceStartMs, speed: 1 });

async function openEditor(page: Page, captions = defaultCues, clips = [clip("clip", 0, 6000, 0)]) {
	await installDesktopBridge(page, "waveform.mp4");
	await installDesktopBridgeOverrides(page, ({ captions, clips, projectPath }) => {
		window.electronAPI.loadCurrentProjectFile = async () => ({
			success: true, path: projectPath, revision: "transcript",
			project: {
				version: 2, projectId: "transcript",
				videoPath: `${location.origin}/tests/ui/fixtures/waveform.mp4`,
				editor: {
					clipRegions: clips, autoCaptions: captions,
					autoCaptionSettings: { enabled: true, animationStyle: "none" },
				},
			},
		});
		window.electronAPI.saveProjectFile = async project => {
			sessionStorage.setItem("saved-caption-transcript", JSON.stringify(project));
			return { success: true, path: projectPath, projectId: "transcript", revision: "transcript" };
		};
	}, { captions, clips, projectPath });
	await page.goto("/?windowType=editor");
	await expect(page.locator('[data-variant="clip"][data-region-id]')).toHaveCount(clips.length, { timeout: 40000 });
	await expect(page.getByLabel("Loading preview", { exact: true })).toHaveCount(0, { timeout: 40000 });
}

const panelName = "Caption transcript";
const panel = (page: Page) => page.getByRole("region", { name: panelName, exact: true });
const openPanel = (page: Page) => page.getByRole("radio", { name: panelName, exact: true }).click();
const row = (page: Page, index: number) => panel(page).locator(`[data-caption-overview-row="${index}"]`);
const editor = (page: Page) => panel(page).getByRole("textbox", { name: "Edit caption text", exact: true });
const saved = (page: Page) => page.evaluate((): CaptionCue[] => {
	const value = JSON.parse(sessionStorage.getItem("saved-caption-transcript") ?? "{}");
	return value.editor?.autoCaptions ?? [];
});

test("shows full wrapped text at the 440 px transcript width", async ({ page }) => {
	await openEditor(page);
	await openPanel(page);
	const aside = page.locator("#editor-inspector");
	expect((await aside.boundingBox())?.width).toBe(440);
	const text = row(page, 1).locator("[data-caption-text]");
	await expect(text).toHaveText(longText);
	const geometry = await text.evaluate(element => {
		const style = getComputedStyle(element);
		return { height: element.clientHeight, scrollHeight: element.scrollHeight, lineHeight: parseFloat(style.lineHeight) };
	});
	expect(geometry.height).toBeGreaterThanOrEqual(geometry.lineHeight * 2);
	expect(geometry.scrollHeight).toBe(geometry.height);
});

test("shows caption actions as one row of icons with localized hover labels", async ({ page }) => {
	await page.addInitScript(() => localStorage.setItem("leadcut.locale", "zh-CN"));
	await openEditor(page);
	await page.getByRole("radio", { name: "字幕文稿", exact: true }).click();
	const firstRow = page.locator('[data-caption-overview-row="1"]');
	await firstRow.getByRole("button", { name: "1", exact: true }).click();
	const actions = firstRow.getByRole("group", { name: "字幕操作", exact: true });
	const labels = ["从这句播放", "重听", "播放头处拆分", "与下一条合并", "删除", "字幕操作"];
	const buttons = actions.getByRole("button");
	await expect(buttons).toHaveCount(labels.length);
	expect(await buttons.evaluateAll(elements => new Set(elements.map(element => element.getBoundingClientRect().top)).size)).toBe(1);
	for (const label of labels) {
		const button = actions.getByRole("button", { name: label, exact: true });
		await expect(button).toHaveText("");
		await expect(button.locator("svg")).toBeVisible();
		await button.hover();
		await expect(page.getByRole("tooltip").filter({ hasText: label })).toHaveText(label);
	}
	await actions.getByRole("button", { name: "与下一条合并", exact: true }).click();
	await expect(page.locator("[data-caption-overview-row]")).toHaveCount(1);
	await expect(firstRow.locator("[data-caption-text]")).toContainText("Second caption");
});

test("edits with one click and saves on blur or Escape with undo", async ({ page }) => {
	await openEditor(page);
	await openPanel(page);
	await row(page, 1).locator("[data-caption-text]").click();
	await expect(editor(page)).toBeFocused();
	await editor(page).fill("Edited on click");
	await row(page, 2).locator("[data-caption-text]").click();
	await expect(row(page, 1)).toContainText("Edited on click");
	await expect.poll(async () => (await saved(page)).find(c => c.id === "first")?.text).toBe("Edited on click");
	await page.getByRole("button", { name: "Undo", exact: true }).click();
	await expect(row(page, 1)).toContainText(longText);
	await row(page, 1).locator("[data-caption-text]").click();
	await editor(page).fill("Saved with Escape");
	await editor(page).press("Escape");
	await expect(editor(page)).toHaveCount(0);
	await expect.poll(async () => (await saved(page)).find(c => c.id === "first")?.text).toBe("Saved with Escape");
});

test("groups fragments across cuts and retains transcript state when switching tools", async ({ page }) => {
	await openEditor(page, [{ id: "across", text: "A caption across the cut", startMs: 500, endMs: 2500 }],
		[clip("left", 0, 1000, 0), clip("right", 1000, 3000, 2000)]);
	await openPanel(page);
	await expect(panel(page).getByRole("row")).toHaveCount(1);
	await expect(row(page, 1)).toContainText("Spans a cut");
	await expect(row(page, 1).getByRole("button", { name: /^Start / })).toHaveCount(0);
	await page.locator('[data-variant="clip"][data-region-id="left"]').click();
	await expect(panel(page)).toBeVisible();
	await panel(page).getByRole("button", { name: "Find captions", exact: true }).click();
	await panel(page).getByRole("searchbox", { name: "Find captions" }).fill("across");
	await page.getByRole("radio", { name: "Scene", exact: true }).click();
	await openPanel(page);
	await expect(panel(page).getByRole("searchbox", { name: "Find captions" })).toHaveValue("across");
});

test("leaves IME composition Enter to the input method", async ({ page }) => {
	await openEditor(page);
	await openPanel(page);
	await row(page, 1).locator("[data-caption-text]").click();
	await editor(page).evaluate(element => (element as HTMLTextAreaElement).setSelectionRange(5, 5));
	await editor(page).dispatchEvent("keydown", { key: "Enter", bubbles: true, isComposing: true });
	await expect(panel(page).getByRole("row")).toHaveCount(2);
	await expect(editor(page)).toBeFocused();
});

test("selects during playback without seeking, pauses on typing, and relistens to the selection", async ({ page }) => {
	await openEditor(page, [cue("first", "First caption", 0, 1000), cue("second", "Second caption", 3000, 4000)]);
	await openPanel(page);
	const video = page.locator("video").first();
	const time = () => video.evaluate(element => (element as HTMLVideoElement).currentTime);
	const play = page.getByRole("button", { name: "Play", exact: true });
	const pause = page.getByRole("button", { name: "Pause", exact: true });
	await play.click();
	await expect(row(page, 1)).toHaveAttribute("data-active", "true");
	await row(page, 2).locator("[data-caption-text]").click();
	await expect(pause).toBeVisible();
	expect(await time()).toBeLessThan(3);
	await editor(page).fill("Corrected caption");
	await expect(play).toBeVisible();
	await editor(page).press("Tab");
	await expect(pause).toBeVisible();
	await expect.poll(time).toBeGreaterThanOrEqual(3);
	await expect(play).toBeVisible({ timeout: 8000 });
	expect(await time()).toBeCloseTo(4, 1);
	await row(page, 1).getByRole("button", { name: "1", exact: true }).click();
	await expect.poll(time).toBeCloseTo(0, 1);
	await expect(play).toBeVisible();
	await panel(page).locator("summary[aria-label='Transcript options']").click();
	await panel(page).getByRole("checkbox", { name: "Pause playback when typing" }).uncheck();
	await play.click();
	await row(page, 2).locator("[data-caption-text]").click();
	await editor(page).fill("Continuous playback");
	await expect(pause).toBeVisible();
});

test("follows the playing caption and reveals external timeline selections", async ({ page }) => {
	const captions = Array.from({length: 60}, (_, i) => cue(`cue-${i}`, `Caption ${i + 1}`, i * 100, (i + 1) * 100));
	await openEditor(page, captions);
	await openPanel(page);
	const grid = panel(page).getByRole("grid");
	await page.getByRole("button", { name: "Play", exact: true }).click();
	await expect(grid.locator("[data-active='true']")).toBeInViewport();
	await grid.hover();
	await page.mouse.wheel(0, 1000);
	const resume = panel(page).getByRole("button", { name: "Back to current caption" });
	await expect(resume).toBeVisible();
	await resume.click();
	await expect(resume).toHaveCount(0);
	await expect(grid.locator("[data-active='true']")).toBeInViewport();
	await page.locator('[data-variant="caption"]').nth(49).click();
	await expect(row(page, 50)).toHaveAttribute("aria-selected", "true");
	await expect(row(page, 50)).toBeInViewport();
});

test("splits and merges at the caret with one undo per edit", async ({ page }) => {
	await openEditor(page, [cue("one", "今天天气很好我们出去玩", 0, 2200), cue("two", "Next caption", 3000, 4000)]);
	await openPanel(page);
	await row(page, 1).locator("[data-caption-text]").click();
	await editor(page).evaluate(element => (element as HTMLTextAreaElement).setSelectionRange(6, 6));
	await editor(page).press("Enter");
	await expect(row(page, 1).locator("[data-caption-text]")).toHaveText("今天天气很好");
	await expect(editor(page)).toHaveValue("我们出去玩");
	expect(await row(page, 1).getAttribute("data-end-ms")).toBe(await row(page, 2).getAttribute("data-start-ms"));
	expect(await editor(page).evaluate(element => (element as HTMLTextAreaElement).selectionStart)).toBe(0);
	await editor(page).press("Backspace");
	await expect(editor(page)).toHaveValue("今天天气很好我们出去玩");
	expect(await editor(page).evaluate(element => (element as HTMLTextAreaElement).selectionStart)).toBe(6);
	await editor(page).press("End");
	await editor(page).press("Enter");
	await expect(editor(page)).toHaveValue("Next caption");
	expect(await editor(page).evaluate(element => (element as HTMLTextAreaElement).selectionStart)).toBe(0);
	await page.getByRole("button", { name: "Undo", exact: true }).click();
	await expect(row(page, 3)).toContainText("Next caption");
	await page.getByRole("button", { name: "Undo", exact: true }).click();
	await expect(row(page, 3)).toHaveCount(0);
});

test("retimes from the playhead, clamps overlaps, and accepts millisecond timecode", async ({ page }) => {
	await openEditor(page, [cue("one", "First caption", 0, 1000), cue("two", "Second caption", 2000, 4000)]);
	await openPanel(page);
	const scrubber = page.getByRole("slider", { name: "Preview progress", exact: true });
	await row(page, 2).locator("[data-caption-text]").click();
	await editor(page).press("Control+Enter");
	await expect(page.getByRole("button", { name: "Pause", exact: true })).toBeVisible();
	await expect.poll(async () => Number(await scrubber.getAttribute("aria-valuenow"))).toBeGreaterThan(2100);
	await editor(page).press("Control+Enter");
	const playhead = Number(await scrubber.getAttribute("aria-valuenow"));
	await editor(page).press("Alt+[");
	await expect(row(page, 2)).toHaveAttribute("data-start-ms", String(playhead));
	await editor(page).press("Escape");
	await row(page, 2).getByRole("button", { name: /^Start / }).dblclick();
	const time = row(page, 2).getByRole("textbox", { name: "Start", exact: true });
	await time.fill("0:00.400");
	await time.press("Enter");
	await expect(row(page, 2)).toHaveAttribute("data-start-ms", "1000");
	await row(page, 2).getByRole("button", { name: /^Start / }).dblclick();
	await time.fill("0:02.500");
	await time.press("Enter");
	await expect(row(page, 2)).toHaveAttribute("data-start-ms", "2500");
	await page.getByRole("button", { name: "Undo", exact: true }).click();
	await expect(row(page, 2)).toHaveAttribute("data-start-ms", "1000");
});

test("accepts minute and millisecond precision for timeline captions", async ({ page }) => {
	const clips = Array.from({ length: 11 }, (_, index) => clip(`clip-${index}`, index * 6000, (index + 1) * 6000, 0));
	await openEditor(page, [cue("minute", "Caption after one minute", 61_000, 65_000)],
		clips);
	await expect(page.getByRole("slider", { name: "Preview progress", exact: true })).toHaveAttribute("aria-valuemax", "66000");
	await openPanel(page);
	await row(page, 1).getByRole("button", { name: /^Start / }).dblclick();
	const time = row(page, 1).getByRole("textbox", { name: "Start", exact: true });
	await time.fill("1:02.500");
	await time.press("Enter");
	await expect(row(page, 1)).toHaveAttribute("data-start-ms", "62500");
});

test("refuses to merge captions separated by a cut", async ({ page }) => {
	await openEditor(page, [cue("one", "hello", 500, 1000), cue("two", "world", 1000, 2000)],
		[clip("left", 0, 1000, 0), clip("right", 1000, 3000, 2000)]);
	await openPanel(page);
	await row(page, 1).locator("[data-caption-text]").click();
	await editor(page).press("End");
	await editor(page).press("Delete");
	await expect(page.getByText("Select consecutive captions within the same clip to merge.")).toBeVisible();
	await expect(panel(page).getByRole("grid")).toHaveAttribute("aria-rowcount", "2");
});

test("finds each occurrence, replaces after confirmation, and undoes all replacements together", async ({ page }) => {
	await openEditor(page, [cue("one", "Apple Apple", 0, 1000), cue("two", "An apple", 1000, 2000)]);
	await openPanel(page);
	const search = panel(page).getByRole("searchbox", { name: "Find captions" });
	await expect(search).toHaveCount(0);
	await row(page, 1).locator("[data-caption-text]").click();
	await editor(page).press("Control+f");
	await expect(search).toBeFocused();
	await search.fill("apple");
	const count = panel(page).getByTestId("caption-match-count");
	await expect(count).toHaveText("Match 1 of 3");
	await expect(panel(page).locator("[data-caption-search-match]")).toHaveCount(3);
	await search.press("Enter");
	await expect(count).toHaveText("Match 2 of 3");
	await search.press("Shift+Enter");
	await expect(count).toHaveText("Match 1 of 3");
	await panel(page).getByRole("textbox", { name: "Replacement text" }).fill("Pear");
	await panel(page).getByRole("button", { name: "Replace all", exact: true }).click();
	const dialog = page.getByRole("dialog", { name: "Replace all" });
	await expect(dialog).toContainText("Replace 3 occurrences?");
	await dialog.getByRole("button", { name: "Replace all", exact: true }).click();
	await expect(row(page, 1)).toContainText("Pear Pear");
	await expect(row(page, 2)).toContainText("An Pear");
	await page.getByRole("button", { name: "Undo", exact: true }).click();
	await expect(row(page, 1)).toContainText("Apple Apple");
	await expect(row(page, 2)).toContainText("An apple");
});

test.describe("hardware-accelerated transcript performance", () => {
	test("opens 2000 captions promptly and sustains 30 FPS during playback", async ({ page }, result) => {
		await page.setViewportSize({ width: 1280, height: 900 });
		const amount = 2000;
		await openEditor(page, Array.from({ length: amount }, (_, i) =>
			cue(`line-${i}`, `Caption ${i + 1}`, i * 1000, (i + 1) * 1000)), [clip("clip", 0, amount * 1000, 0)]);
		const play = page.getByRole("button", { name: "Play", exact: true });
		const pause = page.getByRole("button", { name: "Pause", exact: true });
		const source = page.locator('video[aria-hidden="true"]');
		const sample = async () => {
			await play.click();
			await expect(pause).toBeVisible();
			await expect.poll(() => source.evaluate((video: HTMLVideoElement) => video.currentTime)).toBeGreaterThanOrEqual(0.25);
			return page.evaluate(() => new Promise<number>(resolve => {
				let frames = 0;
				requestAnimationFrame(start => {
					const tick = (now: number) => {
						frames++;
						const elapsed = now - start;
						if (elapsed >= 3000) resolve(frames * 1000 / elapsed);
						else requestAnimationFrame(tick);
					};
					requestAnimationFrame(tick);
				});
			}));
		};
		const baselineFrameRate = await sample();
		await pause.click();
		const timelineTime = page.getByRole("textbox", { name: "Timeline timecode" });
		await timelineTime.fill("00:00:00.000");
		await timelineTime.press("Enter");
		const start = Date.now();
		await openPanel(page);
		await expect(row(page, 1).locator("[data-caption-text]")).toBeVisible();
		const openMs = Date.now() - start;
		const frameRate = await sample();
		await result.attach("caption-transcript-performance", {
			body: JSON.stringify({ openMs, baselineFrameRate, frameRate }),
			contentType: "application/json",
		});
		console.log(`Caption transcript with ${amount} cues: ${openMs} ms open, ${frameRate.toFixed(1)} FPS (${baselineFrameRate.toFixed(1)} FPS with the panel closed)`);
		expect(openMs).toBeLessThanOrEqual(1000);
		expect(frameRate).toBeGreaterThanOrEqual(30);
	});
});
