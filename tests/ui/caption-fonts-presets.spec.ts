import { expect, test, type Page } from "@playwright/test";
import { installDesktopBridge, installDesktopBridgeOverrides } from "./bridge";
import { AZHEN_PR_CAPTION_PRESET } from "../../src/components/video-editor/captionPresets";

async function prepare(page: Page) {
	await installDesktopBridge(page, "waveform.mp4");
	await installDesktopBridgeOverrides(page, () => {
		localStorage.setItem("leadcut.locale", "zh-CN");
		Object.assign(window, {
			queryLocalFonts: async () => [
				{ family: "IBM Plex Sans SC" },
				{ family: "Arial" },
				{ family: "IBM Plex Sans SC" },
			],
		});
		window.electronAPI.getAppSetting = (key) =>
			key === "leadcut.onboarding.v1.seen"
				? true
				: JSON.parse(localStorage.getItem(`app:${key}`) ?? "null");
		window.electronAPI.setAppSetting = (key, value) => {
			localStorage.setItem(`app:${key}`, JSON.stringify(value));
			return true;
		};
		const original = {
			version: 2,
			projectId: "caption-test",
			videoPath: `${location.origin}/tests/ui/fixtures/waveform.mp4`,
			editor: {
				wallpaper: "#123456",
				clipRegions: [{ id: "clip", startMs: 0, endMs: 6000, speed: 1 }],
				autoCaptions: [{ id: "cue", startMs: 0, endMs: 5000, text: "字幕测试" }],
				autoCaptionSettings: { enabled: true, language: "zh", fontSize: 44 },
			},
		};
		window.electronAPI.loadCurrentProjectFile = async () => ({
			success: true,
			path: sessionStorage.getItem("caption-project-path") ?? "/projects/captions.leadcut",
			project: JSON.parse(
				sessionStorage.getItem("caption-project") ?? JSON.stringify(original),
			),
		});
		window.electronAPI.saveProjectFile = async (project) => {
			sessionStorage.setItem("caption-project", JSON.stringify(project));
			return {
				success: true,
				path: sessionStorage.getItem("caption-project-path") ?? "/projects/captions.leadcut",
				projectId: project.projectId,
			};
		};
		window.electronAPI.loadProjectFile = async () => {
			const projectPath = "/projects/other.leadcut";
			const project = {
				...original,
				projectId: "other",
				editor: {
					...original.editor,
					wallpaper: "#abcdef",
					autoCaptionSettings: {
						enabled: false,
						language: "en",
						fontSize: 30,
						animationStyle: "pop",
					},
				},
			};
			sessionStorage.setItem("caption-project-path", projectPath);
			sessionStorage.setItem("caption-project", JSON.stringify(project));
			return { success: true, path: projectPath, project };
		};
	});
	await page.goto("/?windowType=editor");
	await expect(page.locator('[data-variant="clip"]')).toHaveCount(1, { timeout: 20000 });
}

async function saved(page: Page) {
	return page.evaluate(
		() => JSON.parse(sessionStorage.getItem("caption-project") ?? "{}").editor,
	);
}

test("caption font size previews during a drag and commits one undoable edit", async ({ page }) => {
	test.setTimeout(60_000);
	await prepare(page);
	await page.getByRole("radio", { name: "字幕", exact: true }).click();
	const slider = page.getByRole("slider", { name: "字号", exact: true });
	const track = slider.locator("xpath=ancestor::*[@data-slot='slider-track']");
	await track.scrollIntoViewIfNeeded();
	const box = (await track.boundingBox())!;
	const preview = page.locator("[data-preview-surface]").getByText("字幕测试", { exact: true });
	const fontPixels = () => preview.evaluate(node => Number.parseFloat(getComputedStyle(node).fontSize));
	await expect(preview).toBeVisible();
	const previewSize = await fontPixels();
	await expect(slider).toHaveValue("44");
	await page.mouse.move(box.x + box.width * 0.5, box.y + box.height / 2);
	await page.mouse.down();
	await page.mouse.move(box.x + box.width * 0.78, box.y + box.height / 2, { steps: 5 });
	const draft = Number(await slider.inputValue());
	expect(draft).toBeGreaterThan(44);
	await expect.poll(fontPixels).toBeGreaterThan(previewSize);
	await page.waitForTimeout(750);
	expect((await saved(page))?.autoCaptionSettings.fontSize ?? 44).toBe(44);
	await page.mouse.up();
	await expect.poll(async () => (await saved(page))?.autoCaptionSettings.fontSize).toBe(draft);
	await page.getByRole("button", { name: "撤销", exact: true }).click();
	await expect(slider).toHaveValue("44");
	await slider.focus();
	await slider.press("ArrowRight");
	await expect.poll(async () => (await saved(page))?.autoCaptionSettings.fontSize).toBe(45);
});

test("built-in PR subtitle preset applies Medium and survives reopening without replacing existing presets", async ({
	page,
}) => {
	test.setTimeout(60000);
	await prepare(page);
	await expect(page.getByText("LeadCut is based on Recordly and distributed under the AGPL-3.0 license.", { exact: true })).toHaveCount(0);
	await page.getByRole("radio", { name: "字幕", exact: true }).click();
	await page.getByRole("button", { name: /^选择字幕预设/ }).click();
	await page.getByRole("option", { name: "阿真 PR 字幕", exact: true }).click();
	await expect(page.getByRole("button", { name: "字体", exact: true })).toHaveText(
		"IBM Plex Sans SC",
	);
	await expect(page.getByRole("button", { name: /^中等/ })).toBeVisible();
	await expect(page.getByRole("button", { name: /^外侧/ })).toBeVisible();
	await expect
		.poll(async () => (await saved(page))?.autoCaptionSettings)
		.toMatchObject(AZHEN_PR_CAPTION_PRESET.style);
	expect((await saved(page)).autoCaptions).toEqual([
		{ id: "cue", startMs: 0, endMs: 5000, text: "字幕测试" },
	]);
	await page.getByRole("button", { name: "字体", exact: true }).click();
	const search = page.getByRole("textbox", { name: "搜索字体" });
	await search.fill("Arial");
	await search.press("ArrowDown");
	await expect(page.getByRole("option", { name: "Arial", exact: true })).toBeFocused();
	await page.keyboard.press("Enter");
	await expect(page.getByRole("button", { name: "字体", exact: true })).toHaveText("Arial");
	await page.getByRole("button", { name: /^选择字幕预设/ }).click();
	await page.getByRole("option", { name: "阿真 PR 字幕", exact: true }).click();
	await expect
		.poll(async () => (await saved(page))?.autoCaptionSettings)
		.toMatchObject(AZHEN_PR_CAPTION_PRESET.style);
	await page.reload();
	await expect(page.locator('[data-variant="clip"]')).toHaveCount(1);
	await page.getByRole("radio", { name: "字幕", exact: true }).click();
	await expect(page.getByRole("button", { name: /^阿真 PR 字幕/ })).toBeVisible();
	await expect(page.getByRole("button", { name: "字体", exact: true })).toHaveText(
		"IBM Plex Sans SC",
	);
	await page.screenshot({ path: "test-results/pr-caption-preset.png", animations: "disabled" });
});

test("simplified Chinese settings and animation labels use Chinese", async ({ page }) => {
	await prepare(page);
	await page.getByRole("button", { name: "应用设置", exact: true }).click();
	await expect(page.getByRole("row", { name: "常规", exact: true })).toBeVisible();
	await expect(page.getByRole("row", { name: "浅色", exact: true })).toBeVisible();
	await expect(page.getByRole("button", { name: "查看教程", exact: true })).toBeVisible();
	await page.getByRole("button", { name: /^简体中文/ }).click();
	await expect(page.getByRole("option", { name: "简体中文", exact: true })).toBeVisible();
	await expect(page.getByText("簡體中文", { exact: true })).toHaveCount(0);
	await page.keyboard.press("Escape");
	await page.getByRole("dialog", { name: "应用设置", exact: true }).getByRole("button", { name: "关闭", exact: true }).click();
	await page.getByRole("radio", { name: "字幕", exact: true }).click();
	await expect(page.getByRole("button", { name: /^淡入淡出/ })).toBeVisible();
	await expect(page.getByText("字幕生成", { exact: true })).toBeVisible();
	await expect(page.getByRole("button", { name: /^中文（简体）/ })).toBeVisible();
});

test("local fonts are searchable and subtitle presets survive restart and apply to another project", async ({
	page,
}) => {
	test.setTimeout(60000);
	await prepare(page);
	await page.getByRole("radio", { name: "字幕", exact: true }).click();
	await page.getByRole("button", { name: "字体", exact: true }).click();
	const fonts = page.getByRole("dialog", { name: "选择本地字体", exact: true });
	await fonts.getByRole("textbox", { name: "搜索字体" }).fill("plex");
	await expect(fonts.getByRole("option", { name: "Arial", exact: true })).toHaveCount(0);
	await expect(fonts.getByRole("option", { name: "IBM Plex Sans SC", exact: true })).toHaveCount(
		1,
	);
	await fonts.getByRole("option", { name: "IBM Plex Sans SC", exact: true }).click();
	await expect(page.getByRole("button", { name: "字体", exact: true })).toHaveText(
		"IBM Plex Sans SC",
	);
	await page.getByRole("button", { name: "投影", exact: true }).click();
	await page.getByRole("textbox", { name: "字幕预设名称" }).fill("阿真的字幕");
	await page.getByRole("button", { name: "保存预设", exact: true }).click();
	await expect(page.getByRole("button", { name: "删除字幕预设 阿真的字幕" })).toBeVisible();
	await expect
		.poll(async () => (await saved(page))?.autoCaptionSettings)
		.toMatchObject({
			fontFamily: '"IBM Plex Sans SC"',
			fontWeight: "bold",
			shadowEnabled: true,
			backgroundOpacity: 0,
		});
	const style = (await saved(page)).autoCaptionSettings;
	const cues = (await saved(page)).autoCaptions;
	await page.screenshot({
		path: "test-results/caption-fonts-presets-zh.png",
		animations: "disabled",
	});
	await page.getByRole("textbox", { name: "字幕预设名称" }).fill("阿真的字幕");
	await page.getByRole("button", { name: "保存预设", exact: true }).click();
	await expect(page.getByText("已存在同名字幕预设。", { exact: true })).toBeVisible();
	await page.getByRole("button", { name: "打开工程", exact: true }).click();
	await expect(page.getByRole("button", { name: "重命名项目", exact: true })).toHaveText("other");
	await expect.poll(async () => (await saved(page))?.wallpaper).toBe("#abcdef");
	await page.reload();
	await expect(page.locator('[data-variant="clip"]')).toHaveCount(1);
	await page.getByRole("radio", { name: "字幕", exact: true }).click();
	await page.getByRole("button", { name: /^选择字幕预设/ }).click();
	await page.getByRole("option", { name: "阿真的字幕", exact: true }).click();
	await expect
		.poll(async () => (await saved(page))?.autoCaptionSettings)
		.toEqual({ ...style, enabled: false, language: "en" });
	expect((await saved(page)).wallpaper).toBe("#abcdef");
	expect((await saved(page)).autoCaptions).toEqual(cues);
	await page.getByRole("button", { name: "删除字幕预设 阿真的字幕", exact: true }).click();
	await page.reload();
	await page.getByRole("radio", { name: "字幕", exact: true }).click();
	await expect(page.getByRole("button", { name: "删除字幕预设 阿真的字幕" })).toHaveCount(0);
});

test("font access failure supports retry and manual font names", async ({ page }) => {
	await prepare(page);
	await expect(page.getByText("波形生成失败", { exact: true })).toHaveCount(0);
	await page.evaluate(() =>
		Object.assign(window, {
			queryLocalFonts: async () => {
				throw new Error("denied");
			},
		}),
	);
	await page.getByRole("radio", { name: "字幕", exact: true }).click();
	await page.getByRole("button", { name: "字体", exact: true }).click();
	await expect(page.getByRole("alert")).toContainText("无法读取本地字体");
	await page.evaluate(() =>
		Object.assign(window, { queryLocalFonts: async () => [{ family: "微软雅黑" }] }),
	);
	await page.getByRole("dialog", { name: "选择本地字体", exact: true }).getByRole("button", { name: "重试", exact: true }).click();
	await page.getByRole("option", { name: "微软雅黑", exact: true }).click();
	await page.getByRole("button", { name: "字体", exact: true }).click();
	await page.getByRole("textbox", { name: "搜索字体" }).fill("Microsoft YaHei");
	await page.getByRole("textbox", { name: "搜索字体" }).press("Enter");
	await expect
		.poll(async () => (await saved(page))?.autoCaptionSettings.fontFamily)
		.toBe('"Microsoft YaHei"');
});

test("large font menus keep keyboard navigation and search over the entire cached catalog", async ({ page }) => {
	await prepare(page);
	await page.evaluate(() => {
		let reads = 0;
		Object.assign(window, {
			fontReadCount: () => reads,
			queryLocalFonts: async () => {
				reads++;
				return Array.from({ length: 600 }, (_, index) => ({
					family: `Test Font ${String(index).padStart(3, "0")}`,
				}));
			},
		});
	});
	const captions = page.getByRole("radio", { name: "字幕", exact: true });
	const font = page.getByRole("button", { name: "字体", exact: true });
	const search = page.getByRole("textbox", { name: "搜索字体" });
	const options = page.getByRole("option", { name: /^Test Font/ });
	await captions.click();
	await font.click();
	await expect(options.first()).toHaveAttribute("aria-setsize", "600");
	expect(await options.count()).toBeLessThan(25);
	await search.press("ArrowDown");
	await page.keyboard.press("End");
	await expect(page.getByRole("option", { name: "Test Font 599", exact: true })).toBeFocused();
	await page.keyboard.press("Home");
	await expect(page.getByRole("option", { name: "Test Font 000", exact: true })).toBeFocused();
	await search.fill("537");
	await expect(options).toHaveCount(1);
	await search.press("Enter");
	await expect(font).toHaveText("Test Font 537");
	await page.getByRole("radio", { name: "场景", exact: true }).click();
	await captions.click();
	await font.click();
	await expect(options.first()).toHaveAttribute("aria-setsize", "600");
	expect(await page.evaluate(() => (window as Window & { fontReadCount: () => number }).fontReadCount())).toBe(1);
});
