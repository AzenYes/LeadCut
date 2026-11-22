import { describe, expect, it } from "vitest";
import { shouldGrantLocalFontsPermission } from "./permissionPolicy";
const bases = ["http://127.0.0.1:5178/", "file:///C:/app/dist/index.html"];
const request = {
	permission: "local-fonts",
	isMainFrame: true,
	currentDocumentUrl: bases[0] + "?windowType=editor",
	requestingUrl: bases[0] + "?windowType=editor",
};
describe("local font permissions", () => {
	it("allows only a trusted editor document, including packaged file fallback", () => {
		expect(shouldGrantLocalFontsPermission(request, bases)).toBe(true);
		const url = bases[1] + "?windowType=editor";
		expect(
			shouldGrantLocalFontsPermission(
				{ ...request, currentDocumentUrl: url, requestingUrl: url },
				bases,
			),
		).toBe(true);
		const devUrl = bases[0] + "?windowType=editor&devOpenInput=recording.mp4";
		expect(shouldGrantLocalFontsPermission({ ...request, currentDocumentUrl: devUrl, requestingUrl: devUrl }, bases)).toBe(true);
	});
	it.each([
		{ permission: "media" },
		{ isMainFrame: false },
		{ currentDocumentUrl: "http://evil.example/?windowType=editor" },
		{ currentDocumentUrl: bases[0] + "?windowType=hud-overlay" },
		{ requestingUrl: "https://evil.example/" },
		{ currentDocumentUrl: bases[0] + "?windowType=editor&windowType=hud-overlay" },
	])("rejects untrusted or unrelated requests %j", (overrides) => {
		expect(shouldGrantLocalFontsPermission({ ...request, ...overrides }, bases)).toBe(false);
	});
});
