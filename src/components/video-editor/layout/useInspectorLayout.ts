import { EDITOR_LAYOUT_STORAGE_KEY } from "@/lib/storageKeys";
import { useEffect, useState } from "react";
import { loadAppSetting, saveAppSetting } from "@/lib/appSettings";

const DEFAULT = { width: 320, collapsed: false, labels: false };
const CAPTION_PANEL_WIDTH_KEY = "leadcut.editor.captionPanelWidth";
export function useInspectorLayout(captionPanel = false) {
	const [preferences, setPreferences] = useState(() => {
		const stored = loadAppSetting<Partial<typeof DEFAULT>>(EDITOR_LAYOUT_STORAGE_KEY);
		return {
			width: typeof stored?.width === "number" && Number.isFinite(stored.width) ? Math.min(720, Math.max(260, stored.width)) : 320,
			collapsed: stored?.collapsed === true,
			labels: stored?.labels === true,
		};
	});
	const [captionWidth, setCaptionWidth] = useState(() => {
		const saved = loadAppSetting<number>(CAPTION_PANEL_WIDTH_KEY);
		return typeof saved === "number" && Number.isFinite(saved) ? Math.max(340, Math.min(900, saved)) : 440;
	});
	const [windowWidth, setWindowWidth] = useState(() => window.innerWidth);
	const [compact, setCompact] = useState(() => window.matchMedia("(max-width: 1100px)").matches);
	const [compactOpen, setCompactOpen] = useState(false);
	useEffect(() => {
		const media = window.matchMedia("(max-width: 1100px)");
		const change = () => { setCompact(media.matches); setCompactOpen(false); };
		const resize = () => setWindowWidth(window.innerWidth);
		media.addEventListener("change", change);
		window.addEventListener("resize", resize);
		return () => {
			media.removeEventListener("change", change);
			window.removeEventListener("resize", resize);
		};
	}, []);
	const minWidth = captionPanel ? 340 : 260;
	const maxWidth = captionPanel ? Math.max(minWidth, Math.min(900, Math.floor(windowWidth * 0.55))) : 460;
	const clamp = (width: number) => Math.min(maxWidth, Math.max(minWidth, width));
	const update = (patch: Partial<typeof DEFAULT>) => {
		const next = { ...preferences, ...patch };
		setPreferences(next);
		saveAppSetting(EDITOR_LAYOUT_STORAGE_KEY, next);
	};
	const setWidth = (width: number) => {
		if (captionPanel) setCaptionWidth(clamp(width));
		else setPreferences(previous => ({ ...previous, width: clamp(width) }));
	};
	return { preferences: { ...preferences, width: clamp(captionPanel ? captionWidth : preferences.width) }, compact, open: compact ? compactOpen : !preferences.collapsed,
		minWidth, maxWidth, setWidth,
		commitWidth: () => {
			if (captionPanel) saveAppSetting(CAPTION_PANEL_WIDTH_KEY, captionWidth);
			else saveAppSetting(EDITOR_LAYOUT_STORAGE_KEY, preferences);
		},
		updateWidth: (width: number) => {
			if (captionPanel) { setWidth(width); saveAppSetting(CAPTION_PANEL_WIDTH_KEY, clamp(width)); }
			else update({ width: clamp(width) });
		},
		update,
		setOpen: (open: boolean) => { if (compact) setCompactOpen(open); else update({ collapsed: !open }); },
	};
}
