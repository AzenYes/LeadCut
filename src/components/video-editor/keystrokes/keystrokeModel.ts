import { isRecordedShortcut, type RecordedKeyEvent } from "../../../../services/leadcut-mcp/src/keystrokeSidecar";
import { fontFamilyDisplayName, localFontCssFamily } from "@/lib/localFonts";
import {
	DEFAULT_KEYSTROKE_OVERLAY, getClipSourceEndMs, getClipSourceStartMs, mapSourceTimeToTimelineTime,
	type ClipRegion, type KeystrokeOverlaySettings, type KeystrokeOverlayStyle,
} from "../types";

const CHARACTER_KEYS = new Map(Object.entries({
	Space: " ", Semicolon: ";", Equal: "=", Comma: ",", Minus: "-", Period: ".", Slash: "/",
	Backquote: "`", BracketLeft: "[", Backslash: "\\", BracketRight: "]", Quote: "'",
}));
const SHIFTED = new Map(Array.from("1234567890;=,-./`[\\]'", (key, index) => [key, "!@#$%^&*():+<_>?~{|}\""[index]]));
const DISPLAY_KEYS = new Map(Object.entries({
	Escape: "Esc", ArrowLeft: "←", ArrowRight: "→", ArrowUp: "↑", ArrowDown: "↓",
	PageUp: "Page Up", PageDown: "Page Down", NumpadEnter: "Enter",
	Meta: "Win", MetaRight: "Win", CtrlRight: "Ctrl", AltRight: "Alt", ShiftRight: "Shift",
}));

export interface KeystrokeItem {
	id: string;
	startMs: number;
	endMs: number;
	label: string;
	characterParts?: { atMs: number; text: string }[];
}

function characterKey(event: RecordedKeyEvent): string | undefined {
	if (event.ctrl || event.alt || event.meta) return undefined;
	const letter = /^[A-Z]$/.test(event.key) ? event.key : undefined;
	if (letter) return event.shift ? letter : letter.toLowerCase();
	const base = /^[0-9]$/.test(event.key) ? event.key : CHARACTER_KEYS.get(event.key) ?? event.key.match(/^Numpad([0-9])$/)?.[1];
	return base && event.shift ? SHIFTED.get(base) ?? base : base;
}

function shortcutLabel(event: RecordedKeyEvent) {
	return [event.ctrl && "Ctrl", event.alt && "Alt", event.shift && "Shift", event.meta && "Win",
		DISPLAY_KEYS.get(event.key) ?? event.key].filter(Boolean).join(" + ");
}

export function normalizeKeystrokeOverlay(value: unknown): KeystrokeOverlaySettings {
	const raw = value && typeof value === "object" ? value as Partial<KeystrokeOverlaySettings> : {};
	const style = raw.style && typeof raw.style === "object" ? raw.style : {} as Partial<KeystrokeOverlayStyle>;
	const base = DEFAULT_KEYSTROKE_OVERLAY.style;
	const number = (field: keyof KeystrokeOverlayStyle, defaultValue: number, min: number, max: number) => {
		const input = style[field];
		return typeof input === "number" && Number.isFinite(input) ? Math.max(min, Math.min(max, input)) : defaultValue;
	};
	const color = (value: unknown, fallback: string) => typeof value === "string" && /^#[0-9a-f]{6}$/i.test(value) ? value : fallback;
	const durationMs = number("durationMs", base.durationMs, 250, 5000);
	const family = typeof style.fontFamily === "string" ? fontFamilyDisplayName(style.fontFamily).trim().slice(0, 100) : "";
	const fontFamily = /,|^["']/.test(family) ? localFontCssFamily(family) : family;
	return {
		enabled: typeof raw.enabled === "boolean" ? raw.enabled : DEFAULT_KEYSTROKE_OVERLAY.enabled,
		filter: raw.filter === "shortcuts" ? "shortcuts" : "all",
		hiddenIds: Array.isArray(raw.hiddenIds) ? [...new Set(raw.hiddenIds.filter(id => typeof id === "string" && id.length <= 128))] : [],
		style: {
			x: number("x", base.x, 0, 100), y: number("y", base.y, 0, 100),
			fontFamily: fontFamily || base.fontFamily,
			fontSize: number("fontSize", base.fontSize, 12, 120),
			textColor: color(style.textColor, base.textColor), backgroundColor: color(style.backgroundColor, base.backgroundColor),
			cornerRadius: number("cornerRadius", base.cornerRadius, 0, 64),
			opacity: number("opacity", base.opacity, 0, 1), durationMs,
			fadeMs: number("fadeMs", base.fadeMs, 0, durationMs / 2),
		},
	};
}

function firstPressAt(events: readonly RecordedKeyEvent[], timeMs: number) {
	let low = 0;
	let high = events.length;
	while (low < high) {
		const mid = (low + high) >>> 1;
		if (events[mid].timeMs < timeMs) low = mid + 1;
		else high = mid;
	}
	return low;
}

export function getKeystrokePresses(events: readonly RecordedKeyEvent[]) {
	const held = new Map<number, number>();
	return [...events].sort((a, b) => a.timeMs - b.timeMs).filter(event => {
		if (event.type === "up") {
			held.delete(event.keycode);
			return false;
		}
		const previous = held.get(event.keycode);
		held.set(event.keycode, event.timeMs);
		return previous === undefined || event.timeMs - previous > 1100;
	});
}

export function buildKeystrokeItems(events: readonly RecordedKeyEvent[], {
	clips = [], hiddenIds = [], durationMs = DEFAULT_KEYSTROKE_OVERLAY.style.durationMs, timelineDurationMs = Infinity,
	filter = "all",
}: {
	clips?: readonly ClipRegion[];
	hiddenIds?: readonly string[];
	durationMs?: number;
	timelineDurationMs?: number;
	filter?: KeystrokeOverlaySettings["filter"];
} = {}): KeystrokeItem[] {
	const presses = getKeystrokePresses(events).filter(event =>
		!event.key.startsWith("Unknown:") && (filter === "all" || isRecordedShortcut(event.key, event)),
	);
	const items: KeystrokeItem[] = [];
	const hidden = new Set(hiddenIds);
	function buildRange(sourceStart: number, sourceEnd: number, clipEnd: number, clip?: ClipRegion) {
		let pending: KeystrokeItem | undefined;
		let lastCharacterTime = -Infinity;
		const commit = () => {
			if (!pending || pending.endMs <= pending.startMs || hidden.has(pending.id)) return;
			if (pending.characterParts && pending.characterParts.length > 1) {
				pending.label = pending.characterParts.map(part => part.text).join("");
			}
			items.push(pending);
		};
		for (let index = firstPressAt(presses, sourceStart); index < presses.length; index++) {
			const event = presses[index];
			if (event.timeMs >= sourceEnd) break;
			const atMs = clip ? mapSourceTimeToTimelineTime(event.timeMs, [clip]) : event.timeMs;
			const endMs = Math.min(clipEnd, atMs + durationMs);
			const char = characterKey(event);
			if (char && pending?.characterParts && event.timeMs - lastCharacterTime <= 800) {
				pending.characterParts.push({ atMs, text: char });
				pending.endMs = endMs;
			} else {
				commit();
				pending = {
					id: `${event.timeMs}:${event.key}`, startMs: atMs, endMs,
					label: char?.trim() ? char : shortcutLabel(event),
					characterParts: char ? [{ atMs, text: char }] : undefined,
				};
			}
			lastCharacterTime = char ? event.timeMs : -Infinity;
		}
		commit();
	}
	if (clips.length) {
		for (const clip of clips) buildRange(getClipSourceStartMs(clip), getClipSourceEndMs(clip), clip.endMs, clip);
	} else buildRange(0, timelineDurationMs, timelineDurationMs);
	return items.sort((a, b) => a.startMs - b.startMs);
}
