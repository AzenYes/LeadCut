import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useI18n } from "@/contexts/I18nContext";
import { Button } from "@/components/ui/button";
import { loadAppSetting, saveAppSetting } from "@/lib/appSettings";
import { PREVIEW_WINDOW_BOUNDS_SETTING_KEY } from "@/lib/storageKeys";
import { isEditorNavigationTarget, isShortcutEditingTarget } from "../editorShortcutScope";
import { restorablePreviewWindowBounds } from "./previewWindowPlacement";

function rememberWindowBounds(child: Window, fullscreen = false) {
	if (child.closed || fullscreen || child.document.fullscreenElement) return;
	saveAppSetting(PREVIEW_WINDOW_BOUNDS_SETTING_KEY, {
		x: child.screenX, y: child.screenY, width: child.outerWidth, height: child.outerHeight,
	});
}

/** Keep one portal target and move its DOM: changing portal targets remounts the GPU renderer. */
export function DetachablePreview({ children, detachedControls, onBeforeMove, onAfterMove }: {
	children: ReactNode;
	detachedControls: ReactNode;
	onBeforeMove: () => void;
	onAfterMove: () => void;
}) {
	const { t } = useI18n();
	const [host, setHost] = useState<HTMLElement | null>(null);
	const [fullscreen, setFullscreen] = useState(false);
	const fullscreenRef = useRef(false);
	const updateFullscreen = useCallback((value: boolean) => {
		fullscreenRef.current = value;
		setFullscreen(value);
	}, []);
	const [contentHost] = useState(() => {
		const element = document.createElement("div");
		element.className = "flex min-h-0 min-w-0 flex-1 flex-col";
		element.dataset.previewSurface = "true";
		return element;
	});
	const inlineHost = useRef<HTMLDivElement | null>(null);
	const popout = useRef<Window | null>(null);
	const mounted = useRef(true);
	const movePending = useRef(false);
	useLayoutEffect(() => {
		const destination = host ?? inlineHost.current;
		if (destination && contentHost.parentElement !== destination) destination.appendChild(contentHost);
		if (movePending.current) { movePending.current = false; onAfterMove(); }
	}, [contentHost, host, onAfterMove]);
	const dock = () => {
		onBeforeMove();
		movePending.current = true;
		// Reclaim live media before closing its document. The renderer and transport survive.
		inlineHost.current?.appendChild(contentHost);
		setHost(null);
		const child = popout.current;
		popout.current = null;
		if (child) {
			rememberWindowBounds(child, fullscreenRef.current);
			child.close();
		}
		updateFullscreen(false);
	};
	const detach = (left?: number, top?: number) => {
		if (popout.current && !popout.current.closed) { popout.current.focus(); return; }
		const displays = window.electronAPI?.getPreviewDisplayBounds?.() ?? [];
		const saved = restorablePreviewWindowBounds(loadAppSetting(PREVIEW_WINDOW_BOUNDS_SETTING_KEY), displays);
		const x = left ?? saved?.x;
		const y = top ?? saved?.y;
		const width = Math.round(saved?.width ?? 1100);
		const height = Math.round(saved?.height ?? 740);
		const position = x === undefined || y === undefined ? "" : `,left=${Math.round(x)},top=${Math.round(y)}`;
		const child = window.open("about:blank", "leadcut-preview", `popup=yes,width=${width},height=${height}${position}`);
		if (!child) return;
		onBeforeMove();
		movePending.current = true;
		popout.current = child;
		child.document.title = t("editor.preview.windowTitle", "LeadCut Preview");
		child.document.documentElement.lang = document.documentElement.lang;
		child.document.documentElement.className = document.documentElement.className;
		child.document.documentElement.dataset.platform = document.documentElement.dataset.platform;
		child.document.documentElement.dataset.theme = document.documentElement.dataset.theme;
		for (const element of document.querySelectorAll('head style, head link[rel="stylesheet"]')) {
			const copy = element.cloneNode(true) as HTMLElement;
			if (copy instanceof HTMLLinkElement) copy.href = (element as HTMLLinkElement).href;
			child.document.head.appendChild(copy);
		}
		const style = child.document.createElement("style");
		style.textContent = "html,body,#leadcut-preview-root{margin:0;width:100%;height:100%;overflow:hidden}body{background:var(--background,#101114);color:var(--foreground,#fff)}#leadcut-preview-root{display:flex;flex-direction:column;padding:12px;box-sizing:border-box}";
		child.document.head.appendChild(style);
		const root = child.document.createElement("div");
		root.id = "leadcut-preview-root";
		child.document.body.appendChild(root);
		for (const type of ["keydown", "keyup"] as const) child.addEventListener(type, (event) => {
			if (event.defaultPrevented || event.isComposing || isShortcutEditingTarget(event.target)) return;
			if (/^(Arrow|Home$|End$)/.test(event.key) && event.target !== child && !isEditorNavigationTarget(event.target)) return;
			const unhandled = window.dispatchEvent(new KeyboardEvent(type, {
				key: event.key, code: event.code, repeat: event.repeat, ctrlKey: event.ctrlKey,
				altKey: event.altKey, shiftKey: event.shiftKey, metaKey: event.metaKey,
				bubbles: true, cancelable: true,
			}));
			if (!unhandled) {
				event.preventDefault();
				event.stopImmediatePropagation();
			}
		}, { capture: true });
		child.document.addEventListener("fullscreenchange", () => {
			if (mounted.current && popout.current === child) updateFullscreen(Boolean(child.document.fullscreenElement));
		});
		child.addEventListener("beforeunload", () => {
			if (popout.current !== child) return;
			rememberWindowBounds(child, fullscreenRef.current);
			onBeforeMove();
			movePending.current = true;
			inlineHost.current?.appendChild(contentHost);
			popout.current = null;
			if (mounted.current) {
				setHost(null);
				updateFullscreen(false);
			}
		});
		setHost(root);
	};
	const toggleFullscreen = async () => {
		const child = popout.current;
		if (!child) return;
		try {
			const nativeFullscreen = window.electronAPI?.setDetachedPreviewFullscreen;
			if (nativeFullscreen) {
				const enter = !fullscreenRef.current;
				if (enter) rememberWindowBounds(child);
				if (!(await nativeFullscreen(enter))) throw new Error("The detached preview window closed.");
				if (popout.current === child) updateFullscreen(enter);
			} else if (child.document.fullscreenElement) await child.document.exitFullscreen();
			else {
				rememberWindowBounds(child);
				await child.document.documentElement.requestFullscreen();
			}
		} catch (error) {
			console.warn("Could not toggle preview fullscreen:", error);
		}
	};
	useEffect(() => {
		const unsubscribe = window.electronAPI?.onDetachedPreviewFullscreenChanged?.(value => {
			if (popout.current) updateFullscreen(value);
		});
		mounted.current = true;
		return () => {
			unsubscribe?.();
			mounted.current = false;
			const child = popout.current;
			popout.current = null;
			if (child) {
				rememberWindowBounds(child, fullscreenRef.current);
				child.close();
			}
		};
	}, [updateFullscreen]);
	return (
		<div className="flex min-h-0 min-w-0 flex-1 flex-col" data-preview-detached={Boolean(host)}>
			<div className="mb-1 flex h-6 shrink-0 items-center justify-between gap-3">
				<span draggable onDragStart={(event) => { event.dataTransfer.setData("text/plain", "leadcut-preview"); }} onDragEnd={(event) => {
					if (event.screenX < window.screenX || event.screenX > window.screenX + window.outerWidth || event.screenY < window.screenY || event.screenY > window.screenY + window.outerHeight) detach(event.screenX - 100, event.screenY - 20);
				}} className="cursor-grab select-none text-[11px] font-medium uppercase tracking-widest text-muted-foreground" title={t("editor.preview.dragOut", "Drag outside the editor to detach preview")}>
					{t("editor.preview.monitor", "Program monitor")}
				</span>
				<Button variant="ghost" size="sm" className="h-6 px-2 text-xs" onClick={() => host ? dock() : detach()}>
					{host ? t("editor.preview.dock", "Dock preview") : t("editor.preview.detach", "Detach preview")}
				</Button>
			</div>
			<div ref={inlineHost} className="flex min-h-0 min-w-0 flex-1 flex-col" style={host ? { display: "none" } : undefined} />
			{host && <>
				<div className="flex flex-1 flex-col items-center justify-center gap-3 rounded border border-dashed border-foreground/20 text-sm text-muted-foreground">
					{t("editor.preview.onOtherDisplay", "Preview is open in a separate window")}
					<Button variant="outline" size="sm" onClick={dock}>{t("editor.preview.dock", "Dock preview")}</Button>
				</div>
				{createPortal(
					<>
						<div className="order-first mb-2 flex h-8 shrink-0 items-center justify-between gap-3">
							<span className="truncate text-sm">{t("editor.preview.monitor", "Program monitor")}</span>
							<div className="flex shrink-0 gap-2">
								<Button variant="ghost" size="sm" onClick={() => void toggleFullscreen()}>
									{t(fullscreen ? "common.interface.previewExitFullscreen" : "common.interface.previewEnterFullscreen")}
								</Button>
								<Button variant="outline" size="sm" onClick={dock}>{t("editor.preview.dock", "Dock preview")}</Button>
							</div>
						</div>
						<div className="order-last shrink-0 py-1" data-preview-surface>{detachedControls}</div>
					</>,
					host,
				)}
			</>}
			{createPortal(children, contentHost)}
		</div>
	);
}
