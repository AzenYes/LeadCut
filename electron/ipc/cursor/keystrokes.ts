import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import {
	DEFAULT_KEYSTROKE_CAPTURE_MODE, getKeysPathForVideo, isKeystrokeCaptureMode, isRecordedKeyEvent, isRecordedShortcut, parseKeystrokeSidecar,
	type KeystrokeCaptureMode, type RecordedKeyEvent,
} from "../../../services/leadcut-mcp/src/keystrokeSidecar";
import { KEYSTROKE_CAPTURE_MODE_SETTING_KEY } from "../../../src/lib/storageKeys";
import { USER_DATA_PATH } from "../../appPaths";
import { readAppSetting } from "../../appSettingsStore";
import { getRecordingShortcuts } from "../../recordingShortcuts";
import { isCursorCaptureActive } from "../state";
import type { HookKeyEvent } from "../types";
import { getCursorCaptureElapsedMs, isCursorCapturePaused } from "./telemetry";
import { readTimedJournal, startTimedJournal } from "./telemetryJournal";

const names = new Map<number, string>();
// Virtual codes defined by libuiohook but absent from the JavaScript key map.
const additionalNames = new Map<number, string>([
	[0x0E45, "Pause"], [0x0E5D, "ContextMenu"],
	[0xE022, "MediaPlayPause"], [0xE024, "MediaStop"],
	[0xE010, "MediaPrevious"], [0xE019, "MediaNext"],
	[0xE06D, "MediaSelect"], [0xE02C, "MediaEject"],
	[0xE020, "VolumeMute"], [0xE030, "VolumeUp"], [0xE02E, "VolumeDown"],
]);
const modifier = /^(Ctrl|Alt|Shift|Meta)(Right)?$/;
const physicalPunctuation = new Map(Object.entries({
	Space: " ", Semicolon: ";", Equal: "=", Comma: ",", Minus: "-", Period: ".", Slash: "/",
	Backquote: "`", BracketLeft: "[", Backslash: "\\", BracketRight: "]", Quote: "'",
}));
const shifted = new Map(Array.from("1234567890;=,-./`[\\]'", (key, index) => [key, "!@#$%^&*():+<_>?~{|}\""[index]]));

type Capture = {
	mode: KeystrokeCaptureMode;
	paused: boolean;
	events: RecordedKeyEvent[];
	pressed: Map<number, RecordedKeyEvent>;
	modifierTap: RecordedKeyEvent | null;
	journal: ReturnType<typeof startTimedJournal<RecordedKeyEvent>>;
};
let capture: Capture | null = null;
let debugWrites = Promise.resolve();

function appendKeyDebug(entry: object) {
	if (process.env.LEADCUT_KEY_DEBUG !== "1") return;
	const file = path.join(USER_DATA_PATH, "leadcut-key-debug.jsonl");
	const line = JSON.stringify(entry) + "\n";
	debugWrites = debugWrites.then(() => fs.appendFile(file, line, {
		encoding: "utf8",
		mode: 0o600,
	})).catch(error => console.warn("Could not write key capture diagnostics:", error));
}

export function setKeystrokeKeyNames(keycodes: Record<string, number>) {
	names.clear();
	for (const [name, code] of Object.entries(keycodes)) {
		if (!names.has(code)) names.set(code, name);
	}
}

export function resolveKeyName(keycode: number) {
	return names.get(keycode) ?? additionalNames.get(keycode) ?? `Unknown:${keycode}`;
}

const withoutNumpadPrefix = (key: string) => key.replace(/^Numpad(?=\D)/, "");

export function shouldRecordKey(event: HookKeyEvent, mode: KeystrokeCaptureMode) {
	const name = resolveKeyName(event.keycode);
	if (mode === "off" || modifier.test(name)) return false;
	return mode === "all" || isRecordedShortcut(name, { ctrl: event.ctrlKey, alt: event.altKey, meta: event.metaKey });
}

function isLeadCutShortcut(key: string, event: HookKeyEvent) {
	if (event.metaKey) return false;
	const base = physicalPunctuation.get(key) ?? withoutNumpadPrefix(key).toLowerCase();
	const shiftedBase = event.shiftKey ? shifted.get(base) : undefined;
	return Object.values(getRecordingShortcuts().config).some(binding =>
		(binding.key === base || binding.key === shiftedBase) && !!binding.ctrl === event.ctrlKey &&
		!!binding.alt === event.altKey && !!binding.shift === event.shiftKey);
}

export function startKeystrokeCapture(startedAt: number, platform: NodeJS.Platform = process.platform) {
	const previous = capture;
	capture = null;
	if (previous) void previous.journal.stop({ keepFile: true });
	if (platform !== "win32") return undefined;
	const setting = readAppSetting(KEYSTROKE_CAPTURE_MODE_SETTING_KEY);
	const mode = isKeystrokeCaptureMode(setting) ? setting : DEFAULT_KEYSTROKE_CAPTURE_MODE;
	if (mode === "off") return undefined;
	const events: RecordedKeyEvent[] = [];
	const journal = startTimedJournal(path.join(USER_DATA_PATH, `leadcut-keys-journal-${startedAt}.jsonl`),
		() => events, getCursorCaptureElapsedMs);
	capture = { mode, paused: false, events, pressed: new Map(), modifierTap: null, journal };
	return { journalPath: journal.journalPath, mode };
}

export function setKeystrokeCapturePaused(paused: boolean) {
	if (!capture) return false;
	if (paused && !capture.paused) releaseKeys(capture, getCursorCaptureElapsedMs());
	capture.paused = paused;
	return true;
}

export function toggleKeystrokeCapture() {
	if (!isCursorCaptureActive || !capture) return null;
	setKeystrokeCapturePaused(!capture.paused);
	return capture.paused;
}

export function trimKeystrokesAfter(timeMs: number) {
	if (!capture) return;
	const start = capture.events.findIndex(event => event.timeMs > timeMs);
	if (start >= 0) {
		capture.events.splice(start);
		capture.pressed.clear();
		for (const event of capture.events) {
			if (event.type === "down") capture.pressed.set(event.keycode, event);
			else capture.pressed.delete(event.keycode);
		}
	}
	releaseKeys(capture, timeMs);
}

function releaseKeys(current: Capture, timeMs: number) {
	const at = Math.max(timeMs, current.events[current.events.length - 1]?.timeMs ?? 0);
	const tap = current.modifierTap;
	if (tap && tap.timeMs <= at) current.events.push(tap, { ...tap, type: "up", timeMs: at });
	for (const pressed of current.pressed.values()) current.events.push({ ...pressed, type: "up", timeMs: at });
	current.pressed.clear();
	current.modifierTap = null;
}

export function releaseHeldKeystrokes() {
	if (capture) releaseKeys(capture, getCursorCaptureElapsedMs());
}

function recordModifierTap(current: Capture, item: RecordedKeyEvent) {
	if (current.mode !== "all") return;
	const pending = current.modifierTap;
	if (item.type === "up") {
		if (pending?.keycode !== item.keycode) return;
		current.events.push(pending, { ...pending, type: "up", timeMs: item.timeMs });
		current.modifierTap = null;
		return;
	}
	if (pending?.keycode === item.keycode) return;
	const hasOtherModifiers =
		(item.ctrl && !item.key.startsWith("Ctrl")) || (item.alt && !item.key.startsWith("Alt")) ||
		(item.shift && !item.key.startsWith("Shift")) || (item.meta && !item.key.startsWith("Meta"));
	current.modifierTap = pending || hasOtherModifiers
		? null : { ...item, ctrl: false, alt: false, shift: false, meta: false };
}

export function recordKeyEvent(type: RecordedKeyEvent["type"], event: HookKeyEvent) {
	if (!capture || !isCursorCaptureActive || capture.paused || isCursorCapturePaused()) return;
	const key = resolveKeyName(event.keycode);
	const timeMs = getCursorCaptureElapsedMs();
	if (process.env.LEADCUT_KEY_DEBUG === "1") appendKeyDebug({
		type, ...event, key, timeMs, modifierTap: capture.modifierTap?.key ?? null,
	});
	const recorded: RecordedKeyEvent = { timeMs, type, keycode: event.keycode, key,
		ctrl: event.ctrlKey, alt: event.altKey, shift: event.shiftKey, meta: event.metaKey };
	if (modifier.test(key)) {
		recordModifierTap(capture, recorded);
		return;
	}
	if (type === "down") {
		capture.modifierTap = null;
		if (isLeadCutShortcut(key, event) || !shouldRecordKey(event, capture.mode)) return;
		capture.pressed.set(event.keycode, recorded);
	} else if (!capture.pressed.delete(event.keycode)) {
		return;
	}
	capture.events.push(recorded);
}

export async function writeKeystrokes(videoPath: string, events: readonly RecordedKeyEvent[], mode?: KeystrokeCaptureMode) {
	if (!events.length && mode === undefined) return;
	const file = getKeysPathForVideo(videoPath);
	const temporary = `${file}.${randomUUID()}.tmp`;
	try {
		await fs.writeFile(temporary, JSON.stringify({ version: 1, mode, events }), { encoding: "utf8", flag: "wx" });
		await fs.rename(temporary, file);
	} finally {
		await fs.rm(temporary, { force: true }).catch(() => undefined);
	}
}

export async function persistKeystrokes(videoPath: string) {
	const current = capture;
	if (!current) return;
	releaseHeldKeystrokes();
	await writeKeystrokes(videoPath, current.events, current.mode);
	await current.journal.stop({ keepFile: false });
	await debugWrites;
	if (capture === current) capture = null;
}

export async function discardKeystrokes() {
	const current = capture;
	capture = null;
	await current?.journal.stop({ keepFile: false });
}

export async function readKeystrokes(videoPath: string) {
	try { return parseKeystrokeSidecar(await fs.readFile(getKeysPathForVideo(videoPath), "utf8")); }
	catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return { events: [] };
		throw error;
	}
}

export function rebuildKeystrokesFromJournal(journalPath: string) {
	return readTimedJournal(journalPath, isRecordedKeyEvent);
}
