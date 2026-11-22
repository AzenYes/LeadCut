import { BrowserWindow } from "electron";
import type { RecordingMarkerKind } from "../types";
import { addRecordingMarker } from "./markers";

export function addRecordingMarkerAndNotify(kind: RecordingMarkerKind, hud: BrowserWindow | null) {
	const result = addRecordingMarker(kind);
	if (result.success) hud?.webContents.send("recording-marker-added", result);
	return result;
}

export function emitRecordingInterrupted(reason: string, message: string) {
	BrowserWindow.getAllWindows().forEach((window) => {
		if (!window.isDestroyed()) {
			window.webContents.send("recording-interrupted", { reason, message });
		}
	});
}
