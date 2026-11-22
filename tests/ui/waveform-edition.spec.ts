import { expect, test } from "@playwright/test";
import { installDesktopBridge, installDesktopBridgeOverrides } from "./bridge";

test("subtitle lane, styles and custom project locations survive Save As and reopen", async ({
	page,
}) => {
	test.setTimeout(60000);
	await installDesktopBridge(page, "waveform.mp4");
	await installDesktopBridgeOverrides(page, () => {
		Object.assign(window, { queryLocalFonts: async () => [] });
		window.electronAPI.saveProjectFile = async (project, _name, existingPath) => {
			sessionStorage.setItem("waveform-project", JSON.stringify(project));
			const path = existingPath || "E:/Custom Projects/Subtitle Demo.leadcut";
			sessionStorage.setItem("waveform-project-path", path);
			if (!existingPath) document.documentElement.dataset.nativeSaveAs = "true";
			return { success: true, path, projectId: project.projectId };
		};
		window.electronAPI.loadProjectFile = async () => {
			document.documentElement.dataset.nativeOpen = "true";
			return {
				success: true,
				path: sessionStorage.getItem("waveform-project-path")!,
				project: JSON.parse(sessionStorage.getItem("waveform-project")!),
			};
		};
	});
	await page.goto("/?windowType=editor");
	await expect(page.locator("[data-source-audio-clip]")).toBeVisible({ timeout: 20000 });
	await page.getByRole("radio", { name: "Captions", exact: true }).click();
	const show = page.getByRole("switch", { name: "Show", exact: true });
	await page
		.locator('[data-slot="switch"]')
		.filter({ has: show })
		.locator('[data-slot="switch-control"]')
		.click();
	await page.getByRole("button", { name: "Add caption", exact: true }).click();
	const caption = page.locator('[data-variant="caption"]');
	await expect(caption).toBeVisible();
	const captionBox = (await caption.boundingBox())!;
	const clipBox = (await page.locator('[data-variant="clip"]').boundingBox())!;
	expect(captionBox.y + captionBox.height).toBeLessThanOrEqual(clipBox.y);
	const transcript = page.getByRole("region", { name: "Caption transcript", exact: true });
	await transcript.locator("[data-caption-text]").click();
	const text = transcript.getByRole("textbox", { name: "Edit caption text", exact: true });
	await text.fill("阿真的字幕：字体、描边、投影");
	await text.press("Escape");
	await page.getByRole("radio", { name: "Captions", exact: true }).click();
	await page.getByRole("button", { name: "Outlined", exact: true }).click();
	const font = page.getByRole("button", { name: "Font", exact: true });
	await font.click();
	const fontSearch = page.getByRole("textbox", { name: "Search fonts" });
	await fontSearch.fill("Microsoft YaHei");
	await fontSearch.press("Enter");
	const shadow = page.getByRole("switch", { name: "Drop shadow", exact: true });
	await page
		.locator('[data-slot="switch"]')
		.filter({ has: shadow })
		.locator('[data-slot="switch-control"]')
		.click();
	const preview = page.getByRole("button", { name: "Edit current caption", exact: true });
	await expect(preview).toBeVisible();
	const word = preview.locator("span").first();
	await expect(word).toHaveCSS("font-weight", "700");
	await expect
		.poll(() => word.evaluate((node) => getComputedStyle(node).webkitTextStrokeWidth))
		.not.toBe("0px");
	await expect
		.poll(() => word.evaluate((node) => getComputedStyle(node).textShadow))
		.not.toBe("none");
	await page.getByRole("button", { name: "Save As", exact: true }).click();
	await expect(page.locator("html")).toHaveAttribute("data-native-save-as", "true");
	await expect
		.poll(() =>
			page.evaluate(
				() =>
					JSON.parse(sessionStorage.getItem("waveform-project")!).editor
						.autoCaptionSettings.fontFamily,
			),
		)
		.toBe('"Microsoft YaHei"');
	await page.getByRole("button", { name: "Open project", exact: true }).click();
	await expect(page.locator("html")).toHaveAttribute("data-native-open", "true");
	await page.getByRole("radio", { name: "Captions", exact: true }).click();
	await expect(font).toHaveText(
		"Microsoft YaHei",
	);
	await expect(caption).toHaveCount(1);
	await expect(shadow).toBeChecked();
	await page.screenshot({
		path: "test-results/waveform-edition-subtitles.png",
		animations: "disabled",
	});
});
