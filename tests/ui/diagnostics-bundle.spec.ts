import { expect, test } from "@playwright/test";
import { installDesktopBridge, installDesktopBridgeOverrides } from "./bridge";

test("can export a diagnostics bundle after an export fails", async ({ page }) => {
	test.setTimeout(90000);
	await installDesktopBridge(page, "waveform.mp4");
	await installDesktopBridgeOverrides(page, () => {
		window.electronAPI.chooseExportPath = async () => { throw new Error("Output location is read-only"); };
		window.electronAPI.exportDiagnosticsBundle = async () => {
			document.documentElement.dataset.diagnosticsExported = "true";
			return { success: true, path: "/diagnostics/LeadCut" };
		};
		window.electronAPI.writeAppLog = (level, scope, message) => {
			if (level === "error" && scope === "export") document.documentElement.dataset.lastExportError = message;
		};
	});
	await page.goto("/?windowType=editor");
	const exportButton = page.getByRole("button", { name: "Export video", exact: true });
	await expect(exportButton).toBeVisible({ timeout: 65000 });
	await expect(page.getByLabel("Loading preview", { exact: true })).toHaveCount(0, { timeout: 25000 });
	await exportButton.click();
	await page.getByRole("button", { name: "Export MP4", exact: true }).click();
	await expect(page.getByText("Output location is read-only")).toBeVisible();
	await expect(page.getByRole("button", { name: "Copy error" })).toBeVisible();
	await page.getByRole("button", { name: "Export diagnostics bundle" }).click();
	await expect(page.locator("html")).toHaveAttribute("data-diagnostics-exported", "true");
	await expect(page.locator("html")).toHaveAttribute("data-last-export-error", "Output location is read-only");
});
