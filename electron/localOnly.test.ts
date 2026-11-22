import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

describe("local application boundary", () => {
	it("excludes the retired cloud services and sharing contract", () => {
		for (const retired of [
			"services/recordly-share",
			"services/supabase",
			"electron/ipc/cloudShareContract.ts",
		]) {
			expect(fs.existsSync(path.resolve(retired)), retired).toBe(false);
		}
	});
	it("does not expose cloud upload, authentication or remote announcements through preload or IPC", () => {
		const preload=fs.readFileSync(path.resolve("electron/preload.ts"),"utf8");
		const handlers=fs.readFileSync(path.resolve("electron/ipc/handlers.ts"),"utf8");
		const main=fs.readFileSync(path.resolve("electron/main.ts"),"utf8");
		expect(preload).not.toMatch(/cloud-share-|cloudShare|onCloudShare|auth:|getAnnouncements/);
		expect(handlers).not.toMatch(/registerCloudShareHandlers|registerAnnouncementHandlers/);
		expect(main).not.toContain("authCallbacks");
	});
	it("has no authentication SDK dependency", () => {
		const pkg=JSON.parse(fs.readFileSync(path.resolve("package.json"),"utf8"));
		expect(pkg.dependencies).not.toHaveProperty("@supabase/supabase-js");
	});
});
