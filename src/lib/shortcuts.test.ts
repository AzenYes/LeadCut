import { expect, it } from "vitest";
import { DEFAULT_SHORTCUTS, findConflict, formatBinding, matchesShortcut, mergeWithDefaults } from "./shortcuts";

it("finds conflicting configurable and fixed bindings", () => {
	expect(findConflict({ key: "F2" }, "addZoom", DEFAULT_SHORTCUTS))
		.toEqual({ type: "configurable", action: "splitClip" });
	expect(findConflict({ key: "delete" }, "addZoom", DEFAULT_SHORTCUTS)).toMatchObject({ type: "fixed" });
});

it("never matches an unbound action and renders it as an em dash", () => {
	const unbound = { key: "" };
	expect(matchesShortcut({ key: "" } as KeyboardEvent, unbound, false)).toBe(false);
	expect(formatBinding(unbound, false)).toBe("—");
	expect(findConflict(unbound, "addZoom", { ...DEFAULT_SHORTCUTS, splitClip: unbound })).toBeNull();
});

it("preserves old custom bindings that conflict with newly configurable defaults", () => {
	const migrated = mergeWithDefaults({ addZoom: { key: "l" }, addKeyframe: { key: "f3" }, addAnnotation: { key: "tab" } });
	expect(migrated.addZoom).toEqual({ key: "l" });
	expect(migrated.addKeyframe).toEqual({ key: "f3" });
	expect(migrated.shuttleForward).toEqual({ key: "" });
	expect(migrated.rippleDelete).toEqual({ key: "" });
	expect(migrated.addAnnotation).toEqual(DEFAULT_SHORTCUTS.addAnnotation);
});
