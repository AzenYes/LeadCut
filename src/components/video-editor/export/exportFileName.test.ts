import { expect, it } from "vitest";
import { stripProjectExtension } from "@/lib/projectFileExtensions";
import { suggestedExportFileName } from "./exportFileName";

it("strips forbidden file characters and falls back only when no name remains", () => {
	expect(suggestedExportFileName("  我的:视频?  ", "mp4")).toBe("我的视频.mp4");
	expect(suggestedExportFileName('\\/:*?"<>|', "gif")).toBe("export.gif");
});

it("keeps internal dots in legacy and current projects", () => {
	const name = stripProjectExtension("v1.2 demo.recordly");
	expect(name).toBe("v1.2 demo");
	expect(suggestedExportFileName(stripProjectExtension("v1.2 demo.leadcut"), "mp4")).toBe("v1.2 demo.mp4");
});
