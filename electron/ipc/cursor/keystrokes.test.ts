import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { DEFAULT_RECORDING_SHORTCUTS } from "../../../src/lib/recordingShortcuts";

const state = vi.hoisted(() => ({
	dir: "", active: true, paused: false, now: 150, setting: vi.fn(),
}));
vi.mock("../../appPaths", () => ({ get USER_DATA_PATH() { return state.dir; } }));
vi.mock("../../appSettingsStore", () => ({ readAppSetting: state.setting }));
vi.mock("../../recordingShortcuts", () => ({ getRecordingShortcuts: () => ({ config: DEFAULT_RECORDING_SHORTCUTS }) }));
vi.mock("../state", () => ({ get isCursorCaptureActive() { return state.active; } }));
vi.mock("./telemetry", () => ({ getCursorCaptureElapsedMs: () => state.now, isCursorCapturePaused: () => state.paused }));

import {
	discardKeystrokes, persistKeystrokes, readKeystrokes, recordKeyEvent, resolveKeyName,
	setKeystrokeCapturePaused, setKeystrokeKeyNames, shouldRecordKey, startKeystrokeCapture, trimKeystrokesAfter,
} from "./keystrokes";

const letter = { keycode: 30, ctrlKey: false, altKey: false, metaKey: false, shiftKey: false };
const save = async () => {
	const video = path.join(state.dir, "media.mp4");
	await persistKeystrokes(video);
	return (await readKeystrokes(video)).events;
};

beforeEach(async () => {
	state.dir = await fs.mkdtemp(path.join(os.tmpdir(), "leadcut-key-test-"));
	state.active = true;
	state.paused = false;
	state.now = 150;
	state.setting.mockReturnValue(undefined);
	setKeystrokeKeyNames({ A: 30, S: 31, F2: 60, Enter: 28, Ctrl: 29, K: 37, Shift: 42 });
});

afterEach(async () => {
	await discardKeystrokes();
	vi.unstubAllEnvs();
	await fs.rm(state.dir, { recursive: true, force: true });
});

it("resolves native physical keycodes for letters, function keys and Enter", () => {
	expect([30, 60, 28, 0x0E45, -1].map(resolveKeyName)).toEqual(["A", "F2", "Enter", "Pause", "Unknown:-1"]);
});

it("trusts cleared hook flags after a lost modifier keyup", async () => {
	state.setting.mockReturnValue("all");
	startKeystrokeCapture(1, "win32");
	recordKeyEvent("down", { ...letter, keycode: 29, ctrlKey: true });
	recordKeyEvent("down", { ...letter, keycode: 31, ctrlKey: true });
	recordKeyEvent("up", { ...letter, keycode: 31, ctrlKey: true });
	recordKeyEvent("down", letter);
	recordKeyEvent("up", letter);
	expect((await save()).filter(event => event.key === "A")).toMatchObject([
		{ type: "down", ctrl: false }, { type: "up", ctrl: false },
	]);
});

it("records unknown keycodes in all-keys mode", async () => {
	state.setting.mockReturnValue("all");
	startKeystrokeCapture(1, "win32");
	recordKeyEvent("down", { ...letter, keycode: 31337 });
	recordKeyEvent("up", { ...letter, keycode: 31337 });
	expect(await save()).toMatchObject([{ key: "Unknown:31337" }, { key: "Unknown:31337" }]);
});

it("keeps Ctrl+S, its release, and F2, while discarding letters and LeadCut's own shortcut", async () => {
	state.setting.mockReturnValue("shortcuts");
	startKeystrokeCapture(1, "win32");
	recordKeyEvent("down", letter);
	recordKeyEvent("up", { ...letter, ctrlKey: true });
	recordKeyEvent("down", { ...letter, keycode: 29 });
	recordKeyEvent("down", { ...letter, keycode: 31, ctrlKey: true });
	recordKeyEvent("up", { ...letter, keycode: 29 });
	recordKeyEvent("up", { ...letter, keycode: 31 });
	recordKeyEvent("down", { ...letter, keycode: 60 });
	recordKeyEvent("down", { ...letter, keycode: 37, ctrlKey: true, altKey: true });
	expect(await save()).toEqual([
		{ key: "S", keycode: 31, alt: false, ctrl: true, shift: false, meta: false, timeMs: 150, type: "down" },
		{ key: "S", keycode: 31, alt: false, ctrl: false, shift: false, meta: false, timeMs: 150, type: "up" },
		{ key: "F2", keycode: 60, alt: false, ctrl: false, shift: false, meta: false, timeMs: 150, type: "down" },
		{ key: "F2", keycode: 60, alt: false, ctrl: false, shift: false, meta: false, timeMs: 150, type: "up" },
	]);
});

it("records ordinary character keys only in all mode, with no data in off mode or on Linux", async () => {
	expect(shouldRecordKey(letter, "shortcuts")).toBe(false);
	expect(shouldRecordKey(letter, "all")).toBe(true);
	expect(shouldRecordKey(letter, "off")).toBe(false);
	state.setting.mockReturnValue("off");
	expect(startKeystrokeCapture(1, "win32")).toBeUndefined();
	state.setting.mockReturnValue("all");
	expect(startKeystrokeCapture(1, "linux")).toBeUndefined();
	startKeystrokeCapture(1, "win32");
	recordKeyEvent("down", letter);
	expect(await save()).toMatchObject([{ key: "A", type: "down" }, { key: "A", type: "up" }]);
});

it.each(["all", "shortcuts"] as const)("records a standalone modifier only in all mode (mode %s)", async mode => {
	state.setting.mockReturnValue(mode);
	startKeystrokeCapture(1, "win32");
	recordKeyEvent("down", { ...letter, keycode: 42, shiftKey: true });
	state.now = 180;
	recordKeyEvent("up", { ...letter, keycode: 42 });
	const events = await save();
	if (mode === "all") expect(events).toMatchObject([
		{ key: "Shift", shift: false, type: "down", timeMs: 150 },
		{ key: "Shift", shift: false, type: "up", timeMs: 180 },
	]);
	else expect(events).toEqual([]);
});

it("closes a held key at stop and records the configured mode alongside it", async () => {
	startKeystrokeCapture(1, "win32");
	recordKeyEvent("down", letter);
	state.now = 600;
	const video = path.join(state.dir, "keystrokes.mp4");
	await persistKeystrokes(video);
	const sidecar = await readKeystrokes(video);
	expect(sidecar).toMatchObject({
		mode: "all",
		events: [{ type: "down", timeMs: 150 }, { type: "up", timeMs: 600 }],
	});
	const oldPath = path.join(state.dir, "old.mp4");
	await fs.writeFile(oldPath + ".leadcut-keys.json", JSON.stringify({ version: 1, events: sidecar.events }));
	await expect(readKeystrokes(oldPath)).resolves.toEqual({ events: sidecar.events });
});

it("does not include paused input in the raw diagnostics", async () => {
	vi.stubEnv("LEADCUT_KEY_DEBUG", "1");
	startKeystrokeCapture(1, "win32");
	recordKeyEvent("down", letter);
	setKeystrokeCapturePaused(true);
	recordKeyEvent("down", { ...letter, keycode: 31 });
	setKeystrokeCapturePaused(false);
	await save();
	const entries = (await fs.readFile(path.join(state.dir, "leadcut-key-debug.jsonl"), "utf8")).trim().split("\n");
	expect(entries.map(entry => JSON.parse(entry).key)).toEqual(["A"]);
});

it("skips keys while recording is paused, disabling keys, or after the native pause boundary", async () => {
	state.setting.mockReturnValue("all");
	startKeystrokeCapture(1, "win32");
	recordKeyEvent("down", letter);
	state.now = 200;
	recordKeyEvent("down", letter);
	trimKeystrokesAfter(150);
	state.paused = true;
	recordKeyEvent("down", letter);
	state.paused = false;
	setKeystrokeCapturePaused(true);
	recordKeyEvent("down", letter);
	setKeystrokeCapturePaused(false);
	state.active = false;
	recordKeyEvent("down", letter);
	expect(await save()).toMatchObject([{ timeMs: 150, type: "down" }, { timeMs: 150, type: "up" }]);
});
