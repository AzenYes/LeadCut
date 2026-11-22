import { expect, it } from "vitest";
import {
	RECORDING_DISK_STOP_BYTES,
	RECORDING_DISK_WARNING_BYTES,
	getRecordingDiskLevel,
} from "./diskEstimate";

it("distinguishes the warning and automatic stop boundaries", () => {
	expect(getRecordingDiskLevel(RECORDING_DISK_WARNING_BYTES)).toBe("ok");
	expect(getRecordingDiskLevel(RECORDING_DISK_WARNING_BYTES - 1)).toBe("low");
	expect(getRecordingDiskLevel(RECORDING_DISK_STOP_BYTES)).toBe("low");
	expect(getRecordingDiskLevel(RECORDING_DISK_STOP_BYTES - 1)).toBe("stop");
});
