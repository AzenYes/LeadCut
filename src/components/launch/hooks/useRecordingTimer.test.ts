import { expect, it } from "vitest";
import { formatRecordingTime } from "./useRecordingTimer";

it("adds hours after 59:59 without dropping minute or second padding", () => {
	expect(formatRecordingTime(3599)).toBe("59:59");
	expect(formatRecordingTime(3600)).toBe("1:00:00");
	expect(formatRecordingTime(36123)).toBe("10:02:03");
});
