import { expect, test } from "@playwright/test";
import { installDesktopBridge, installDesktopBridgeOverrides } from "./bridge";

test("canceling a startup relink loads the project dashboard", async ({ page }) => {
	await installDesktopBridge(page);
	await installDesktopBridgeOverrides(page, () => {
		window.electronAPI.loadCurrentProjectFile = async () => ({
			success: false, startupOpen: true, code: "media-missing", path: "/projects/missing.leadcut",
			revision: "missing", missing: [{ kind: "video", path: "/old/capture.mp4" }],
		});
		window.electronAPI.listProjectFiles = async () => ({
			success: true, projects: [], entries: [{
				path: "/projects/other.leadcut", name: "Other project", updatedAt: 1,
				thumbnailPath: null, isCurrent: false, isInProjectsDirectory: true,
			}],
		});
	});
	await page.goto("/?windowType=editor");
	const relink = page.getByRole("dialog", { name: "Missing project media" });
	await relink.getByRole("button", { name: "Cancel", exact: true }).click({ timeout: 20_000 });
	const dashboard = page.getByRole("dialog", { name: "Projects dashboard" });
	await expect(dashboard.getByRole("button", { name: "Other project", exact: true })).toBeVisible();
});

test("relinks a required recording and explicitly removes a missing optional camera", async ({ page }) => {
	test.setTimeout(90000);
	await installDesktopBridge(page, "filmstrip.mp4");
	await installDesktopBridgeOverrides(page, () => {
		const path = "/projects/relink-test.leadcut";
		const originalVideo = "/old/capture.mp4";
		const originalWebcam = "/old/camera.mp4";
		const replacement = `${location.origin}/tests/ui/fixtures/filmstrip.mp4`;
		const project = {
			version: 2,
			projectId: "relink-test",
			videoPath: originalVideo,
			editor: {
				webcam: { sourcePath: originalWebcam, enabled: true },
				clipRegions: [{ id: "relinked-clip", startMs: 0, endMs: 5000, sourceStartMs: 0, speed: 1 }],
			},
		};
		window.electronAPI.loadCurrentProjectFile = async () => ({
			success: false,
			code: "media-missing",
			path,
			project,
			revision: "before",
			missing: [
				{ kind: "video", path: originalVideo },
				{ kind: "webcam", path: originalWebcam },
			],
		});
		window.electronAPI.pickRelinkMedia = async () => ({ success: true, path: replacement });
		window.electronAPI.relinkProjectMedia = async (savedPath, revision, mapping) => {
			if (savedPath !== path || revision !== "before" || mapping[originalVideo] !== replacement || mapping[originalWebcam] !== null) {
				return { success: false, message: "Unexpected relink request" };
			}
			sessionStorage.setItem("relink-request", JSON.stringify(mapping));
			return {
				success: true,
				path,
				revision: "after",
				project: {
					...project, videoPath: replacement,
					editor: { ...project.editor, webcam: { enabled: false, sourcePath: null } },
				},
			};
		};
	});

	await page.goto("/?windowType=editor");
	const dialog = page.getByRole("dialog", { name: "Missing project media" });
	await expect(dialog).toBeVisible({ timeout: 50000 });
	const entries = dialog.getByTestId("missing-media-item");
	await expect(entries).toHaveCount(2);
	await expect(entries.first()).toContainText("/old/capture.mp4");
	await expect(entries.last()).toContainText("/old/camera.mp4");
	const confirm = dialog.getByRole("button", { name: "Relink and open" });
	await expect(confirm).toBeDisabled();
	await entries.first().getByRole("button", { name: "Choose file" }).click();
	await expect(confirm).toBeEnabled();
	await entries.last().getByRole("button", { name: "Skip" }).click();
	await confirm.click();
	await expect(dialog).toHaveCount(0);
	await expect(page.locator('[data-region-id="relinked-clip"]')).toBeVisible();
	await expect(page.getByText("Removed 1 missing media items.")).toBeVisible();
});
