import { uiText } from "@/i18n/uiText";
export const SHORTCUT_ACTIONS = [
	"addZoom",
	"splitClip",
	"acceptChange",
	"addAnnotation",
	"addKeyframe",
	"deleteSelected",
	"playPause",
	"rippleDelete",
	"selectForward",
	"shuttleForward",
	"undo",
	"redo",
	"redoAlt",
	"stepFrameBack",
	"stepFrameForward",
	"seekBackSecond",
	"seekForwardSecond",
	"prevCut",
	"nextCut",
	"seekToStart",
	"seekToEnd",
	"shuttleReverse",
	"pauseOnly",
	"reviewRateUp",
	"reviewRateDown",
	"prevChange",
	"nextChange",
	"auditionChange",
	"restoreChange",
] as const;

export type ShortcutAction = (typeof SHORTCUT_ACTIONS)[number];

export interface ShortcutBinding {
	key: string;
	/** Maps to Cmd on macOS, Ctrl on Windows/Linux */
	ctrl?: boolean;
	shift?: boolean;
	alt?: boolean;
}

export type ShortcutsConfig = Record<ShortcutAction, ShortcutBinding>;

export interface FixedShortcut {
	action: "nextAnnotation" | "previousAnnotation" | "deleteSelection" | "panTimeline" | "zoomTimeline" | "selectAllZooms";
	label: string;
	display: string;
	bindings: ShortcutBinding[];
}

export const FIXED_SHORTCUTS: FixedShortcut[] = [
	{ action: "nextAnnotation", get label() { return uiText("cycleAnnotationsForward"); }, display: "Tab", bindings: [{ key: "tab" }] },
	{
		action: "previousAnnotation",
		get label() { return uiText("cycleAnnotationsBackward"); },
		display: "Shift + Tab",
		bindings: [{ key: "tab", shift: true }],
	},
	{
		action: "deleteSelection",
		get label() { return uiText("deleteSelectedAlt"); },
		display: "Del / ⌫",
		bindings: [{ key: "delete" }, { key: "backspace" }],
	},
	{ action: "panTimeline", get label() { return uiText("panTimeline"); }, get display() { return uiText("shiftScroll"); }, bindings: [] },
	{ action: "zoomTimeline", get label() { return uiText("zoomTimeline"); }, get display() { return uiText("ctrlScroll"); }, bindings: [] },
	{ action: "selectAllZooms", get label() { return uiText("selectAll"); }, display: "Ctrl + A", bindings: [{ key: "a", ctrl: true }] },
];

export type ShortcutConflict =
	| { type: "configurable"; action: ShortcutAction }
	| { type: "fixed"; label: string };

function normalizeShortcutKey(key: string, shifted: boolean): string {
	// KeyboardEvent.key reports the shifted character on real keyboards.
	if (shifted && key === ">") return ".";
	if (shifted && key === "<") return ",";
	return key.toLowerCase();
}

export function bindingsEqual(a: ShortcutBinding, b: ShortcutBinding): boolean {
	return (
		normalizeShortcutKey(a.key, !!a.shift) === normalizeShortcutKey(b.key, !!b.shift) &&
		!!a.ctrl === !!b.ctrl &&
		!!a.shift === !!b.shift &&
		!!a.alt === !!b.alt
	);
}

function shareReviewDefault(first: ShortcutAction, second: ShortcutAction, binding: ShortcutBinding) {
	const pair = first === "acceptChange" && second === "addAnnotation" ||
		first === "addAnnotation" && second === "acceptChange";
	return pair && bindingsEqual(binding, { key: "a", shift: true });
}

export function findConflict(
	binding: ShortcutBinding,
	forAction: ShortcutAction,
	config: ShortcutsConfig,
): ShortcutConflict | null {
	if (!binding.key) return null;
	for (const fixed of FIXED_SHORTCUTS) {
		if (fixed.bindings.some((b) => bindingsEqual(b, binding))) {
			return { type: "fixed", label: fixed.label };
		}
	}
	for (const action of SHORTCUT_ACTIONS) {
		if (action !== forAction && bindingsEqual(config[action], binding) && !shareReviewDefault(action, forAction, binding)) {
			return { type: "configurable", action };
		}
	}
	return null;
}

export const DEFAULT_SHORTCUTS: ShortcutsConfig = {
	addZoom: { key: "z" },
	splitClip: { key: "f2" },
	addAnnotation: { key: "a", shift: true },
	addKeyframe: { key: "f" },
	deleteSelected: { key: "d", ctrl: true },
	playPause: { key: " " },
	rippleDelete: { key: "f3" },
	selectForward: { key: "a" },
	shuttleForward: { key: "l" },
	undo: { key: "z", ctrl: true },
	redo: { key: "z", ctrl: true, shift: true },
	redoAlt: { key: "y", ctrl: true },
	stepFrameBack: { key: "arrowleft" },
	stepFrameForward: { key: "arrowright" },
	seekBackSecond: { key: "arrowleft", shift: true },
	seekForwardSecond: { key: "arrowright", shift: true },
	prevCut: { key: "arrowup" },
	nextCut: { key: "arrowdown" },
	seekToStart: { key: "home" },
	seekToEnd: { key: "end" },
	shuttleReverse: { key: "j" },
	pauseOnly: { key: "k" },
	reviewRateUp: { key: ".", shift: true },
	reviewRateDown: { key: ",", shift: true },
	prevChange: { key: "[" },
	nextChange: { key: "]" },
	auditionChange: { key: "\\" },
	acceptChange: { key: "a", shift: true },
	restoreChange: { key: "r", shift: true },
};

export const SHORTCUT_LABELS: Record<ShortcutAction, string> = {
	get addZoom() { return uiText("addZoom"); },
	get splitClip() { return uiText("splitClip"); },
	get addAnnotation() { return uiText("addAnnotation"); },
	get addKeyframe() { return uiText("addKeyframe"); },
	get deleteSelected() { return uiText("deleteSelected"); },
	get playPause() { return uiText("playPause"); },
	get rippleDelete() { return uiText("rippleDelete"); },
	get selectForward() { return uiText("selectForward"); },
	get shuttleForward() { return uiText("shuttleForward"); },
	get undo() { return uiText("undo"); },
	get redo() { return uiText("redo"); },
	get redoAlt() { return uiText("redoAlternativeShortcut"); },
	get stepFrameBack() { return uiText("stepFrameBack"); },
	get stepFrameForward() { return uiText("stepFrameForward"); },
	get seekBackSecond() { return uiText("seekBackSecond"); },
	get seekForwardSecond() { return uiText("seekForwardSecond"); },
	get prevCut() { return uiText("prevCut"); },
	get nextCut() { return uiText("nextCut"); },
	get seekToStart() { return uiText("seekToStart"); },
	get seekToEnd() { return uiText("seekToEnd"); },
	get shuttleReverse() { return uiText("shuttleReverse"); },
	get pauseOnly() { return uiText("pauseOnly"); },
	get reviewRateUp() { return uiText("reviewRateUp"); },
	get reviewRateDown() { return uiText("reviewRateDown"); },
	get prevChange() { return uiText("reviewPrevious"); },
	get nextChange() { return uiText("reviewNext"); },
	get auditionChange() { return uiText("reviewAudition"); },
	get acceptChange() { return uiText("reviewAccept"); },
	get restoreChange() { return uiText("reviewRestore"); },
};

export const REPEATING_SHORTCUT_ACTIONS = new Set<ShortcutAction>([
	"stepFrameBack", "stepFrameForward", "seekBackSecond", "seekForwardSecond",
	"prevCut", "nextCut", "seekToStart", "seekToEnd",
]);

export function matchesShortcut(
	e: KeyboardEvent,
	binding: ShortcutBinding,
	isMacPlatform: boolean,
): boolean {
	if (!binding.key || normalizeShortcutKey(e.key, e.shiftKey) !== normalizeShortcutKey(binding.key, !!binding.shift)) return false;

	const primaryMod = isMacPlatform ? e.metaKey : e.ctrlKey;
	if (isMacPlatform ? e.ctrlKey : e.metaKey) return false;
	if (primaryMod !== !!binding.ctrl) return false;
	if (e.shiftKey !== !!binding.shift) return false;
	if (e.altKey !== !!binding.alt) return false;

	return true;
}

const KEY_LABELS: Record<string, string> = {
	" ": "Space",
	delete: "Del",
	backspace: "⌫",
	escape: "Esc",
	arrowup: "↑",
	arrowdown: "↓",
	arrowleft: "←",
	arrowright: "→",
};

export function formatBinding(binding: ShortcutBinding, isMac: boolean): string {
	if (!binding.key) return "—";
	const parts: string[] = [];
	if (binding.ctrl) parts.push(isMac ? "⌘" : "Ctrl");
	if (binding.shift) parts.push(isMac ? "⇧" : "Shift");
	if (binding.alt) parts.push(isMac ? "⌥" : "Alt");
	parts.push(KEY_LABELS[binding.key.toLowerCase()] ?? binding.key.toUpperCase());
	return parts.join(" + ");
}

export function formatFixedShortcut(shortcut: FixedShortcut, isMac: boolean): string {
	return isMac ? shortcut.display.replace("Ctrl", "⌘") : shortcut.display;
}

export function mergeWithDefaults(partial: Partial<ShortcutsConfig>): ShortcutsConfig {
	const merged = { ...DEFAULT_SHORTCUTS };
	const customized = new Set<ShortcutAction>();
	for (const action of SHORTCUT_ACTIONS) {
		const binding = partial[action];
		if (typeof binding?.key !== "string") continue;
		if (FIXED_SHORTCUTS.some(fixed => fixed.bindings.some(reserved => bindingsEqual(reserved, binding)))) continue;
		merged[action] = binding;
		customized.add(action);
	}
	for (const action of SHORTCUT_ACTIONS) {
		if (customized.has(action)) continue;
		if ([...customized].some(other => bindingsEqual(merged[action], merged[other]) &&
			!shareReviewDefault(action, other, merged[action]))) merged[action] = { key: "" };
	}
	return merged;
}
