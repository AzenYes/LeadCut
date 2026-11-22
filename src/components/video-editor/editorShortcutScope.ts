// Portaled dialogs can leave focus on the body during opening/closing. Check both
// the event target and visible overlays before allowing editor-wide shortcuts.
export function isEditorShortcutBlocked(target: EventTarget | null): boolean {
	const selector = '[role="dialog"], [role="alertdialog"], [role="menu"], [role="listbox"], [aria-modal="true"], [data-recording-library]';
	if ((target as HTMLElement | null)?.closest?.(selector)) return true;
	if (typeof document === "undefined" || !document.querySelectorAll) return false;
	if (document.querySelector?.("[data-version-preview]")) return true;
	const overlays = '[role="dialog"], [role="alertdialog"], [role="menu"], [role="listbox"], [aria-modal="true"]';
	return Array.from(document.querySelectorAll<HTMLElement>(overlays)).some(
		(element) => element.getAttribute("aria-modal") !== "false" && !element.hidden && element.getAttribute("data-state") !== "closed" && element.getClientRects().length > 0,
	);
}

export function isShortcutEditingTarget(target: EventTarget | null): boolean {
	const element = target as HTMLElement | null;
	return Boolean(element?.isContentEditable || element?.closest?.(
		'input, textarea, select, [contenteditable]:not([contenteditable="false"]), [data-source-audio-editor], [data-keystroke-item]',
	));
}

export function isEditorNavigationTarget(target: EventTarget | null): boolean {
	if (!target || target === window) return true;
	const element = target as HTMLElement;
	const owner = element.ownerDocument;
	if (owner && (target === owner.body || target === owner.documentElement)) return true;
	if (element.closest?.('[role="slider"], [role="separator"], [role="list"], [role="listbox"], [role="tablist"], .editor-sidebar')) return false;
	return Boolean(element.closest?.("[data-timeline-panel], [data-preview-surface]"));
}
