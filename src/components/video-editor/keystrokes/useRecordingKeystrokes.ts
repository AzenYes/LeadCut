import { useEffect, useMemo, useState } from "react";
import type { KeystrokeSidecar } from "../../../../services/leadcut-mcp/src/keystrokeSidecar";
import type { ClipRegion, KeystrokeOverlaySettings } from "../types";
import { buildKeystrokeItems, getKeystrokePresses } from "./keystrokeModel";

export function useRecordingKeystrokes(videoSourcePath: string | null, clips: ClipRegion[], settings: KeystrokeOverlaySettings) {
	const [result, setResult] = useState<{ source: string; failed: boolean } & KeystrokeSidecar>();
	const getEvents = window.electronAPI?.getRecordingKeystrokes;
	useEffect(() => {
		if (!videoSourcePath || !getEvents) return;
		let active = true;
		void getEvents(videoSourcePath).then(reply => {
			if (active) setResult({ source: videoSourcePath, failed: !reply.success, events: reply.success ? reply.events : [], mode: reply.mode });
		}).catch(() => {
			if (active) setResult({ source: videoSourcePath, failed: true, events: [] });
		});
		return () => { active = false; };
	}, [videoSourcePath, getEvents]);

	const matchingResult = result?.source === videoSourcePath ? result : undefined;
	const ready = !videoSourcePath || !getEvents || Boolean(matchingResult);
	const items = useMemo(() => matchingResult ? buildKeystrokeItems(matchingResult.events, {
		clips, hiddenIds: settings.hiddenIds, durationMs: settings.style.durationMs, filter: settings.filter,
	}) : [], [matchingResult, clips, settings.hiddenIds, settings.style.durationMs, settings.filter]);
	const pressCount = useMemo(() => matchingResult ? getKeystrokePresses(matchingResult.events).length : 0, [matchingResult]);
	const presentation = useMemo(() => settings.enabled && items.length > 0 ? { items, style: settings.style } : undefined,
		[items, settings.enabled, settings.style]);
	return {
		items, presentation, ready, hasEvents: Boolean(matchingResult?.events.length),
		pressCount, mode: matchingResult?.mode, failed: matchingResult?.failed ?? false,
	};
}
