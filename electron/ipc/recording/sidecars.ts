import { appLog } from "../../logger";
import { persistPendingCursorTelemetry } from "../cursor/telemetry";
import { persistKeystrokes } from "../cursor/keystrokes";
import { persistRecordingMarkers } from "./markers";

export async function persistRecordingSidecars(videoPath: string) {
	const results = await Promise.allSettled([
		persistPendingCursorTelemetry(videoPath),
		persistRecordingMarkers(videoPath),
		persistKeystrokes(videoPath),
	]);
	for (const [index, result] of results.entries()) {
		if (result.status === "rejected") {
			const sidecar = ["cursor telemetry", "markers", "keystrokes"][index];
			appLog("warn", "recording-sidecars", `Could not save recording ${sidecar}.`, result.reason);
		}
	}
}
