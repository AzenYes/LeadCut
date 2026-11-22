export const RECORDING_DISK_CHECK_INTERVAL_MS = 10_000;
export const RECORDING_DISK_WARNING_BYTES = 2_000_000_000;
export const RECORDING_DISK_STOP_BYTES = 500_000_000;

export function getRecordingDiskLevel(freeBytes: number) {
	if (freeBytes < RECORDING_DISK_STOP_BYTES) return "stop";
	if (freeBytes < RECORDING_DISK_WARNING_BYTES) return "low";
	return "ok";
}

export interface RecordingDiskStatus {
	freeBytes: number;
	level: ReturnType<typeof getRecordingDiskLevel>;
}
