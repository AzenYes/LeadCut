import { useEffect, useMemo, useState } from "react";
import type { RecordingMarker } from "../../../../electron/ipc/types";
import { mapMarkersToTimeline } from "../timeline/core/recordingMarkers";
import type { ClipRegion } from "../types";

export function useRecordingMarkers(videoSourcePath: string | null | undefined, clips: ClipRegion[]) {
	const [result, setResult] = useState<{ sourcePath: string; markers: RecordingMarker[] }>();

	useEffect(() => {
		if (!videoSourcePath) return;
		const request = window.electronAPI?.getRecordingMarkers?.(videoSourcePath);
		if (!request) return;
		let active = true;
		void request.then(({ success, markers }) => {
			if (active) setResult({ sourcePath: videoSourcePath, markers: success ? markers : [] });
		}).catch((error) => {
			if (!active) return;
			console.warn("Could not load recording markers:", error);
			setResult({ sourcePath: videoSourcePath, markers: [] });
		});
		return () => { active = false; };
	}, [videoSourcePath]);

	return useMemo(() => {
		return result && result.sourcePath === videoSourcePath ? mapMarkersToTimeline(result.markers, clips) : [];
	}, [result, videoSourcePath, clips]);
}
