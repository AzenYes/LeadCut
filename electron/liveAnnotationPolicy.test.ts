import { describe, expect, it } from "vitest";
import { protectsLiveAnnotationWindow, supportsLiveAnnotation } from "./liveAnnotationPolicy";

describe("live annotation capture policy", () => {
	it("captures the annotation canvas and keeps the toolbar out of the recording", () => {
		expect(protectsLiveAnnotationWindow("canvas")).toBe(false);
		expect(protectsLiveAnnotationWindow("toolbar")).toBe(true);
	});
	it("allows only full-screen Windows recording", () => {
		expect(supportsLiveAnnotation("win32", "screen:1:0")).toBe(true);
		expect(supportsLiveAnnotation("win32", "window:1:0")).toBe(false);
		expect(supportsLiveAnnotation("darwin", "screen:1:0")).toBe(false);
	});
});
