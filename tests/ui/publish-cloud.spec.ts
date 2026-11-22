import { expect, test } from "@playwright/test";
import { installDesktopBridge, installDesktopBridgeOverrides } from "./bridge";

test("local app has no login, Shared, cloud export or remote startup requests", async ({ page }) => {
	const remoteRequests: string[] = [];
	await page.route(/^https?:\/\/(?!127\.0\.0\.1[:/]|localhost[:/])/, route => {
		remoteRequests.push(route.request().url());
		return route.abort();
	});
	await installDesktopBridge(page, "waveform.mp4");
	await installDesktopBridgeOverrides(page, () => {
		const calls: string[] = [];
		Object.assign(window, { cloudTestCalls: calls });
		Object.assign(window.electronAPI, {
			getAnnouncements: async () => { calls.push("announcements"); return null; },
			getPendingAuthCallbackUrl: async () => { calls.push("auth"); return null; },
			onCloudShareProgress: () => { calls.push("cloud"); return () => undefined; },
		});
		// Old preferences must not resurrect sharing or constrain local output to 1080p.
		localStorage.setItem("leadcut.editor.preferences", JSON.stringify({publishDestination:"link",mp4FrameRate:60,exportEncodingMode:"quality"}));
	});
	await page.goto("/?windowType=editor");
	await expect(page.locator('[data-variant="clip"]')).toHaveCount(1, {timeout:20000});
	await expect(page.getByRole("button", {name:"Recordly account"})).toHaveCount(0);
	await page.getByRole("button", {name:"Export video",exact:true}).click();
	const exportMenu = page.getByRole("dialog", {name:"Export video",exact:true});
	await expect(exportMenu.getByRole("row", {name:"Share link",exact:true})).toHaveCount(0);
	await expect(exportMenu.getByRole("button", {name:"Export MP4",exact:true})).toBeVisible();
	await exportMenu.getByRole("row", {name:"GIF",exact:true}).click();
	await expect(exportMenu.getByRole("button", {name:"Export GIF",exact:true})).toBeVisible();
	await exportMenu.press("Escape");
	await page.getByRole("button", {name:"Home",exact:true}).click();
	const dashboard = page.getByRole("dialog", {name:"Projects dashboard"});
	await expect(dashboard).toBeVisible();
	await expect(dashboard.getByRole("button", {name:"Shared",exact:true})).toHaveCount(0);
	await expect(dashboard.getByRole("button", {name:/Sign in|Log in|登录/})).toHaveCount(0);
	await expect(dashboard.getByRole("button", {name:"Record new",exact:true})).toBeVisible();
	await expect(dashboard.getByRole("button", {name:"Import",exact:true})).toBeVisible();
	expect(await page.evaluate(() => (window as unknown as {cloudTestCalls:string[]}).cloudTestCalls)).toEqual([]);
	expect(remoteRequests).toEqual([]);
	await page.screenshot({path:"test-results/local-dashboard.png",animations:"disabled"});
});
