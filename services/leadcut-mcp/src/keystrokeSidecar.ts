export type KeystrokeCaptureMode = "off" | "shortcuts" | "all";
export const DEFAULT_KEYSTROKE_CAPTURE_MODE: KeystrokeCaptureMode = "all";

export interface RecordedKeyEvent {
	timeMs: number;
	type: "down" | "up";
	keycode: number;
	key: string;
	ctrl: boolean;
	alt: boolean;
	shift: boolean;
	meta: boolean;
}

export interface KeystrokeSidecar {
	events: RecordedKeyEvent[];
	mode?: KeystrokeCaptureMode;
}

const shortcutControls = new Set([
	"Escape", "Enter", "Tab", "Backspace", "Delete", "ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown",
	"Home", "End", "PageUp", "PageDown",
]);

export function isRecordedShortcut(key: string, modifiers: Pick<RecordedKeyEvent, "ctrl" | "alt" | "meta">) {
	return modifiers.ctrl || modifiers.alt || modifiers.meta ||
		shortcutControls.has(key.replace(/^Numpad(?=\D)/, "")) || /^F(?:[1-9]|1[0-2])$/.test(key);
}

export function isKeystrokeCaptureMode(value: unknown): value is KeystrokeCaptureMode {
	return value === "off" || value === "shortcuts" || value === "all";
}

export function isRecordedKeyEvent(value: unknown): value is RecordedKeyEvent {
	if (!value || typeof value !== "object") return false;
	const event = value as Partial<RecordedKeyEvent>;
	return typeof event.timeMs === "number" && Number.isFinite(event.timeMs) && event.timeMs >= 0 &&
		(event.type === "down" || event.type === "up") && Number.isInteger(event.keycode) &&
		typeof event.key === "string" && event.key.length > 0 && event.key.length <= 48 &&
		[event.ctrl, event.alt, event.shift, event.meta].every(modifier => typeof modifier === "boolean");
}

export function getKeysPathForVideo(videoPath: string) {
	return `${videoPath}.leadcut-keys.json`;
}

export function parseKeystrokeSidecar(text: string): KeystrokeSidecar {
	const data = JSON.parse(text.replace(/^\uFEFF/, "")) as { version?: unknown; mode?: unknown; events?: unknown } | null;
	if (data?.version !== 1 || !Array.isArray(data.events)) return { events: [] };
	return {
		events: data.events.filter(isRecordedKeyEvent),
		...(isKeystrokeCaptureMode(data.mode) ? { mode: data.mode } : {}),
	};
}
