import { afterEach, expect, it, vi } from "vitest";
import { isEditorShortcutBlocked } from "./editorShortcutScope";

afterEach(() => vi.unstubAllGlobals());
const overlay = (modal: string | null = null, visible = true) => ({
	hidden: false,
	getAttribute: (name: string) => name === "aria-modal" ? modal : null,
	getClientRects: () => visible ? [{}] : [],
});

it("blocks background shortcuts even while modal focus temporarily rests on the body", () => {
	vi.stubGlobal("document", { querySelectorAll: () => [overlay("true")] });
	expect(isEditorShortcutBlocked(null)).toBe(true);
});
it("does not disable the editor for a nonmodal toast or a hidden dialog", () => {
	vi.stubGlobal("document", { querySelectorAll: () => [overlay("false"), overlay("true", false)] });
	expect(isEditorShortcutBlocked(null)).toBe(false);
});
it("leaves shortcuts inside a dialog, menu or library to that surface", () => {
	expect(isEditorShortcutBlocked({ closest: () => ({}) } as unknown as EventTarget)).toBe(true);
});
it("does not treat the nonmodal recording library as a global overlay", () => {
	const query = vi.fn(() => []);
	vi.stubGlobal("document", { querySelectorAll: query });
	expect(isEditorShortcutBlocked(null)).toBe(false);
	expect(query.mock.calls[0][0]).not.toContain("data-recording-library");
});
