import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import { getCursorCaptureElapsedMs, isCursorCapturePaused } from "../cursor/telemetry";
import { isCursorCaptureActive, nativeCapturePaused, windowsCapturePaused } from "../state";
import type { RecordingMarker, RecordingMarkerAdded, RecordingMarkerKind } from "../types";
import { getMarkersPathForVideo, parseJsonWithByteOrderMark } from "../utils";
import { normalizeRecordingMarkers } from "../../../services/leadcut-mcp/src/recordingMarkersModel";

export { isRecordingMarkerKind } from "../../../services/leadcut-mcp/src/recordingMarkersModel";

const markers: RecordingMarker[] = [];

export function resetRecordingMarkers() {
	markers.length = 0;
}

export function getCurrentMarkerCount() {
	return markers.length;
}

export function addRecordingMarker(kind: RecordingMarkerKind): RecordingMarkerAdded | { success: false } {
	if (!isCursorCaptureActive || isCursorCapturePaused() || nativeCapturePaused || windowsCapturePaused) {
		return { success: false };
	}
	const timeMs = Math.round(getCursorCaptureElapsedMs());
	markers.push({ id: randomUUID(), timeMs, kind });
	return { success: true, timeMs, kind, count: markers.length };
}

export async function writeRecordingMarkers(videoPath: string, recordingMarkers: readonly RecordingMarker[]) {
	if (!recordingMarkers.length) return;
	const target = getMarkersPathForVideo(videoPath);
	const temporary = `${target}.${randomUUID()}.tmp`;
	try {
		await fs.writeFile(temporary, JSON.stringify({ version: 1, markers: recordingMarkers }, null, 2), { flag: "wx" });
		await fs.rename(temporary, target);
	} finally {
		await fs.rm(temporary, { force: true }).catch(() => undefined);
	}
}

export async function persistRecordingMarkers(videoPath: string) {
	await writeRecordingMarkers(videoPath, [...markers]);
}

export async function readRecordingMarkers(videoPath: string): Promise<RecordingMarker[]> {
	try {
		const parsed = parseJsonWithByteOrderMark(
			await fs.readFile(getMarkersPathForVideo(videoPath), "utf8"),
		);
		return normalizeRecordingMarkers(parsed);
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
		throw error;
	}
}
