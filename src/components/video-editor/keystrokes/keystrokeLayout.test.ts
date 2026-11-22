import { expect, it } from "vitest";
import { DEFAULT_KEYSTROKE_OVERLAY } from "../types";
import { getKeystrokeLayout, getVisibleKeystrokes } from "./keystrokeLayout";

it("uses the same relative anchor, padding and corner radius across frame sizes", () => {
	const style = { ...DEFAULT_KEYSTROKE_OVERLAY.style, x: 50, y: 75 };
	const full = getKeystrokeLayout(style, { width: 1920, height: 1080 }, 160);
	const half = getKeystrokeLayout(style, { width: 960, height: 540 }, 80);
	expect(full).toMatchObject({ fontSize: 36, radius: 16 });
	expect(full.height).toBeCloseTo(58.32);
	expect(full.x + full.width / 2).toBe(960);
	expect(full.y + full.height / 2).toBe(810);
	for (const key of Object.keys(full) as (keyof typeof full)[]) {
		expect(half[key]).toBeCloseTo(full[key] / 2);
	}
	const left = getKeystrokeLayout({ ...style, x: 0, y: 0 }, { width: 320, height: 180 }, 60);
	expect(left.x).toBeGreaterThan(0);
	expect(left.y).toBeGreaterThan(0);
});

it("keeps future characters out of the preview and fades at both ends", () => {
	const presentation = {
		style: { ...DEFAULT_KEYSTROKE_OVERLAY.style, fadeMs: 100, opacity: 0.8 },
		items: [{ id: "hint", label: "hi", startMs: 500, endMs: 1800,
			characterParts: [{ atMs: 500, text: "h" }, { atMs: 900, text: "i" }] }],
	};
	expect(getVisibleKeystrokes(presentation, 499)).toEqual([]);
	expect(getVisibleKeystrokes(presentation, 550)).toMatchObject([{ text: "h", opacity: 0.4 }]);
	expect(getVisibleKeystrokes(presentation, 1000)).toMatchObject([{ text: "hi", opacity: 0.8 }]);
	expect(getVisibleKeystrokes(presentation, 1750)).toMatchObject([{ opacity: 0.4 }]);
	expect(getVisibleKeystrokes(presentation, 1800)).toEqual([]);
});

it("stacks the two recent presses at different heights and caps the stack at three", () => {
	const style = DEFAULT_KEYSTROKE_OVERLAY.style;
	const items = Array.from({ length: 5 }, (_, index) => ({
		id: "key-" + index, label: "F" + (index + 1), startMs: index * 300, endMs: index * 300 + 1400,
	}));
	const frame = { width: 960, height: 540 };
	const visible = getVisibleKeystrokes({ style, items }, 450);
	expect(visible.map(item => item.text)).toEqual(["F1", "F2"]);
	const [older, newer] = visible.map((item, index) => getKeystrokeLayout(item.style, frame, 80, index, visible.length));
	expect(older.y + older.height).toBeLessThan(newer.y);
	expect(getVisibleKeystrokes({ style, items }, 1300).map(item => item.text)).toEqual(["F3", "F4", "F5"]);
});
