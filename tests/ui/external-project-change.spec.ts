import { expect, test, type Page } from "@playwright/test";
import { installDesktopBridge, installDesktopBridgeOverrides } from "./bridge";

test("autosave sends the opened revision and stops retrying when the disk version changes", async ({ page }) => {
	await installDesktopBridge(page, "waveform.mp4");
	await installDesktopBridgeOverrides(page, () => {
		const capture = `${location.origin}/tests/ui/fixtures/waveform.mp4`;
		window.electronAPI.loadCurrentProjectFile = async () => ({
			success: true,
			path: "/projects/Review.leadcut",
			revision: "opened-revision",
			project: {
				version: 2,
				projectId: "review-project",
				videoPath: capture,
				editor: { clipRegions: [{ id: "screen", startMs: 0, endMs: 6000, sourceStartMs: 0, speed: 1 }] },
			},
		});
		window.electronAPI.saveProjectFile = async (_data, _name, _path, _thumbnail, expectedRevision) => {
			const root = document.documentElement;
			root.dataset.saveAttempts = String(Number(root.dataset.saveAttempts ?? 0) + 1);
			root.dataset.requestedRevision = expectedRevision;
			return { success: false, conflict: true, diskRevision: "agent-revision" };
		};
	});
	await page.goto("/?windowType=editor");
	await expect(page.locator('[data-region-id="screen"]')).toHaveCount(1, { timeout: 20000 });
	await expect(page.getByLabel("Loading preview", { exact: true })).toHaveCount(0, { timeout: 20000 });
	await page.getByRole("button", { name: "Add caption", exact: true }).click();
	await expect(page.getByText("The project changed on disk. Your edits were not saved.", { exact: true })).toBeVisible();
	const html = page.locator("html");
	await expect(html).toHaveAttribute("data-requested-revision", "opened-revision");
	const transcript = page.getByRole("region", { name: "Caption transcript", exact: true });
	await transcript.locator("[data-caption-text]").click();
	const text = transcript.getByRole("textbox", { name: "Edit caption text", exact: true });
	await text.fill("Unsaved local caption");
	await text.press("Escape");
	await page.waitForTimeout(750);
	await expect(html).toHaveAttribute("data-save-attempts", "1");
	await expect(page.locator('[data-variant="caption"]')).toContainText("Unsaved local caption");
});

async function openProjectForExternalChange(page: Page) {
	await installDesktopBridge(page, "waveform.mp4");
	await installDesktopBridgeOverrides(page, () => {
		const path = "/projects/Review.leadcut";
		const videoPath = `${location.origin}/tests/ui/fixtures/waveform.mp4`;
		const initial = { id: "screen", startMs: 0, endMs: 6000, sourceStartMs: 0, speed: 1 };
		const base = { version: 2, projectId: "review-project", videoPath, editor: { clipRegions: [initial] } };
		const agent = { ...base, editor: { clipRegions: [
			{ ...initial, endMs: 3000 },
			{ ...initial, id: "agent-cut", startMs: 3000, sourceStartMs: 3000 },
		] } };
		window.electronAPI.loadCurrentProjectFile = async () => ({ success: true, path, revision: "opened", project: base });
		window.electronAPI.openProjectFileAtPath = async (requestedPath) => {
			document.documentElement.dataset.reloadedPath = requestedPath;
			return { success: true, path, revision: "updated", project: agent };
		};
		window.electronAPI.releaseCurrentProject = async () => {
			document.documentElement.dataset.releasedProject = path;
			return { success: true, path };
		};
		window.electronAPI.onProjectFileChanged = callback => {
			const receive = () => callback({ path, diskRevision: "updated" });
			window.addEventListener("test-external-change", receive);
			return () => window.removeEventListener("test-external-change", receive);
		};
		window.electronAPI.saveProjectFile = async () => {
			const root = document.documentElement;
			root.dataset.saveAttempts = String(Number(root.dataset.saveAttempts ?? 0) + 1);
			return { success: false, conflict: true, diskRevision: "updated" };
		};
		window.electronAPI.setHasUnsavedChanges = dirty => { document.documentElement.dataset.projectDirty = String(dirty); };
		window.electronAPI.saveProjectFileNamed = async (project, _name, _thumbnail, mode) => {
			const root = document.documentElement;
			root.dataset.savedCopyMode = mode;
			root.dataset.savedCopyHasCaption = String(JSON.stringify(project).includes("Keep my caption"));
			return { success: true, path: "/projects/Review copy.leadcut", projectId: "local-copy", revision: "copied" };
		};
	});
	await page.goto("/?windowType=editor");
	await expect(page.locator('[data-region-id="screen"]')).toHaveCount(1, { timeout: 20000 });
	await expect(page.getByLabel("Loading preview", { exact: true })).toHaveCount(0, { timeout: 20000 });
}

test("reloads a clean project after an external update without resetting the playhead", async ({ page }) => {
	await openProjectForExternalChange(page);
	const timecode = page.getByRole("textbox", { name: "Timeline timecode", exact: true });
	await timecode.fill("00:00:02.000");
	await timecode.press("Enter");
	await expect(timecode).toHaveValue("00:00:02.000");
	await expect(page.locator("html")).toHaveAttribute("data-project-dirty", "false");
	await page.evaluate(() => window.dispatchEvent(new Event("test-external-change")));
	await expect(page.getByText("Project updated from disk", { exact: true })).toBeVisible();
	await expect(page.locator('[data-region-id="agent-cut"]')).toHaveCount(1);
	await expect(timecode).toHaveValue("00:00:02.000");
	await expect(page.locator("html")).not.toHaveAttribute("data-save-attempts");
});

test("Home releases project ownership and reads the disk version when dismissed", async ({ page }) => {
	await openProjectForExternalChange(page);
	const html = page.locator("html");
	await expect(html).toHaveAttribute("data-project-dirty", "false");
	await page.getByRole("button", { name: "Home", exact: true }).click();
	const library = page.getByRole("dialog", { name: "Projects dashboard", exact: true });
	await expect(library).toBeVisible();
	await expect(html).toHaveAttribute("data-released-project", "/projects/Review.leadcut");
	await expect(page.locator('[data-variant="clip"]')).toHaveCount(0);
	await page.waitForTimeout(1000);
	await expect(html).not.toHaveAttribute("data-save-attempts");
	await page.keyboard.press("Escape");
	await expect(html).toHaveAttribute("data-reloaded-path", "/projects/Review.leadcut");
	await expect(library).toHaveCount(0);
	await expect(page.locator('[data-region-id="agent-cut"]')).toHaveCount(1);
});

for (const saveCopy of [false, true]) {
	test(`suspends overwrite after an external edit and ${saveCopy ? "saves a local copy first" : "loads the disk version"}`, async ({ page }) => {
		await openProjectForExternalChange(page);
		await page.getByRole("button", { name: "Add caption", exact: true }).click();
		const transcript = page.getByRole("region", { name: "Caption transcript", exact: true });
		await transcript.locator("[data-caption-text]").click();
		const text = transcript.getByRole("textbox", { name: "Edit caption text", exact: true });
		await text.fill("Keep my caption");
		await text.press("Escape");
		await page.evaluate(() => window.dispatchEvent(new Event("test-external-change")));
		const conflict = page.getByRole("dialog", { name: "Project changed on disk", exact: true });
		const useDisk = conflict.getByRole("button", { name: "Use version on disk", exact: true });
		const copy = conflict.getByRole("button", { name: "Save my version as a copy", exact: true });
		await expect(useDisk).toBeVisible();
		await expect(copy).toBeVisible();
		const html = page.locator("html");
		const attempts = await html.getAttribute("data-save-attempts");
		await page.waitForTimeout(750);
		expect(await html.getAttribute("data-save-attempts")).toBe(attempts);
		if (saveCopy) {
			await copy.click();
			await page.getByRole("dialog").getByRole("button", { name: "Save", exact: true }).click();
			await expect(html).toHaveAttribute("data-saved-copy-mode", "copy");
			await expect(html).toHaveAttribute("data-saved-copy-has-caption", "true");
		} else {
			await useDisk.click();
		}
		await expect(html).toHaveAttribute("data-reloaded-path", "/projects/Review.leadcut");
		await expect(page.locator('[data-region-id="agent-cut"]')).toHaveCount(1);
		await expect(page.locator('[data-variant="caption"]')).toHaveCount(0);
	});
}
