import { expect, test, type Page } from "@playwright/test";
import { installDesktopBridge, installDesktopBridgeOverrides } from "./bridge";

async function prepare(page: Page) {
	await installDesktopBridge(page, "waveform.mp4");
	await installDesktopBridgeOverrides(page, () => {
		localStorage.setItem("leadcut.locale", "zh-CN");
		const firstPath = "/projects/项目_2026-10-09_08-05-03.leadcut";
		const secondPath = "/projects/second.leadcut";
		const original = {
			version: 2,
			projectId: "restored-editor-test",
			videoPath: `${location.origin}/tests/ui/fixtures/waveform.mp4`,
			editor: {
				wallpaper: "#123456",
				padding: 30,
				clipRegions: [{ id: "clip-1", startMs: 0, endMs: 6000, speed: 1 }],
				zoomRegions: [
					{
						id: "zoom-1",
						startMs: 300,
						endMs: 1800,
						depth: 2,
						focus: { cx: 0.2, cy: 0.3 },
						mode: "auto",
					},
					{
						id: "zoom-2",
						startMs: 2400,
						endMs: 3900,
						depth: 4,
						focus: { cx: 0.7, cy: 0.6 },
						mode: "manual",
					},
					{
						id: "zoom-3",
						startMs: 4300,
						endMs: 5800,
						depth: 6,
						focus: { cx: 0.4, cy: 0.8 },
						mode: "auto",
					},
				],
			},
		};
		window.electronAPI.getAppSetting = (key) =>
			key === "leadcut.onboarding.v1.seen"
				? true
				: JSON.parse(localStorage.getItem(`app:${key}`) ?? "null");
		window.electronAPI.setAppSetting = (key, value) => {
			localStorage.setItem(`app:${key}`, JSON.stringify(value));
			return true;
		};
		window.electronAPI.loadCurrentProjectFile = async () => ({
			success: true,
			path: sessionStorage.getItem("restored-project-path") ?? firstPath,
			project: JSON.parse(
				sessionStorage.getItem("restored-project") ?? JSON.stringify(original),
			),
		});
		window.electronAPI.saveProjectFile = async (project, _name, target) => {
			const path = target ?? firstPath;
			sessionStorage.setItem("restored-project", JSON.stringify(project));
			sessionStorage.setItem("restored-project-path", path);
			return { success: true, path, projectId: project.projectId };
		};
		window.electronAPI.loadProjectFile = async () => {
			const project = {
				...original,
				projectId: "second",
				editor: { ...original.editor, wallpaper: "#abcdef", padding: 10 },
			};
			sessionStorage.setItem("restored-project-path", secondPath);
			sessionStorage.setItem("restored-project", JSON.stringify(project));
			return { success: true, path: secondPath, project };
		};
	});
	await page.goto("/?windowType=editor");
	await expect(page.locator('[data-variant="zoom"]')).toHaveCount(3, { timeout: 20000 });
}

async function savedEditor(page: Page) {
	return page.evaluate(
		() => JSON.parse(sessionStorage.getItem("restored-project") ?? "{}").editor,
	);
}

test("apply zoom amount to all preserves timing, focus and modes, supports undo, redo and reopen", async ({
	page,
}) => {
	test.setTimeout(60000);
	await prepare(page);
	const zooms = page.locator('[data-variant="zoom"] .timeline-block');
	await zooms.first().click();
	await expect(page.getByRole("row", { name: "1.5×", exact: true })).toHaveAttribute(
		"aria-selected",
		"true",
	);
	await page.getByRole("row", { name: "1.8×", exact: true }).click();
	await expect
		.poll(async () =>
			(await savedEditor(page))?.zoomRegions.map((z: { depth: number }) => z.depth),
		)
		.toEqual([3, 4, 6]);
	const before = (await savedEditor(page)).zoomRegions;
	await page.getByRole("button", { name: "应用到所有缩放", exact: true }).click();
	await expect
		.poll(async () => (await savedEditor(page))?.zoomRegions)
		.toEqual(before.map((z: object) => ({ ...z, depth: 3 })));
	await page.getByRole("button", { name: "撤销", exact: true }).click();
	await expect.poll(async () => (await savedEditor(page))?.zoomRegions).toEqual(before);
	await page.getByRole("button", { name: "重做", exact: true }).click();
	await expect
		.poll(async () => (await savedEditor(page))?.zoomRegions)
		.toEqual(before.map((z: object) => ({ ...z, depth: 3 })));
	await page.reload();
	await expect(page.locator('[data-variant="zoom"] .zoom-value')).toHaveText([
		"1.8×自动",
		"1.8×手动",
		"1.8×自动",
	]);
	await page.locator('[data-variant="zoom"] .timeline-block').first().click();
	await page.screenshot({ path: "test-results/restored-zoom-zh.png", animations: "disabled" });
});

test("presets save in Chinese and can be applied to a different project after reload", async ({
	page,
}) => {
	test.setTimeout(60000);
	await prepare(page);
	await page.getByRole("button", { name: "打开预设", exact: true }).click();
	let presets = page.getByRole("dialog", { name: "预设", exact: true });
	await presets.getByRole("textbox", { name: "预设名称" }).fill("阿真的样式");
	await presets.getByRole("button", { name: "保存", exact: true }).click();
	await expect(
		presets.getByRole("button", { name: "删除预设 阿真的样式", exact: true }),
	).toBeVisible();
	await page.keyboard.press("Escape");
	await page.getByRole("button", { name: "打开工程", exact: true }).click();
	await expect.poll(async () => (await savedEditor(page))?.wallpaper).toBe("#abcdef");
	await page.reload();
	await expect(page.locator('[data-variant="clip"]')).toHaveCount(1, { timeout: 20000 });
	await page.getByRole("button", { name: "打开预设", exact: true }).click();
	presets = page.getByRole("dialog", { name: "预设", exact: true });
	await presets.getByRole("button", { name: "阿真的样式", exact: true }).click();
	await expect.poll(async () => (await savedEditor(page))?.wallpaper).toBe("#123456");
	await expect
		.poll(async () => (await savedEditor(page))?.padding)
		.toEqual({ top: 30, right: 30, bottom: 30, left: 30, linked: true });
	await page.screenshot({ path: "test-results/restored-presets-zh.png", animations: "disabled" });
});

test("export is visible, defaults to local even after a previous share, offers HD MP4 and GIF without feedback", async ({
	page,
}) => {
	test.setTimeout(60000);
	await prepare(page);
	await expect(page.getByRole("button", { name: /Feedback|反馈/ })).toHaveCount(0);
	await page.getByRole("button", { name: "导出视频", exact: true }).click();
	const menu = page.getByRole("dialog", { name: "导出视频", exact: true });
	await expect(menu.getByRole("row", { name: "分享链接", exact: true })).toHaveCount(0);
	await expect(menu.getByRole("grid", { name: "清晰度", exact: true })).toBeVisible();
	await expect(menu.getByRole("button", { name: "导出MP4", exact: true })).toBeVisible();
	await menu.getByRole("row", { name: "GIF", exact: true }).click();
	await expect(menu.getByRole("button", { name: "导出GIF", exact: true })).toBeVisible();
	await menu.getByRole("row", { name: "MP4", exact: true }).click();
	await page.screenshot({ path: "test-results/restored-export-zh.png", animations: "disabled" });

	await menu.press("Escape");
	await expect(menu).toHaveCount(0);
	await page.getByRole("button", { name: "导出视频", exact: true }).click();
	await expect(menu.getByRole("row", { name: "分享链接", exact: true })).toHaveCount(0);
	await menu.press("Escape");
	await expect(menu).toHaveCount(0);
	await page.setViewportSize({ width: 1100, height: 720 });
	await expect(page.getByRole("button", { name: "打开预设", exact: true })).toBeInViewport();
	await page.getByRole("button", { name: "导出视频", exact: true }).click();
	await menu.getByRole("button", { name: "导出MP4", exact: true }).scrollIntoViewIfNeeded();
	await expect(menu.getByRole("button", { name: "导出MP4", exact: true })).toBeInViewport();
});
