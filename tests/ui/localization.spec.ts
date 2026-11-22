import { expect, test, type Page } from "@playwright/test";
import { installDesktopBridge, installDesktopBridgeOverrides } from "./bridge";
test.use({ reducedMotion: "reduce" });

async function prepare(page: Page) {
	await installDesktopBridge(page, "waveform.mp4");
	await installDesktopBridgeOverrides(page, () => {
		if (!localStorage.getItem("leadcut.locale")) localStorage.setItem("leadcut.locale", "zh-CN");
		window.electronAPI.listProjectFiles = async () => ({
			success: true, projects: [], entries: [
				{ path: "/projects/demo.leadcut", name: "演示项目", updatedAt: Date.now(), thumbnailPath: null, isCurrent: false, isInProjectsDirectory: true },
			],
		});
		window.electronAPI.getWhisperSmallModelStatus = async () => ({ success: true, exists: true, path: "/models/small.bin" });
		window.electronAPI.generateAutoCaptions = async () => ({ success: false, error: "No source video is loaded" });
		window.electronAPI.openProjectFileAtPath = async (path) => ({
			success: true,
			path,
			revision: "localization-project-revision",
			project: {
				version: 2,
				projectId: "test-project",
				videoPath: `${location.origin}/tests/ui/fixtures/waveform.mp4`,
				editor: { clipRegions: [{ id: "screen", startMs: 0, endMs: 6000, sourceStartMs: 0, speed: 1 }] },
			},
		});
	});
	await page.goto("/?windowType=editor");
	await expect(page.getByRole("navigation", { name: "编辑工具" })).toBeVisible();
	await expect(page.locator('[data-variant="clip"]')).toHaveCount(1);
}

test("Chinese dashboard supports searching, folder creation and selection without English labels", async ({ page }) => {
	await prepare(page);
	await page.getByRole("button", { name: "主页", exact: true }).click();
	const dashboard = page.getByRole("dialog", { name: "项目管理", exact: true });
	await expect(dashboard.getByRole("button", { name: "首页", exact: true })).toBeVisible();
	await expect(dashboard.getByRole("button", { name: "原始素材", exact: true })).toBeVisible();
	await dashboard.getByRole("textbox", { name: "搜索项目", exact: true }).fill("找不到的项目");
	await expect(dashboard.getByText("没有符合条件的项目", { exact: true })).toBeVisible();
	await dashboard.getByRole("button", { name: "清空搜索", exact: true }).click();
	await dashboard.getByRole("button", { name: "新建文件夹", exact: true }).click();
	await dashboard.getByRole("button", { name: "未命名文件夹", exact: true }).dblclick();
	const name = dashboard.getByRole("textbox", { name: "文件夹名称", exact: true });
	await name.fill("讲解素材"); await name.press("Enter");
	await expect(dashboard.getByText("讲解素材", { exact: true })).toBeVisible();
	await dashboard.getByRole("button", { name: "首页", exact: true }).click();
	await dashboard.getByRole("button", { name: "选择要删除的项目", exact: true }).click();
	await dashboard.getByRole("button", { name: "全选", exact: true }).click();
	await expect(dashboard.getByText("已选择 1 项", { exact: true })).toBeVisible();
	await page.screenshot({ path: "test-results/localization-dashboard-zh.png", animations: "disabled" });
});

test("language switching refreshes component labels and persists the chosen language", async ({ page }) => {
	await prepare(page);
	await page.getByRole("radio", { name: "设置", exact: true }).click();
	await page.getByRole("button", { name: /简体中文/ }).click();
	await page.getByRole("option", { name: "English", exact: true }).click();
	await expect(page.locator("html")).toHaveAttribute("lang", "en");
	await page.reload();
	await expect(page.locator("html")).toHaveAttribute("lang", "en");
	await page.getByRole("radio", { name: "Settings", exact: true }).click();
	await expect(page.getByRole("button", { name: "Home", exact: true })).toBeVisible();
	await page.getByRole("button", { name: "Home", exact: true }).click();
	await expect(page.getByRole("dialog", { name: "Projects dashboard", exact: true })).toBeVisible();
	await expect(page.getByRole("textbox", { name: "Search projects", exact: true })).toBeVisible();
	await page.keyboard.press("Escape");
	await expect(page.getByRole("dialog", { name: "Projects dashboard", exact: true })).toBeHidden();
	await page.getByRole("button", { name: /English/ }).click();
	await page.getByRole("option", { name: "简体中文", exact: true }).click();
	await expect(page.locator("html")).toHaveAttribute("lang", "zh-CN");
	await page.reload();
	await expect(page.getByRole("button", { name: "主页", exact: true })).toBeVisible();
});

test("Chinese captions show translated runtime errors and notification actions", async ({ page }) => {
	await prepare(page);
	await page.evaluate(() => {
		Object.defineProperty(navigator, "clipboard", {
			configurable: true,
			value: { writeText: async (text: string) => { document.documentElement.dataset.copiedCaptionError = text; } },
		});
	});
	await page.getByRole("radio", { name: "字幕", exact: true }).click();
	await page.getByRole("button", { name: "生成字幕", exact: true }).click();
	await expect(page.getByText("尚未加载源视频", { exact: true })).toBeVisible();
	await page.getByRole("button", { name: "复制", exact: true }).click();
	await expect(page.locator("html")).toHaveAttribute("data-copied-caption-error", "尚未加载源视频");
	await expect(page.getByText("错误信息已复制", { exact: true })).toBeVisible();
	const notificationClose = page.getByRole("region", { name: "通知" }).getByRole("button", { name: "关闭", exact: true });
	await expect(notificationClose.first()).toBeVisible();
});

test("Chinese export dialog shows translated format settings", async ({ page }) => {
	await prepare(page);
	await page.getByRole("button", { name: "导出视频", exact: true }).click();
	const dialog = page.getByRole("dialog", { name: "导出视频", exact: true });
	await expect(dialog.getByRole("grid", { name: "清晰度", exact: true })).toBeVisible();
	await dialog.getByRole("row", { name: "GIF", exact: true }).click();
	await expect(dialog.getByRole("button", { name: "导出GIF", exact: true })).toBeVisible();
	await page.screenshot({ path: "test-results/localization-captions-export-zh.png", animations: "disabled" });
});
