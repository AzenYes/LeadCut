import { expect, test } from "@playwright/test";
import { installDesktopBridge, installDesktopBridgeOverrides } from "./bridge";

test("settings replays the four-step editor guide at its controls", async ({page}) => {
	await installDesktopBridge(page);
	await page.goto("/?windowType=editor");
	await expect(page.getByRole("button",{name:"Home",exact:true})).toBeVisible({ timeout: 20_000 });
	await page.getByRole("button",{name:"Application settings",exact:true}).click();
	await page.getByRole("button",{name:"Show onboarding",exact:true}).click();
	const tutorial=page.getByRole("dialog",{name:"Welcome to LeadCut",exact:true});
	await expect(tutorial).toBeVisible();
	const step = async (target: string, position: number) => {
		await expect(tutorial).toContainText(`${position} of 4`);
		await expect(tutorial.locator(`[data-onboarding-step="${target}"]`)).toBeVisible();
		await expect(page.locator(`[data-onboarding-target="${target}"]`)).toHaveAttribute("data-onboarding-active", "");
	};
	await step("split", 1);
	await expect(tutorial.getByRole("textbox")).toHaveCount(0);
	await expect(tutorial.getByRole("button",{name:/Google|Microsoft|GitHub|Sign in|magic link/})).toHaveCount(0);
	const next = tutorial.getByRole("button", { name: "Next", exact: true });
	await next.press("Enter");
	await step("zoom", 2);
	await next.click();
	await step("captions", 3);
	await tutorial.getByRole("button", { name: "Back", exact: true }).click();
	await step("zoom", 2);
	await next.click();
	await next.click();
	await step("export", 4);
	await tutorial.getByRole("button", { name: "Done", exact: true }).click();
	await expect(tutorial).toHaveCount(0);
	await expect(page.locator("[data-onboarding-active]")).toHaveCount(0);
});

test("a first-run editor guide saves dismissal and does not require an account", async ({page}) => {
	await installDesktopBridge(page);
	await installDesktopBridgeOverrides(page, () => {
		window.electronAPI.getAppSetting = key => key === "leadcut.onboarding.v1.seen" ? JSON.parse(localStorage.getItem("local-tour-seen") ?? "false") : null;
		window.electronAPI.setAppSetting = (key,value) => {if(key === "leadcut.onboarding.v1.seen")localStorage.setItem("local-tour-seen",JSON.stringify(value));return true;};
		const getVideo = window.electronAPI.getCurrentVideoPath;
		window.electronAPI.getCurrentVideoPath = () => sessionStorage.getItem("guide-media-available")
			? getVideo() : Promise.resolve({ success: false });
	});
	await page.goto("/?windowType=editor");
	const tutorial=page.getByRole("dialog",{name:"Welcome to LeadCut",exact:true});
	await expect(tutorial).toBeVisible({timeout:20000});
	await tutorial.getByRole("button", { name: "Get started", exact: true }).click();
	await expect(tutorial).toHaveCount(0);
	await page.evaluate(() => sessionStorage.setItem("guide-media-available", "1"));
	await page.reload();
	await expect(tutorial).toBeVisible({ timeout: 20_000 });
	await tutorial.getByRole("button", { name: "Skip guide", exact: true }).click();
	await expect(tutorial).toHaveCount(0);
	await page.reload();
	await expect(page.locator(".boot-shell")).toHaveCount(0, { timeout: 20000 });
	await expect(page.getByRole("button",{name:"Home",exact:true})).toBeVisible();
	await expect(tutorial).toHaveCount(0);
});
