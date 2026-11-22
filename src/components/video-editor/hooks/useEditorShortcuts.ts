import { useEffect, useRef } from "react";
import { type ShortcutAction, type ShortcutsConfig, matchesShortcut, SHORTCUT_ACTIONS } from "@/lib/shortcuts";
import { isEditorNavigationTarget, isEditorShortcutBlocked, isShortcutEditingTarget } from "../editorShortcutScope";

export function useEditorShortcuts(
	shortcuts: ShortcutsConfig,
	isMac: boolean,
	actions: Record<ShortcutAction, () => void>,
	repeatable?: ReadonlySet<ShortcutAction>,
	canHandle?: (action: ShortcutAction) => boolean,
) {
	const current = useRef({ shortcuts, isMac, actions, repeatable, canHandle });
	current.current = { shortcuts, isMac, actions, repeatable, canHandle };
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
			const action = SHORTCUT_ACTIONS.find(name =>
				matchesShortcut(event, active.shortcuts[name], active.isMac) && (active.canHandle?.(name) ?? true));
			if (!action) return;
			consume(event);
			if (event.repeat && !active.repeatable?.has(action)) return;
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
