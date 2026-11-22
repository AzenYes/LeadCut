import { expect, test } from "@playwright/test";
import { installDesktopBridge, installDesktopBridgeOverrides } from "./bridge";

test("settings replays a local tutorial without authentication", async ({page}) => {
	await installDesktopBridge(page);
	await page.goto("/?windowType=editor");
	await expect(page.getByRole("button",{name:"Home",exact:true})).toBeVisible();
	await page.getByRole("radio",{name:"Settings",exact:true}).click();
	await page.getByRole("button",{name:"Show onboarding",exact:true}).click();
	const tutorial=page.getByRole("dialog",{name:"Welcome to LeadCut",exact:true});
	await expect(tutorial).toBeVisible();
	await expect(tutorial.getByRole("listitem")).toHaveCount(3);
	await expect(tutorial.getByRole("textbox")).toHaveCount(0);
	await expect(tutorial.getByRole("button",{name:/Google|Microsoft|GitHub|Sign in|magic link/})).toHaveCount(0);
	await page.screenshot({path:"test-results/local-onboarding.png",animations:"disabled"});
	await tutorial.getByRole("button",{name:"Get started",exact:true}).click();
	await expect(tutorial).toHaveCount(0);
});

test("first-run local tutorial saves dismissal and does not require an account", async ({page}) => {
	await installDesktopBridge(page);
	await installDesktopBridgeOverrides(page, () => {
		window.electronAPI.getAppSetting = key => key === "leadcut.onboarding.v1.seen" ? JSON.parse(localStorage.getItem("local-tour-seen") ?? "false") : null;
		window.electronAPI.setAppSetting = (key,value) => {if(key === "leadcut.onboarding.v1.seen")localStorage.setItem("local-tour-seen",JSON.stringify(value));return true;};
	});
	await page.goto("/?windowType=editor");
	const tutorial=page.getByRole("dialog",{name:"Welcome to LeadCut",exact:true});
	await expect(tutorial).toBeVisible({timeout:20000});
	await tutorial.getByRole("button",{name:"Get started",exact:true}).click();
	await expect(tutorial).toHaveCount(0);
	await page.reload();
	await expect(page.locator(".boot-shell")).toHaveCount(0, { timeout: 20000 });
	await expect(page.getByRole("button",{name:"Home",exact:true})).toBeVisible();
	await expect(tutorial).toHaveCount(0);
});
