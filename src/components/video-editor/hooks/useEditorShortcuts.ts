import { useEffect, useRef } from "react";
import { type FixedShortcut, type ShortcutAction, type ShortcutsConfig, FIXED_SHORTCUTS, matchesShortcut, SHORTCUT_ACTIONS } from "@/lib/shortcuts";
import { isEditorNavigationTarget, isEditorShortcutBlocked, isShortcutEditingTarget } from "../editorShortcutScope";

type Options = {
	repeatable?: ReadonlySet<ShortcutAction>;
	canHandle?: (action: ShortcutAction) => boolean;
	fixedActions?: Partial<Record<FixedShortcut["action"], () => boolean>>;
	onEscape?: () => void;
};

export function useEditorShortcuts(
	shortcuts: ShortcutsConfig,
	isMac: boolean,
	actions: Record<ShortcutAction, () => void>,
	options: Options = {},
) {
	const current = useRef({ shortcuts, isMac, actions, options });
	current.current = { shortcuts, isMac, actions, options };
	useEffect(() => {
		let heldPlaybackKey: string | null = null;
		const consume = (event: KeyboardEvent) => {
			event.preventDefault();
			event.stopImmediatePropagation();
		};
		const keyIdentity = (event: KeyboardEvent) => event.code || event.key.toLowerCase();
		const keydown = (event: KeyboardEvent) => {
			if (isEditorShortcutBlocked(event.target)) {
				heldPlaybackKey = null;
				return;
			}
			const key = keyIdentity(event);
			if (heldPlaybackKey === key) {
				consume(event);
				return;
			}
			if (event.defaultPrevented || event.isComposing || isShortcutEditingTarget(event.target)) return;
			if (/^(Arrow|Home$|End$)/.test(event.key) && !isEditorNavigationTarget(event.target)) return;
			const active = current.current;
			const { canHandle, fixedActions, onEscape, repeatable } = active.options;
			if (onEscape && matchesShortcut(event, { key: "escape" }, active.isMac)) onEscape();
			const fixed = fixedActions && FIXED_SHORTCUTS.find(({ bindings }) =>
				bindings.some(binding => matchesShortcut(event, binding, active.isMac)));
			if (fixed && fixedActions?.[fixed.action]) {
				// The transcript owns deletion when the grid itself has focus.
				if (fixed.action === "deleteSelection" && (event.target as Element | null)?.matches?.("[data-caption-transcript-grid]")) return;
				if (fixedActions[fixed.action]?.()) consume(event);
				return;
			}
			const action = SHORTCUT_ACTIONS.find(name =>
				matchesShortcut(event, active.shortcuts[name], active.isMac) && (canHandle?.(name) ?? true));
			if (!action) return;
			consume(event);
			if (event.repeat && !repeatable?.has(action)) return;
			// React Aria activates focused buttons on Space keyup. Consume both
			// events for the playback binding so one press toggles only once.
			if (action === "playPause") heldPlaybackKey = key;
			active.actions[action]();
		};
		const keyup = (event: KeyboardEvent) => {
			if (heldPlaybackKey !== keyIdentity(event)) return;
			heldPlaybackKey = null;
			consume(event);
		};
		const blur = () => { heldPlaybackKey = null; };
		window.addEventListener("keydown", keydown, { capture: true });
		window.addEventListener("keyup", keyup, { capture: true });
		window.addEventListener("blur", blur);
		return () => {
			window.removeEventListener("keydown", keydown, { capture: true });
			window.removeEventListener("keyup", keyup, { capture: true });
			window.removeEventListener("blur", blur);
		};
	}, []);
}
