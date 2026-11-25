import { expect, test } from "@playwright/test";
import { installDesktopBridge, installDesktopBridgeOverrides } from "./bridge";

test("editor paints a wireframe before JavaScript loads", async ({ page }) => {
	await page.route("**/src/main.tsx*", (route) => route.abort());
	await page.goto("/?windowType=editor");
	await expect(page.getByRole("status", { name: "Loading editor" })).toBeVisible();
	await expect(page.locator(".boot-preview i").first()).toBeVisible();
	await page.goto("/?windowType=hud-overlay");
	await expect(page.locator(".boot-shell")).not.toBeVisible();
});

test("wireframe gives way to the editor and the dashboard library loads on demand", async ({ page }) => {
	await installDesktopBridge(page);
	await installDesktopBridgeOverrides(page, () => {
		const list = window.electronAPI.listProjectFiles;
		window.electronAPI.listProjectFiles = () => {
			const state = document.documentElement.dataset;
			state.startupLibraryReads = String(Number(state.startupLibraryReads || 0) + 1);
			return list();
		};
	});
	let release!: () => void;
	const paused = new Promise<void>((resolve) => { release = resolve; });
	await page.route("**/components/video-editor/EditorWindow.tsx*", async (route) => {
		await paused;
		await route.continue();
	});
	await page.goto("/?windowType=editor", { waitUntil: "domcontentloaded" });
	await expect(page.locator(".boot-shell")).toHaveCount(0);
	await expect(page.getByRole("status", { name: "Loading editor" })).toBeVisible();
	release();
	const home = page.getByRole("button", { name: "Home", exact: true });
	await expect(home).toBeVisible({ timeout: 20_000 });
	await expect(page.getByRole("status", { name: "Loading editor" })).toHaveCount(0);
	await expect(page.locator("html")).not.toHaveAttribute("data-startup-library-reads", /\d/);
	await home.click();
	await expect(page.getByRole("dialog", { name: "Projects dashboard" })).toBeVisible();
	await expect(page.locator("html")).toHaveAttribute("data-startup-library-reads", "1");
});

test("native export capability is requested when the export menu opens", async ({ page }) => {
	await installDesktopBridge(page, "waveform.mp4");
	await installDesktopBridgeOverrides(page, () => {
		window.electronAPI.getNativeExportCapabilities = async () => {
			const state = document.documentElement.dataset;
			state.exportProbes = String(Number(state.exportProbes || 0) + 1);
			return { success: true, capabilities: {
				platform: "win32", nvidiaCuda: {
					available: true, skipReason: null, hasNvidiaGpu: true, hasWrapper: true,
					explicitEnabled: false, explicitDisabled: false, userOptInRequired: true,
				},
			} };
		};
	});
	await page.goto("/?windowType=editor");
	await expect(page.locator("[data-variant=clip]")).toBeVisible({ timeout: 20_000 });
	await expect(page.getByLabel("Loading preview", { exact: true })).toHaveCount(0);
	const document = page.locator("html");
	await expect(document).not.toHaveAttribute("data-export-probes", /\d/);
	const exportButton = page.getByRole("button", { name: "Export video", exact: true });
	await exportButton.click();
	await expect(page.getByText("NVIDIA CUDA", { exact: true })).toBeVisible();
	await expect(document).toHaveAttribute("data-export-probes", "1");
	await page.keyboard.press("Escape");
	await exportButton.click();
	await expect(page.getByText("NVIDIA CUDA", { exact: true })).toBeVisible();
	await expect(document).toHaveAttribute("data-export-probes", "1");
});
