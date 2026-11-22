import path from "node:path";
import { expect, it } from "vitest";
import { isLibrarySequenceSource } from "./sequenceSource";

it("recognizes current and legacy imported assets and ignores unrelated directories", () => {
	const video = "ceefe97f-6af5-4e4b-9296-65471420975c.mp4";
	expect(isLibrarySequenceSource(path.join("import", ".leadcut-media", video))).toBe(true);
	expect(isLibrarySequenceSource(path.join("import", ".recordly-media", video))).toBe(true);
	expect(isLibrarySequenceSource(path.join("import", ".other-media", video))).toBe(false);
	expect(isLibrarySequenceSource(path.join("import", ".leadcut-media", "recording.mp4"))).toBe(false);
});
