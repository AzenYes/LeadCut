import { expect, it } from "vitest";
import { hasKnownProjectExtension, hasLegacyProjectExtension, stripProjectExtension } from "./projectFileExtensions";

it("recognizes current and legacy formats regardless of extension case", () => {
	for (const path of ["a.leadcut", "a.RECORDLY", "a.openscreen", "C:\\Users\\Name\\工程.leadcut"]) {
		expect(hasKnownProjectExtension(path)).toBe(true);
	}
	for (const path of ["a.mp4", "a.leadcut.bak", ".leadcut", "a.leadcut/file"]) {
		expect(hasKnownProjectExtension(path)).toBe(false);
	}
	expect(hasLegacyProjectExtension("a.RECORDLY")).toBe(true);
	expect(hasLegacyProjectExtension("a.leadcut")).toBe(false);
});

it("strips a single known extension and preserves earlier dots", () => {
	expect(stripProjectExtension("v1.2 demo.recordly")).toBe("v1.2 demo");
	expect(stripProjectExtension("a.recordly.leadcut")).toBe("a.recordly");
	expect(stripProjectExtension("C:\\工程\\a.openscreen")).toBe("C:\\工程\\a");
	expect(stripProjectExtension("a.mp4")).toBe("a.mp4");
});
