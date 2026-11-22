import { expect, test, type Page } from "@playwright/test";
import { installDesktopBridge, installDesktopBridgeOverrides } from "./bridge";

async function prepare(page: Page) {
	await installDesktopBridge(page, "waveform.mp4");
	await installDesktopBridgeOverrides(page, () => {
		localStorage.setItem("leadcut.locale", "zh-CN");
		const initial = {
			version: 2,
			projectId: "srt-import",
			videoPath: `${location.origin}/tests/ui/fixtures/waveform.mp4`,
			editor: {
				wallpaper: "#123456",
				clipRegions: [
					{ id: "clip", startMs: 0, endMs: 2000, sourceStartMs: 2000, speed: 2 },
				],
				autoCaptions: [{ id: "old", startMs: 2000, endMs: 2500, text: "原字幕" }],
				autoCaptionSettings: {
					enabled: true,
					fontFamily: '"IBM Plex Sans SC"',
					fontSize: 44,
					strokeWidth: 2,
				},
			},
		};
		window.electronAPI.loadCurrentProjectFile = async () => ({
			success: true,
			path: "/projects/srt.leadcut",
			project: JSON.parse(sessionStorage.getItem("srt-project") ?? JSON.stringify(initial)),
		});
		window.electronAPI.saveProjectFile = async (project) => {
			sessionStorage.setItem("srt-project", JSON.stringify(project));
			return { success: true, path: "/projects/srt.leadcut", projectId: project.projectId };
		};
		window.electronAPI.importSrtCaptions = async () => {
			const mode = sessionStorage.getItem("import-mode");
			if (mode === "cancel") return { success: false, canceled: true };
			if (mode === "invalid") return { success: false, errorCode: "invalidFormat" };
			return {
				success: true,
				path: "/subtitles/字幕.srt",
				cues: [
					{
						id: "srt-1",
						startMs: 500,
						endMs: 1000,
						text: "第一句字幕",
						timeBasis: "timeline" as const,
					},
					{
						id: "srt-2",
						startMs: 1200,
						endMs: 1800,
						text: "第二句字幕",
						timeBasis: "timeline" as const,
					},
				],
			};
		};
	});
	await page.goto("/?windowType=editor");
	await expect(page.locator('[data-variant="clip"]')).toHaveCount(1, { timeout: 20000 });
	await page.getByRole("radio", { name: "字幕", exact: true }).click();
}
async function editor(page: Page) {
	return page.evaluate(() => JSON.parse(sessionStorage.getItem("srt-project") ?? "{}").editor);
}

test("SRT imports without ASR, aligns to an edited timeline, supports undo and editing after reopening", async ({
	page,
}) => {
	test.setTimeout(60000);
	await prepare(page);
	await expect(page.getByRole("button", { name: "重新生成字幕", exact: true })).toBeDisabled();
	await page.getByRole("button", { name: "导入 SRT 字幕", exact: true }).click();
	const captions = page.locator('[data-variant="caption"]');
	const transcript = page.getByRole("region", { name: "字幕文稿", exact: true });
	await expect(transcript).toBeVisible();
	await expect(transcript.getByRole("row")).toHaveCount(2);
	await expect(captions).toHaveCount(2);
	await expect(captions.first()).toHaveAttribute("data-start-ms", "500");
	await expect(captions.first()).toHaveAttribute("data-end-ms", "1000");
	await expect
		.poll(async () => (await editor(page))?.autoCaptions)
		.toEqual([
			{ id: "srt-1", startMs: 500, endMs: 1000, text: "第一句字幕", timeBasis: "timeline" },
			{ id: "srt-2", startMs: 1200, endMs: 1800, text: "第二句字幕", timeBasis: "timeline" },
		]);
	expect((await editor(page)).autoCaptionSettings).toMatchObject({
		fontFamily: '"IBM Plex Sans SC"',
		fontSize: 44,
		strokeWidth: 2,
		enabled: true,
	});
	await page.getByRole("button", { name: "撤销", exact: true }).click();
	await expect(captions).toHaveCount(1);
	await expect.poll(async () => (await editor(page))?.autoCaptions[0].text).toBe("原字幕");
	await page.getByRole("button", { name: "重做", exact: true }).click();
	await expect(captions).toHaveCount(2);
	await expect.poll(async () => (await editor(page))?.autoCaptions[0].timeBasis).toBe("timeline");
	await page.reload();
	await expect(captions).toHaveCount(2);
	await expect
		.poll(() =>
			page
				.locator("video")
				.evaluateAll((videos) =>
					videos.some((video) => (video as HTMLVideoElement).readyState >= 2),
				),
		)
		.toBe(true);
	await expect.poll(() => page.locator("video.pointer-events-none").last().evaluate(video =>
		(video as HTMLVideoElement).readyState >= 2 && !(video as HTMLVideoElement).seeking,
	)).toBe(true);
	await captions.first().locator(".timeline-block").click();
	await expect(page.getByTestId("playhead-cap")).toHaveAttribute("aria-label", "播放头：00:00:00.500");
	const firstRow = transcript.getByRole("row").first();
	await expect(firstRow).toHaveAttribute("aria-selected", "true");
	await firstRow.getByRole("button", { name: "第一句字幕", exact: true }).click();
	const text = firstRow.getByRole("textbox", { name: "编辑字幕文字", exact: true });
	await text.fill("校对后的第一句");
	await text.press("Escape");
	await expect
		.poll(async () => (await editor(page))?.autoCaptions[0].text)
		.toBe("校对后的第一句");
	expect((await editor(page)).autoCaptions[0].timeBasis).toBe("timeline");
	await firstRow.getByRole("button", { name: /^起点/ }).dblclick();
	const start = firstRow.getByRole("textbox", { name: "起点", exact: true });
	await start.fill("0:00.600");
	await start.press("Enter");
	await expect(captions.first()).toHaveAttribute("data-start-ms", "600");
	await expect.poll(async () => (await editor(page))?.autoCaptions[0].startMs).toBe(600);
	await page.screenshot({ path: "test-results/srt-import-edit-zh.png", animations: "disabled" });
});

test("cancel or invalid SRT keeps existing subtitles and allows a later successful import", async ({
	page,
}) => {
	await prepare(page);
	for (const mode of ["cancel", "invalid"]) {
		await page.evaluate((mode) => sessionStorage.setItem("import-mode", mode), mode);
		await page.getByRole("button", { name: "导入 SRT 字幕", exact: true }).click();
		if (mode === "invalid")
			await expect(
				page.getByText("SRT 格式不正确，请检查字幕序号和时间戳。", { exact: true }),
			).toBeVisible();
		await expect(page.locator('[data-variant="caption"]')).toHaveCount(1);
		await expect.poll(async () => (await editor(page))?.autoCaptions[0].text).toBe("原字幕");
	}
	await page.evaluate(() => sessionStorage.removeItem("import-mode"));
	await page.getByRole("button", { name: "导入 SRT 字幕", exact: true }).click();
	await expect(page.locator('[data-variant="caption"]')).toHaveCount(2);
});
