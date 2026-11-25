import { expect, test } from "@playwright/test";
import { installDesktopBridge, installDesktopBridgeOverrides } from "./bridge";

test("project appearance becomes a new recording default only after explicit save", async ({ page }) => {
	test.setTimeout(60_000);
	await installDesktopBridge(page, "waveform.mp4");
	await installDesktopBridgeOverrides(page, () => {
		const key = "leadcut.editor.preferences";
		window.electronAPI.getAppSetting = name => name === "leadcut.onboarding.v1.seen" ? true
			: name === key ? JSON.parse(localStorage.getItem("test-defaults") ?? '{"wallpaper":"#113355","connectZooms":true}') : null;
		window.electronAPI.patchEditorPreferences = async (preferences, flush) => {
			if ("wallpaper" in preferences && (!flush || sessionStorage.getItem("fail-default-write"))) return false;
			const current = window.electronAPI.getAppSetting(key) as object;
			localStorage.setItem("test-defaults", JSON.stringify({ ...current, ...preferences }));
			return true;
		};
		window.electronAPI.loadCurrentProjectFile = async () => sessionStorage.getItem("new-recording")
			? { success: false } : {
				success: true, path: "/projects/Older project.leadcut",
				project: { version: 2, videoPath: `${location.origin}/tests/ui/fixtures/waveform.mp4`, editor: {
					wallpaper: "#654321", connectZooms: false,
					clipRegions: [{ id: "older", startMs: 0, endMs: 2500, sourceStartMs: 0, speed: 1 }],
				} },
			};
		window.electronAPI.saveProjectFile = async (data, _name, path) => {
			sessionStorage.setItem("saved-older", JSON.stringify(data));
			return { success: true, path };
		};
	});
	await page.goto("/?windowType=editor");
	const inspector = page.getByRole("complementary", { name: "Inspector", exact: true })
		.or(page.locator("#editor-inspector"));
	const readDefaults = () => page.evaluate(() => window.electronAPI.getAppSetting("leadcut.editor.preferences"));
	await expect(page.locator('[data-region-id="older"]')).toBeVisible({ timeout: 20_000 });
	await expect(inspector).toContainText("Saved with this project.");
	expect(await readDefaults()).toMatchObject({ wallpaper: "#113355", connectZooms: true });

	await inspector.getByRole("row", { name: "Image", exact: true }).click();
	await inspector.getByRole("button", { name: "Tahoe Dark", exact: true }).click();
	await expect.poll(() => page.evaluate(() => JSON.parse(sessionStorage.getItem("saved-older") ?? "{}").editor?.wallpaper))
		.toMatch(/tahoe-dark\.jpg$/i);
	expect(await readDefaults()).toMatchObject({ wallpaper: "#113355", connectZooms: true });

	const appSettings = page.getByRole("dialog", { name: "Application settings", exact: true });
	await page.getByRole("button", { name: "Application settings", exact: true }).click();
	await expect(appSettings).toContainText("Applies throughout LeadCut.");
	await expect(appSettings.getByText("Language", { exact: true })).toBeVisible();
	await expect(inspector.getByText("Language", { exact: true })).toHaveCount(0);
	await appSettings.getByRole("button", { name: "Close", exact: true }).click();
	await page.locator('[data-region-id="older"]').click();
	await expect(inspector).toContainText("Applies to the selected item.");
	await page.getByRole("radio", { name: "Scene", exact: true }).click();

	const saveDefault = inspector.getByRole("button", { name: "Use appearance for new recordings", exact: true });
	await page.evaluate(() => sessionStorage.setItem("fail-default-write", "1"));
	await saveDefault.click();
	await expect(page.getByText("Could not save the recording defaults.", { exact: true })).toBeVisible();
	expect(await readDefaults()).toMatchObject({ wallpaper: "#113355", connectZooms: true });
	await page.evaluate(() => sessionStorage.removeItem("fail-default-write"));
	await saveDefault.click();
	await expect(page.getByText("Appearance saved for new recordings.", { exact: true })).toBeVisible();
	expect(await readDefaults()).toMatchObject({ wallpaper: expect.stringMatching(/tahoe-dark\.jpg$/i), connectZooms: false });

	await page.evaluate(() => sessionStorage.setItem("new-recording", "1"));
	await page.reload();
	await expect(page.locator('[data-variant="clip"]')).toHaveCount(1, { timeout: 20_000 });
	await expect(inspector.getByRole("button", { name: "Tahoe Dark", exact: true })).toHaveAttribute("aria-pressed", "true");
});
