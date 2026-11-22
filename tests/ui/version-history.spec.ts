import { expect, test, type Page } from "@playwright/test";
import { installDesktopBridge, installDesktopBridgeOverrides } from "./bridge";

async function openVersionHistory(page: Page) {
	await page.getByRole("button", { name: "More actions", exact: true }).click();
	await page.getByRole("menuitem", { name: "Version history", exact: true }).click();
	return page.getByRole("dialog", { name: "Version history", exact: true });
}

test("lists project snapshots, previews without saves, and reloads after restoring", async ({ page }) => {
	await installDesktopBridge(page, "waveform.mp4");
	await installDesktopBridgeOverrides(page, () => {
		const path = "/projects/Versioned.leadcut";
		const videoPath = `${location.origin}/tests/ui/fixtures/waveform.mp4`;
		const projectAt = (id: string, endMs: number) => ({
			version: 2, projectId: "versioned-project", videoPath,
			editor: { clipRegions: [{ id, startMs: 0, endMs, sourceStartMs: 0, speed: 1 }] },
		});
		const original = projectAt("original-clip", 6000);
		const historical = projectAt("agent-clip", 4000);
		let current = original;
		let revision = "current-revision";
		window.electronAPI.loadCurrentProjectFile = async () => ({ success: true, path, revision, project: current });
		window.electronAPI.listProjectVersions = async () => ({ success: true, versions: [
			{ id: "app", path: "/history/app", source: "app", createdAt: 1700000002000, durationMs: 6000, sizeBytes: 100 },
			{ id: "before-restore", path: "/history/prior", source: "before-restore", createdAt: 1700000001000, durationMs: 6000, sizeBytes: 100 },
			{ id: "agent", path: "/history/agent", source: "agent", createdAt: 1700000000000, durationMs: 4000, sizeBytes: 100 },
		] });
		window.electronAPI.readProjectVersion = async () => ({ success: true, project: historical });
		window.electronAPI.restoreProjectVersion = async (versionPath, expectedRevision) => {
			document.documentElement.dataset.restoredVersion = versionPath;
			document.documentElement.dataset.restoreExpectedRevision = expectedRevision;
			current = historical;
			revision = "restored-revision";
			return { success: true, revision };
		};
		window.electronAPI.onMenuSaveProject = callback => {
			const request = () => { void callback(); };
			window.addEventListener("test-native-save", request);
			return () => window.removeEventListener("test-native-save", request);
		};
		window.electronAPI.onMenuSaveProjectAs = callback => {
			const request = () => { void callback(); };
			window.addEventListener("test-native-save-as", request);
			return () => window.removeEventListener("test-native-save-as", request);
		};
	});
	await page.goto("/?windowType=editor");
	await expect(page.locator('[data-region-id="original-clip"]')).toHaveCount(1, { timeout: 25000 });
	await expect(page.getByLabel("Loading preview", { exact: true })).toHaveCount(0, { timeout: 25000 });
	const html = page.locator("html");
	const before = await html.getAttribute("data-project-saves");
	const list = await openVersionHistory(page);
	const rows = list.getByRole("listitem");
	await expect(rows).toHaveCount(3);
	await expect(rows.nth(0)).toContainText("Automatic snapshot");
	await expect(rows.nth(1)).toContainText("Before restore");
	await expect(rows.nth(2)).toContainText("Before Agent edit");
	await expect(rows.nth(2)).toContainText("Duration 0:04");
	await rows.nth(2).getByRole("button", { name: "Preview" }).click();
	await expect(page.getByText("Previewing a historical version")).toBeVisible();
	await expect(page.locator('[data-region-id="agent-clip"]')).toHaveCount(1);
	await expect(page.locator('[data-timeline-panel]')).toHaveAttribute("inert");
	await page.evaluate(() => {
		window.dispatchEvent(new Event("test-native-save"));
		window.dispatchEvent(new Event("test-native-save-as"));
	});
	await page.waitForTimeout(800);
	expect(await html.getAttribute("data-project-saves")).toBe(before);
	await page.getByRole("button", { name: "Return to current version" }).click();
	await expect(page.locator('[data-region-id="original-clip"]')).toHaveCount(1);
	const reopened = await openVersionHistory(page);
	await reopened.getByRole("listitem").nth(2).getByRole("button", { name: "Restore" }).click();
	await expect(html).toHaveAttribute("data-restored-version", "/history/agent");
	await expect(html).toHaveAttribute("data-restore-expected-revision", "current-revision");
	await expect(page.locator('[data-region-id="agent-clip"]')).toHaveCount(1);
	await expect(page.getByText("Project version restored.")).toBeVisible();
	expect(await html.getAttribute("data-project-saves")).toBe(before);
});
