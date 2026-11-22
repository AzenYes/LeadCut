import type { ShortcutBinding } from "./shortcuts";

export const RECORDING_SHORTCUT_ACTIONS = [
	"toggleRecording",
	"togglePause",
	"addMarkerCut",
	"addMarkerHighlight",
	"toggleAnnotation",
	"toggleKeystrokeCapture",
] as const;

export type RecordingShortcutAction = (typeof RECORDING_SHORTCUT_ACTIONS)[number];
export type RecordingShortcutsConfig = Record<RecordingShortcutAction, ShortcutBinding>;

export const DEFAULT_RECORDING_SHORTCUTS: RecordingShortcutsConfig = {
	toggleRecording: { key: "r", ctrl: true, alt: true },
	togglePause: { key: "p", ctrl: true, alt: true },
	addMarkerCut: { key: "x", ctrl: true, alt: true },
	addMarkerHighlight: { key: "m", ctrl: true, alt: true },
	toggleAnnotation: { key: "d", ctrl: true, alt: true },
	toggleKeystrokeCapture: { key: "k", ctrl: true, alt: true },
};

export function isRecordingShortcutAction(action: string): action is RecordingShortcutAction {
	return RECORDING_SHORTCUT_ACTIONS.some(candidate => candidate === action);
}

const ACCELERATOR_KEYS = new Map(Object.entries({
	" ": "Space",
	arrowup: "Up",
	arrowdown: "Down",
	arrowleft: "Left",
	arrowright: "Right",
	backspace: "Backspace",
	delete: "Delete",
	enter: "Enter",
	escape: "Escape",
	home: "Home",
	end: "End",
	pageup: "PageUp",
	pagedown: "PageDown",
	insert: "Insert",
	tab: "Tab",
	capslock: "Capslock",
	numlock: "Numlock",
	scrolllock: "Scrolllock",
	printscreen: "PrintScreen",
	"+": "Plus",
}));
const PUNCTUATION_KEYS = ")!@#$%^&*(:;=<,_->.?/~`{][|\\}\"";

export function bindingToAccelerator(binding: ShortcutBinding): string | null {
	const key = binding.key.toLowerCase();
	const namedKey = ACCELERATOR_KEYS.get(key);
	const isPrintable = key.length === 1 && (/^[a-z0-9]$/.test(key) || PUNCTUATION_KEYS.includes(key));
	const isFunctionKey = /^f(?:[1-9]|1\d|2[0-4])$/.test(key);
	const acceleratorKey = namedKey ?? (isPrintable || isFunctionKey ? key.toUpperCase() : null);
	if (!acceleratorKey) return null;
	const parts: string[] = [];
	if (binding.ctrl) parts.push("CommandOrControl");
	if (binding.alt) parts.push("Alt");
	if (binding.shift) parts.push("Shift");
	parts.push(acceleratorKey);
	return parts.join("+");
}

export type RecordingShortcutConflict =
	| { type: "modifier" | "unsupported"; action: RecordingShortcutAction }
	| { type: "duplicate"; action: RecordingShortcutAction; other: RecordingShortcutAction };

export function findRecordingShortcutConflict(config: RecordingShortcutsConfig): RecordingShortcutConflict | null {
	const actionsByAccelerator = new Map<string, RecordingShortcutAction>();
	for (const action of RECORDING_SHORTCUT_ACTIONS) {
		const binding = config[action];
		if (!binding?.ctrl && !binding?.alt) return { type: "modifier", action };
		const accelerator = bindingToAccelerator(binding);
		if (!accelerator) return { type: "unsupported", action };
		const other = actionsByAccelerator.get(accelerator);
		if (other) return { type: "duplicate", action, other };
		actionsByAccelerator.set(accelerator, action);
	}
	return null;
}

export interface RecordingShortcutStatus {
	config: RecordingShortcutsConfig;
	failed: RecordingShortcutAction[];
}

export type RecordingShortcutSaveResult = {
	success: boolean;
	failed: RecordingShortcutAction[];
	conflict?: RecordingShortcutConflict;
};
