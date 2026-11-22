import { expect, it } from "vitest";
import type { RecordedKeyEvent } from "../../../../services/leadcut-mcp/src/keystrokeSidecar";
import { buildKeystrokeItems, getKeystrokePresses, normalizeKeystrokeOverlay } from "./keystrokeModel";

const down = (key: string, keycode: number, timeMs: number, overrides: Partial<RecordedKeyEvent> = {}): RecordedKeyEvent => ({
	key, keycode, timeMs, type: "down", ctrl: false, shift: false, alt: false, meta: false, ...overrides,
});

it.each([
	['"IBM Plex Sans SC"', "IBM Plex Sans SC"],
	["Arial, sans-serif", "Arial"],
	['"Example, Local Font"', '"Example, Local Font"'],
])("normalizes the saved font %s", (input, expected) => {
	const settings = normalizeKeystrokeOverlay({ style: { fontFamily: input } });
	expect(settings.style.fontFamily).toBe(expected);
	expect(normalizeKeystrokeOverlay(settings).style.fontFamily).toBe(expected);
});

it("combines modifier and main key, ignoring repeated downs before releasing", () => {
	const frames = buildKeystrokeItems([
		down("S", 31, 100, { ctrl: true }), down("S", 31, 450, { ctrl: true }),
		down("S", 31, 600, { type: "up" }), down("S", 31, 900, { ctrl: true, shift: true }),
	]);
	expect(frames.map(({ label, id }) => [label, id])).toEqual([["Ctrl + S", "100:S"], ["Ctrl + Shift + S", "900:S"]]);
});

it("only treats consecutive downs within 1100 ms as repeats", () => {
	expect(buildKeystrokeItems([down("A", 30, 100), down("A", 30, 400)])).toHaveLength(1);
	expect(buildKeystrokeItems([down("A", 30, 100), down("A", 30, 1600)])).toHaveLength(2);
});

it("filters displayed shortcuts and counts unknown keys without rendering them", () => {
	const events = [down("A", 30, 100), down("S", 31, 600, { ctrl: true }), down("Unknown:512", 512, 900)];
	expect(getKeystrokePresses(events)).toHaveLength(3);
	expect(buildKeystrokeItems(events).map(item => item.label)).toEqual(["a", "Ctrl + S"]);
	expect(buildKeystrokeItems(events, { filter: "shortcuts" }).map(item => item.label)).toEqual(["Ctrl + S"]);
});

it("merges typed keys at most 800 ms apart and preserves each key's display time", () => {
	const items = buildKeystrokeItems([down("H", 35, 100, { shift: true }), down("I", 23, 900), down("A", 30, 1701)]);
	expect(items.map(item => item.label)).toEqual(["Hi", "a"]);
	expect(items[0]).toMatchObject({ startMs: 100, endMs: 2300, characterParts: [{ atMs: 100, text: "H" }, { atMs: 900, text: "i" }] });
});

it("drops keys in removed source time and maps a twice-speed clip's start and visibility", () => {
	const clips = [{ id: "next", startMs: 3000, endMs: 5000, sourceStartMs: 6000, speed: 2 }];
	const events = [down("F1", 59, 5900), down("F2", 60, 8000), down("F3", 61, 10000)];
	expect(buildKeystrokeItems(events, { clips })).toEqual([
		{ id: "8000:F2", startMs: 4000, endMs: 5000, label: "F2", characterParts: undefined },
	]);
	expect(buildKeystrokeItems(events, { clips, hiddenIds: ["8000:F2"] })).toEqual([]);
});
