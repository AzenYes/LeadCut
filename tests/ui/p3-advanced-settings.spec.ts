import { expect, test } from "@playwright/test";
import { installDesktopBridge, installDesktopBridgeOverrides } from "./bridge";

test("remembers independent Advanced settings toggles across reloads", async ({ page }) => {
	await installDesktopBridge(page);
	await installDesktopBridgeOverrides(page, () => {
		const get = window.electronAPI.getAppSetting;
		const set = window.electronAPI.setAppSetting;
		const key = "leadcut.editor.advancedSections";
		window.electronAPI.getAppSetting = name => name === key
			? JSON.parse(sessionStorage.getItem(key) ?? "null") : get(name);
		window.electronAPI.setAppSetting = (name, value) => {
			if (name !== key) return set(name, value);
			sessionStorage.setItem(key, JSON.stringify(value));
			return true;
		};
	});
	await page.goto("/?windowType=editor");
	const advanced = page.getByRole("switch", { name: "Advanced settings" });
	await page.getByRole("radio", { name: "Cursor", exact: true }).click();
	await expect(advanced).not.toBeChecked();
	await advanced.press("Space");
	await expect(advanced).toBeChecked();
	await page.getByRole("radio", { name: "Scene", exact: true }).click();
	await expect(advanced).not.toBeChecked();
	await page.reload();
	await page.getByRole("radio", { name: "Cursor", exact: true }).click();
	await expect(advanced).toBeChecked();
});
